//! Starting Moldavite without third-party plugins.
//!
//! Plugins run inside the webview, so one that crashes or floods it can leave
//! every launch unusable, and the Settings screen that would turn it off never
//! becomes reachable. Nothing here needs that screen:
//!
//! - `--safe-mode` on the command line. A second launch carrying the flag makes
//!   the running instance restart itself, because a frozen window cannot act
//!   on an event.
//! - A marker written just before launch-time plugins start and removed once
//!   the window has stayed responsive. Finding it at launch means the previous
//!   start never settled: a crash, a hang, or a quit from a frozen window. It
//!   is deliberately left in place on a normal quit for that last reason.
//!
//! Enable state and consent stay with the frontend. This module only decides
//! whether plugins may start in this process.

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, MutexGuard};

use serde::{Deserialize, Serialize};
use tauri::State;

use crate::validation::is_valid_plugin_id;

pub(crate) const SAFE_MODE_FLAG: &str = "--safe-mode";
const MARKER_FILE: &str = "plugin-startup.json";
const MAX_REPORTED_PLUGINS: usize = 100;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum SafeModeReason {
    LaunchFlag,
    UnfinishedStart,
    UserRequest,
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SafeModeStatus {
    pub active: bool,
    pub reason: Option<SafeModeReason>,
    /// Plugins that were starting when the previous start stopped.
    pub plugin_ids: Vec<String>,
}

#[derive(Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Marker {
    /// Absent for an unfinished start; `launchFlag` when a running instance
    /// restarted itself for `--safe-mode`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    reason: Option<SafeModeReason>,
    #[serde(default)]
    plugin_ids: Vec<String>,
}

pub(crate) struct PluginSafety {
    marker: PathBuf,
    status: Mutex<SafeModeStatus>,
}

pub(crate) fn marker_path() -> PathBuf {
    crate::paths::get_config_path().with_file_name(MARKER_FILE)
}

pub(crate) fn has_safe_mode_flag<S: AsRef<str>>(args: &[S]) -> bool {
    args.iter().any(|arg| arg.as_ref() == SAFE_MODE_FLAG)
}

fn active(reason: SafeModeReason, plugin_ids: Vec<String>) -> SafeModeStatus {
    SafeModeStatus {
        active: true,
        reason: Some(reason),
        plugin_ids,
    }
}

fn reportable_ids(ids: Vec<String>) -> Vec<String> {
    let mut kept: Vec<String> = Vec::new();
    for id in ids {
        if kept.len() == MAX_REPORTED_PLUGINS {
            break;
        }
        if is_valid_plugin_id(&id) && !kept.contains(&id) {
            kept.push(id);
        }
    }
    kept
}

fn write_marker(path: &Path, marker: &Marker) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("cannot create config directory: {e}"))?;
    }
    let bytes = serde_json::to_vec(marker).map_err(|e| e.to_string())?;
    crate::persist::write_atomic(path, &bytes, Some(0o600))
}

fn remove_marker(path: &Path) {
    if let Err(error) = fs::remove_file(path) {
        if error.kind() != std::io::ErrorKind::NotFound {
            log::warn!("could not remove the plugin startup marker: {error}");
        }
    }
}

impl PluginSafety {
    /// Decide this launch's mode and consume the marker, so one unfinished
    /// start costs exactly one launch without plugins.
    pub(crate) fn at_launch(marker: PathBuf, launched_with_flag: bool) -> Self {
        let previous = match fs::read(&marker) {
            Ok(bytes) => Some(serde_json::from_slice::<Marker>(&bytes).unwrap_or_default()),
            Err(_) => None,
        };
        if previous.is_some() {
            remove_marker(&marker);
        }
        let status = if launched_with_flag {
            active(SafeModeReason::LaunchFlag, Vec::new())
        } else if let Some(previous) = previous {
            active(
                previous.reason.unwrap_or(SafeModeReason::UnfinishedStart),
                reportable_ids(previous.plugin_ids),
            )
        } else {
            SafeModeStatus::default()
        };
        Self {
            marker,
            status: Mutex::new(status),
        }
    }

    fn lock(&self) -> MutexGuard<'_, SafeModeStatus> {
        self.status
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    pub(crate) fn status(&self) -> SafeModeStatus {
        self.lock().clone()
    }

    /// Arm the marker for the plugins about to start, unless this process is
    /// already in safe mode, in which case nothing may start.
    pub(crate) fn begin_startup(&self, plugin_ids: Vec<String>) -> Result<SafeModeStatus, String> {
        let status = self.lock();
        if status.active {
            return Ok(status.clone());
        }
        let plugin_ids = reportable_ids(plugin_ids);
        if !plugin_ids.is_empty() {
            write_marker(
                &self.marker,
                &Marker {
                    reason: None,
                    plugin_ids,
                },
            )?;
        }
        Ok(status.clone())
    }

    pub(crate) fn finish_startup(&self) {
        remove_marker(&self.marker);
    }

    pub(crate) fn set_active(&self, on: bool) -> SafeModeStatus {
        let mut status = self.lock();
        remove_marker(&self.marker);
        *status = if on {
            active(SafeModeReason::UserRequest, Vec::new())
        } else {
            SafeModeStatus::default()
        };
        status.clone()
    }

    #[cfg(test)]
    fn request_on_next_launch(&self) -> Result<(), String> {
        request_safe_mode_at(&self.marker)
    }
}

fn request_safe_mode_at(marker: &Path) -> Result<(), String> {
    write_marker(
        marker,
        &Marker {
            reason: Some(SafeModeReason::LaunchFlag),
            plugin_ids: Vec::new(),
        },
    )
}

/// A second launch with `--safe-mode` while this instance runs, possibly with
/// a frozen window: restart so the next process starts without plugins.
pub(crate) fn restart_in_safe_mode(app: &tauri::AppHandle) {
    if let Err(error) = request_safe_mode_at(&marker_path()) {
        log::error!("could not request safe mode: {error}");
        return;
    }
    app.restart();
}

#[tauri::command]
pub(crate) fn plugin_safe_mode_status(state: State<'_, PluginSafety>) -> SafeModeStatus {
    state.status()
}

#[tauri::command]
pub(crate) fn begin_plugin_startup(
    plugin_ids: Vec<String>,
    state: State<'_, PluginSafety>,
) -> Result<SafeModeStatus, String> {
    state.begin_startup(plugin_ids)
}

#[tauri::command]
pub(crate) fn finish_plugin_startup(state: State<'_, PluginSafety>) {
    state.finish_startup();
}

#[tauri::command]
pub(crate) fn set_plugin_safe_mode(active: bool, state: State<'_, PluginSafety>) -> SafeModeStatus {
    state.set_active(active)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn marker_in(test: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "moldavite-plugin-safety-{test}-{}",
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&dir);
        dir.join("Moldavite").join(MARKER_FILE)
    }

    fn ids(values: &[&str]) -> Vec<String> {
        values.iter().map(|value| value.to_string()).collect()
    }

    #[test]
    fn a_clean_launch_runs_plugins() {
        let marker = marker_in("clean");
        let safety = PluginSafety::at_launch(marker.clone(), false);
        assert_eq!(safety.status(), SafeModeStatus::default());
        assert!(!marker.exists());
    }

    #[test]
    fn the_flag_starts_in_safe_mode() {
        assert!(has_safe_mode_flag(&["--forge", "Work", "--safe-mode"]));
        assert!(!has_safe_mode_flag(&["--safe-mode=1", "safe-mode"]));
        let safety = PluginSafety::at_launch(marker_in("flag"), true);
        assert_eq!(
            safety.status(),
            active(SafeModeReason::LaunchFlag, Vec::new())
        );
    }

    #[test]
    fn a_start_that_never_settled_makes_exactly_the_next_launch_safe() {
        let marker = marker_in("unfinished");
        let first = PluginSafety::at_launch(marker.clone(), false);
        first
            .begin_startup(ids(&["bad-plugin", "good-plugin"]))
            .unwrap();
        assert!(marker.exists());
        drop(first); // the process dies without finish_startup

        let second = PluginSafety::at_launch(marker.clone(), false);
        assert_eq!(
            second.status(),
            active(
                SafeModeReason::UnfinishedStart,
                ids(&["bad-plugin", "good-plugin"])
            )
        );
        assert!(
            !marker.exists(),
            "the marker is consumed by the launch it affects"
        );
        assert!(second.begin_startup(ids(&["bad-plugin"])).unwrap().active);
        assert!(!marker.exists(), "safe mode arms nothing");

        let third = PluginSafety::at_launch(marker, false);
        assert!(!third.status().active);
    }

    #[test]
    fn a_settled_start_leaves_no_marker() {
        let marker = marker_in("settled");
        let safety = PluginSafety::at_launch(marker.clone(), false);
        assert!(!safety.begin_startup(ids(&["fine"])).unwrap().active);
        safety.finish_startup();
        assert!(!marker.exists());
        assert!(!PluginSafety::at_launch(marker, false).status().active);
    }

    #[test]
    fn starting_no_plugins_arms_nothing() {
        let marker = marker_in("none");
        let safety = PluginSafety::at_launch(marker.clone(), false);
        safety.begin_startup(Vec::new()).unwrap();
        assert!(!marker.exists());
    }

    #[test]
    fn a_corrupt_marker_still_means_the_last_start_failed() {
        let marker = marker_in("corrupt");
        fs::create_dir_all(marker.parent().unwrap()).unwrap();
        fs::write(&marker, b"{not json").unwrap();
        let safety = PluginSafety::at_launch(marker.clone(), false);
        assert_eq!(
            safety.status(),
            active(SafeModeReason::UnfinishedStart, Vec::new())
        );
        assert!(!marker.exists());
    }

    #[test]
    fn reported_ids_are_validated_deduplicated_and_bounded() {
        let mut many = ids(&["../escape", "Upper", "ok-one", "ok-one", ""]);
        many.extend((0..200).map(|index| format!("plugin-{index}")));
        let kept = reportable_ids(many);
        assert_eq!(kept.first().map(String::as_str), Some("ok-one"));
        assert_eq!(kept.len(), MAX_REPORTED_PLUGINS);
        assert!(kept.iter().all(|id| is_valid_plugin_id(id)));
    }

    #[test]
    fn a_restart_request_from_a_second_launch_survives_into_the_next_process() {
        let marker = marker_in("restart");
        let running = PluginSafety::at_launch(marker.clone(), false);
        running.begin_startup(ids(&["frozen"])).unwrap();
        running.request_on_next_launch().unwrap();

        let restarted = PluginSafety::at_launch(marker, false);
        assert_eq!(
            restarted.status(),
            active(SafeModeReason::LaunchFlag, Vec::new())
        );
    }

    #[test]
    fn the_user_can_enter_and_leave_safe_mode() {
        let marker = marker_in("user");
        let safety = PluginSafety::at_launch(marker.clone(), true);
        safety.begin_startup(ids(&["x"])).unwrap();
        assert_eq!(
            safety.set_active(true),
            active(SafeModeReason::UserRequest, Vec::new())
        );
        assert_eq!(safety.set_active(false), SafeModeStatus::default());
        assert!(!safety.begin_startup(ids(&["x"])).unwrap().active);
        assert!(marker.exists());
    }
}

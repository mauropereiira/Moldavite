//! File watcher rooted at the configured Forge directory.
//!
//! Emits a Tauri event `forge:changed` with `{ kind, relPath }` whenever a
//! note file is created, modified, or removed by an external process.
//!
//! Writes performed by Moldavite itself are short-circuited via a recent-write
//! ignore list so the UI doesn't double-refresh after its own saves.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use notify::RecursiveMode;
use notify_debouncer_mini::new_debouncer;
use serde::Serialize;
use tauri::{AppHandle, Emitter};

use crate::paths::get_notes_dir;

/// How long after a self-write to ignore an event for that path.
const SELF_WRITE_IGNORE_MS: u64 = 500;

/// Records writes Moldavite itself initiated, keyed by absolute path. Events
/// for paths in this map (within `SELF_WRITE_IGNORE_MS`) are dropped.
#[derive(Debug, Default)]
pub struct RecentWrites {
    inner: Mutex<HashMap<PathBuf, Instant>>,
}

impl RecentWrites {
    pub fn new() -> Self {
        Self::default()
    }

    /// Record that we just wrote `path`. Subsequent watcher events within
    /// the ignore window will be dropped.
    pub fn record(&self, path: &Path) {
        if let Ok(mut map) = self.inner.lock() {
            map.insert(path.to_path_buf(), Instant::now());
            // Opportunistic GC.
            map.retain(|_, t| t.elapsed() < Duration::from_secs(5));
        }
    }

    /// Returns true if `path` was written by us very recently.
    pub fn is_recent(&self, path: &Path) -> bool {
        if let Ok(map) = self.inner.lock() {
            if let Some(t) = map.get(path) {
                return t.elapsed() < Duration::from_millis(SELF_WRITE_IGNORE_MS);
            }
        }
        false
    }
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ForgeChange {
    /// "modified" — debouncer-mini collapses create/modify/remove into one.
    /// Frontend should treat this as "something changed; re-fetch the list
    /// and the active note's content."
    pub kind: String,
    /// Path relative to the Forge root, using forward slashes.
    pub rel_path: String,
}

fn rel_path(root: &Path, abs: &Path) -> Option<String> {
    abs.strip_prefix(root).ok().map(|p| {
        p.components()
            .map(|c| c.as_os_str().to_string_lossy().to_string())
            .collect::<Vec<_>>()
            .join("/")
    })
}

/// Whether a path is something Moldavite cares about (a note, image, or
/// template). Filters out hidden files (`.note-metadata.json*`, `.trash/`,
/// `.DS_Store`) so we don't fire constant noise.
fn is_relevant(rel: &str) -> bool {
    if rel.is_empty() {
        return false;
    }
    let first = rel.split('/').next().unwrap_or("");
    if first.starts_with('.') {
        return false;
    }
    let last = rel.rsplit('/').next().unwrap_or("");
    if last.starts_with('.') {
        return false;
    }
    // Only notes and templates — we leave image events alone since the
    // frontend re-renders images on its own.
    last.ends_with(".md")
        || last.ends_with(".md.locked")
        || last.ends_with(".json")
}

/// Spawn a long-lived background thread that watches the Forge directory and
/// emits Tauri events. Returns a guard handle whose Drop stops the watcher.
pub fn spawn(
    app: AppHandle,
    recent: Arc<RecentWrites>,
) -> Result<WatcherHandle, String> {
    let root = get_notes_dir();
    if !root.exists() {
        // Nothing to watch yet; the caller can re-spawn after dirs are made.
        log::info!("[forge watcher] root {:?} does not exist yet", root);
    }

    let app_for_thread = app.clone();
    let root_for_thread = root.clone();
    let recent_for_thread = recent.clone();

    let (tx, rx) = std::sync::mpsc::channel();

    let mut debouncer = new_debouncer(Duration::from_millis(300), tx)
        .map_err(|e| format!("failed to create debouncer: {}", e))?;
    if root.exists() {
        debouncer
            .watcher()
            .watch(&root, RecursiveMode::Recursive)
            .map_err(|e| format!("failed to watch {:?}: {}", root, e))?;
    }

    let join = std::thread::Builder::new()
        .name("forge-watcher".into())
        .spawn(move || {
            // Hold the debouncer for the lifetime of this thread so it keeps
            // running. When the thread exits (on shutdown) it drops.
            let _debouncer = debouncer;
            while let Ok(events) = rx.recv() {
                let events = match events {
                    Ok(ev) => ev,
                    Err(err) => {
                        log::warn!("[forge watcher] error: {}", err);
                        continue;
                    }
                };
                for event in events {
                    let path = event.path;
                    if recent_for_thread.is_recent(&path) {
                        continue;
                    }
                    let Some(rel) = rel_path(&root_for_thread, &path) else {
                        continue;
                    };
                    if !is_relevant(&rel) {
                        continue;
                    }
                    let payload = ForgeChange {
                        kind: "modified".into(),
                        rel_path: rel,
                    };
                    if let Err(e) = app_for_thread.emit("forge:changed", payload) {
                        log::warn!("[forge watcher] emit failed: {}", e);
                    }
                }
            }
        })
        .map_err(|e| format!("failed to spawn watcher thread: {}", e))?;

    Ok(WatcherHandle {
        _join: Some(join),
    })
}

/// Owned handle. Currently the thread runs for the life of the app; this
/// struct exists so future code can replace the watcher when the user picks
/// a new Forge directory.
pub struct WatcherHandle {
    _join: Option<std::thread::JoinHandle<()>>,
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    #[test]
    fn relevant_filters_dotfiles_and_trash() {
        assert!(!is_relevant(".note-metadata.json"));
        assert!(!is_relevant(".trash/old.md"));
        assert!(!is_relevant("notes/.DS_Store"));
        assert!(is_relevant("notes/foo.md"));
        assert!(is_relevant("daily/2024-01-01.md"));
        assert!(is_relevant("notes/secret.md.locked"));
    }

    #[test]
    fn relevant_ignores_unknown_extensions() {
        assert!(!is_relevant("notes/foo.png"));
        assert!(!is_relevant("notes/foo.txt"));
    }

    #[test]
    fn recent_writes_within_window() {
        let r = RecentWrites::new();
        let p = PathBuf::from("/tmp/x.md");
        r.record(&p);
        assert!(r.is_recent(&p));
    }

    #[test]
    fn recent_writes_unknown_path_is_not_recent() {
        let r = RecentWrites::new();
        assert!(!r.is_recent(Path::new("/tmp/never.md")));
    }
}

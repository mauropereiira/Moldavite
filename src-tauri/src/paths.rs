//! Canonical configuration and active-Forge path derivation.
//!
//! All domain paths descend from the persisted Forges root plus active Forge;
//! callers must not reconstruct these paths independently. Helpers only resolve
//! locations (or create their one owned directory) and do not validate untrusted
//! leaf names. Daily, weekly, standalone, images, trash, templates, and internal
//! metadata roots remain distinct.

use std::ffi::OsString;
use std::fs;
use std::path::{Path, PathBuf};

use crate::persist::read_config;

/// Resolve an OS directory lookup that can return `None` on an unusual
/// system, falling back to the home directory and finally the current
/// working directory rather than panicking on the app's first note
/// operation. The happy path (`primary` is `Some`) is unchanged.
fn os_dir_or_fallback(primary: Option<PathBuf>, label: &str) -> PathBuf {
    if let Some(dir) = primary {
        return dir;
    }
    log::error!("{label} unavailable from the OS; falling back to the home directory");
    if let Some(home) = dirs::home_dir() {
        return home;
    }
    log::error!("{label}: home directory also unavailable; falling back to the current directory");
    std::env::current_dir().unwrap_or_else(|error| {
        log::error!("{label}: current directory also unavailable ({error}); using \".\"");
        PathBuf::from(".")
    })
}

pub(crate) fn get_config_path() -> PathBuf {
    os_dir_or_fallback(dirs::config_dir(), "Config directory")
        .join("Moldavite")
        .join("config.json")
}

pub(crate) fn get_default_notes_dir() -> PathBuf {
    os_dir_or_fallback(dirs::document_dir(), "Documents directory").join("Moldavite")
}

/// Default name for the Forge that legacy single-Forge users get migrated
/// into on first launch after the multi-Forge update.
pub(crate) const DEFAULT_FORGE_NAME: &str = "Default";

/// Returns the parent directory that holds all Forges. Falls back to the
/// legacy `notes_directory.parent()` if `forges_root` is unset.
pub(crate) fn get_forges_root() -> PathBuf {
    let config = read_config();
    if let Some(root) = config.forges_root.as_deref() {
        let p = PathBuf::from(root);
        if !p.as_os_str().is_empty() {
            return p;
        }
    }
    // Fallback: derive from legacy notes_directory parent.
    if let Some(legacy) = config.notes_directory.as_deref() {
        let p = PathBuf::from(legacy);
        if let Some(parent) = p.parent() {
            return parent.to_path_buf();
        }
    }
    os_dir_or_fallback(dirs::document_dir(), "Documents directory").join("Moldavite")
}

/// Returns the active Forge name (a directory under `forges_root`).
pub(crate) fn get_active_forge_name() -> String {
    let config = read_config();
    if let Some(name) = config.active_forge.as_deref() {
        if !name.is_empty() {
            return name.to_string();
        }
    }
    // Fallback: pull the leaf name off legacy notes_directory.
    if let Some(legacy) = config.notes_directory.as_deref() {
        if let Some(name) = PathBuf::from(legacy)
            .file_name()
            .and_then(|n| n.to_str())
            .map(|s| s.to_string())
        {
            return name;
        }
    }
    DEFAULT_FORGE_NAME.to_string()
}

pub(crate) fn get_notes_dir() -> PathBuf {
    let config = read_config();
    // Preferred: forges_root + active_forge.
    if let (Some(root), Some(name)) = (
        config.forges_root.as_deref(),
        config.active_forge.as_deref(),
    ) {
        if !root.is_empty() && !name.is_empty() {
            return PathBuf::from(root).join(name);
        }
    }
    // Back-compat: legacy `notes_directory` field.
    if let Some(custom_dir) = config.notes_directory {
        let path = PathBuf::from(&custom_dir);
        if path.exists() {
            return path;
        }
    }
    get_default_notes_dir()
}

pub(crate) fn get_daily_dir() -> PathBuf {
    get_notes_dir().join("daily")
}

pub(crate) fn get_standalone_dir() -> PathBuf {
    get_notes_dir().join("notes")
}

pub(crate) fn get_weekly_dir() -> PathBuf {
    get_notes_dir().join("weekly")
}

pub(crate) fn get_images_dir() -> PathBuf {
    get_notes_dir().join("images")
}

pub(crate) fn get_trash_dir() -> PathBuf {
    get_notes_dir().join(".trash")
}

pub(crate) fn get_trash_metadata_path() -> PathBuf {
    get_trash_dir().join("metadata.json")
}

pub(crate) fn get_templates_dir() -> Result<PathBuf, String> {
    let path = get_notes_dir().join("templates");
    Ok(path)
}

pub(crate) fn get_metadata_path() -> PathBuf {
    get_notes_dir().join(".note-metadata.json")
}

pub(crate) fn ensure_trash_dir() -> Result<(), String> {
    let trash_dir = get_trash_dir();
    fs::create_dir_all(&trash_dir).map_err(|e| format!("Failed to create trash directory: {}", e))?;
    Ok(())
}

pub(crate) fn ensure_templates_dir() -> Result<(), String> {
    let templates_dir = get_templates_dir()?;
    fs::create_dir_all(&templates_dir).map_err(|e| e.to_string())?;
    Ok(())
}

pub(crate) fn file_modified_unix(path: &Path) -> Option<i64> {
    fs::metadata(path)
        .ok()?
        .modified()
        .ok()?
        .duration_since(std::time::UNIX_EPOCH)
        .ok()
        .map(|d| d.as_secs() as i64)
}

/// The path another program should launch to reach this Moldavite binary:
/// the MCP client config and the browser clipper's native-messaging manifest
/// both persist it.
///
/// Inside an AppImage `current_exe` points into a FUSE mount that exists only
/// while the app runs, so a config written with it is dead after the first
/// quit. The AppImage runtime exports the real file as `APPIMAGE`; prefer it.
pub(crate) fn app_binary_path() -> Result<PathBuf, String> {
    let current = std::env::current_exe()
        .map_err(|error| format!("Cannot locate the Moldavite binary: {error}"))?;
    Ok(app_binary_path_from(std::env::var_os("APPIMAGE"), current))
}

fn app_binary_path_from(appimage: Option<OsString>, current_exe: PathBuf) -> PathBuf {
    match appimage.map(PathBuf::from) {
        Some(path) if path.is_absolute() => path,
        _ => current_exe,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn os_dir_or_fallback_keeps_the_happy_path_identical() {
        let primary = PathBuf::from("/some/os-provided/dir");
        assert_eq!(
            os_dir_or_fallback(Some(primary.clone()), "Test directory"),
            primary
        );
    }

    #[test]
    fn os_dir_or_fallback_falls_back_instead_of_panicking() {
        // When the OS lookup fails, this must never panic — it should fall
        // back to the home directory (or further, to the current directory)
        // rather than hard-crashing the app's first note operation.
        let fallback = os_dir_or_fallback(None, "Test directory");
        assert!(!fallback.as_os_str().is_empty());
    }

    #[test]
    fn app_binary_path_prefers_the_appimage_file_over_the_mounted_exe() {
        // Built from temp_dir so the paths are absolute on every platform; a
        // Unix-rooted literal is relative on Windows and the fallback would win.
        let mounted = std::env::temp_dir().join(".mount_MoldavAbc/usr/bin/moldavite");
        let appimage: OsString = std::env::temp_dir()
            .join("Moldavite_2.5.0_amd64.AppImage")
            .into_os_string();
        assert_eq!(
            app_binary_path_from(Some(appimage.clone()), mounted.clone()),
            PathBuf::from(appimage)
        );
        assert_eq!(app_binary_path_from(None, mounted.clone()), mounted);
        assert_eq!(
            app_binary_path_from(Some(OsString::from("relative.AppImage")), mounted.clone()),
            mounted,
            "a relative APPIMAGE is not trusted"
        );
    }
}

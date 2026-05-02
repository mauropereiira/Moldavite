//! Path and directory helpers for the notes tree.

use std::fs;
use std::path::{Path, PathBuf};

use crate::persist::read_config;

pub(crate) fn get_config_path() -> PathBuf {
    dirs::config_dir()
        .expect("Could not find config directory")
        .join("Moldavite")
        .join("config.json")
}

pub(crate) fn get_default_notes_dir() -> PathBuf {
    dirs::document_dir()
        .expect("Could not find Documents directory")
        .join("Moldavite")
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
    dirs::document_dir()
        .expect("Could not find Documents directory")
        .join("Moldavite")
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
            let path = PathBuf::from(root).join(name);
            if path.exists() {
                return path;
            }
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

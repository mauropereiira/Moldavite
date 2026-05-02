//! Forge management commands: list, create, rename, delete, set-active,
//! set forges root.
//!
//! A "Forge" is a directory under `forges_root` that contains a notes tree
//! (`daily/`, `notes/`, etc.). Switching the active Forge swaps the entire
//! root path that the rest of the backend resolves through `paths::get_notes_dir`.

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use tauri::{AppHandle, Manager, State};

use crate::backlinks_index::BacklinksIndex;
use crate::forge_watcher::{self, RecentWrites, WatcherHandle};
use crate::paths::{get_active_forge_name, get_forges_root};
use crate::persist::{read_config, write_config};
use crate::types::ForgeInfo;
use crate::validation::is_safe_filename;

/// A directory looks like a Forge if it contains at least one of the
/// expected note subdirs.
pub(crate) fn looks_like_forge(dir: &Path) -> bool {
    if !dir.is_dir() {
        return false;
    }
    for sub in ["daily", "notes", "weekly", "templates"] {
        if dir.join(sub).is_dir() {
            return true;
        }
    }
    false
}

/// Validate a Forge name. Stricter than `is_safe_filename` — disallow
/// dotfiles and reserve `.trash` style names.
pub(crate) fn is_valid_forge_name(name: &str) -> bool {
    if !is_safe_filename(name) {
        return false;
    }
    if name.starts_with('.') {
        return false;
    }
    // Avoid Windows-y reserved names just in case.
    let upper = name.to_uppercase();
    if matches!(upper.as_str(), "CON" | "PRN" | "AUX" | "NUL") {
        return false;
    }
    // 64-char cap is plenty for a folder name and sidesteps fs limits.
    if name.chars().count() > 64 {
        return false;
    }
    true
}

/// Scaffold an empty Forge at `path` with the standard subdirs.
pub(crate) fn scaffold_forge(path: &Path) -> Result<(), String> {
    fs::create_dir_all(path).map_err(|e| format!("Failed to create Forge dir: {}", e))?;
    for sub in ["daily", "notes", "weekly", "templates", ".trash"] {
        fs::create_dir_all(path.join(sub))
            .map_err(|e| format!("Failed to create {}/{}: {}", path.display(), sub, e))?;
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = fs::set_permissions(path, fs::Permissions::from_mode(0o700));
    }
    Ok(())
}

#[tauri::command]
pub(crate) fn list_forges() -> Result<Vec<ForgeInfo>, String> {
    let root = get_forges_root();
    let active = get_active_forge_name();
    let mut out: Vec<ForgeInfo> = Vec::new();

    if !root.exists() {
        return Ok(out);
    }

    let entries = fs::read_dir(&root).map_err(|e| format!("Failed to read forges root: {}", e))?;
    for entry in entries.flatten() {
        let path = entry.path();
        let Some(name) = path.file_name().and_then(|n| n.to_str()) else {
            continue;
        };
        if name.starts_with('.') {
            continue;
        }
        if !path.is_dir() {
            continue;
        }
        if !looks_like_forge(&path) {
            continue;
        }
        out.push(ForgeInfo {
            name: name.to_string(),
            path: path.to_string_lossy().to_string(),
            is_active: name == active,
        });
    }
    out.sort_by_key(|f| f.name.to_lowercase());
    Ok(out)
}

#[tauri::command]
pub(crate) fn create_forge(name: String) -> Result<ForgeInfo, String> {
    if !is_valid_forge_name(&name) {
        return Err("Invalid Forge name".to_string());
    }
    let root = get_forges_root();
    fs::create_dir_all(&root).map_err(|e| format!("Failed to create forges root: {}", e))?;
    let path = root.join(&name);
    if path.exists() {
        return Err(format!("A Forge named \"{}\" already exists", name));
    }
    scaffold_forge(&path)?;
    Ok(ForgeInfo {
        name: name.clone(),
        path: path.to_string_lossy().to_string(),
        is_active: false,
    })
}

#[tauri::command]
pub(crate) fn set_active_forge(
    name: String,
    app: AppHandle,
    recent: State<'_, Arc<RecentWrites>>,
    index: State<'_, Arc<BacklinksIndex>>,
) -> Result<String, String> {
    if !is_valid_forge_name(&name) {
        return Err("Invalid Forge name".to_string());
    }
    let root = get_forges_root();
    let target = root.join(&name);
    if !target.is_dir() {
        return Err(format!("Forge \"{}\" does not exist", name));
    }
    if !looks_like_forge(&target) {
        // It's a plain dir that hasn't been scaffolded — make it a Forge.
        scaffold_forge(&target)?;
    }
    let mut cfg = read_config();
    cfg.forges_root = Some(root.to_string_lossy().to_string());
    cfg.active_forge = Some(name.clone());
    // Clear the deprecated single-Forge field so subsequent reads use the
    // forges_root + active_forge pair only.
    cfg.notes_directory = None;
    write_config(&cfg)?;

    // Tear down old watcher and spin up a new one rooted at the new Forge.
    if let Some(old) = app.try_state::<WatcherHandle>() {
        old.shutdown();
    }
    recent.clear();
    if let Ok(handle) = forge_watcher::spawn(app.clone(), recent.inner().clone()) {
        // Replace the managed handle. tauri::Manager::manage replaces existing.
        app.manage(handle);
    }
    // Rebuild the backlinks index off-thread so the UI doesn't block.
    let idx = index.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        idx.rebuild_from_disk();
    });

    Ok(name)
}

#[tauri::command]
pub(crate) fn rename_forge(old_name: String, new_name: String) -> Result<ForgeInfo, String> {
    if !is_valid_forge_name(&old_name) || !is_valid_forge_name(&new_name) {
        return Err("Invalid Forge name".to_string());
    }
    if old_name == new_name {
        let root = get_forges_root();
        let path = root.join(&old_name);
        return Ok(ForgeInfo {
            name: old_name,
            path: path.to_string_lossy().to_string(),
            is_active: get_active_forge_name() == new_name,
        });
    }
    let root = get_forges_root();
    let from = root.join(&old_name);
    let to = root.join(&new_name);
    if !from.is_dir() {
        return Err(format!("Forge \"{}\" does not exist", old_name));
    }
    if to.exists() {
        return Err(format!("A Forge named \"{}\" already exists", new_name));
    }
    fs::rename(&from, &to).map_err(|e| format!("Failed to rename Forge: {}", e))?;

    // If the renamed Forge was active, update the config so it stays active
    // under the new name.
    let mut cfg = read_config();
    if cfg.active_forge.as_deref() == Some(old_name.as_str()) {
        cfg.active_forge = Some(new_name.clone());
        write_config(&cfg)?;
    }

    Ok(ForgeInfo {
        name: new_name.clone(),
        path: to.to_string_lossy().to_string(),
        is_active: read_config().active_forge.as_deref() == Some(new_name.as_str()),
    })
}

#[tauri::command]
pub(crate) fn delete_forge(name: String) -> Result<(), String> {
    if !is_valid_forge_name(&name) {
        return Err("Invalid Forge name".to_string());
    }
    if get_active_forge_name() == name {
        return Err("Cannot delete the active Forge — switch first".to_string());
    }
    let root = get_forges_root();
    let path = root.join(&name);
    if !path.is_dir() {
        return Err(format!("Forge \"{}\" does not exist", name));
    }
    fs::remove_dir_all(&path).map_err(|e| format!("Failed to delete Forge: {}", e))?;
    Ok(())
}

#[tauri::command]
pub(crate) fn set_forges_root(path: String) -> Result<String, String> {
    let new_root = PathBuf::from(&path);
    if !new_root.is_absolute() {
        return Err("Path must be absolute".to_string());
    }
    let canonical = match new_root.canonicalize() {
        Ok(p) => p,
        Err(_) => new_root
            .parent()
            .and_then(|p| p.canonicalize().ok())
            .unwrap_or_else(|| new_root.clone()),
    };
    let path_str = canonical.to_string_lossy().to_lowercase();
    let forbidden = [
        "/system",
        "/usr",
        "/bin",
        "/sbin",
        "/etc",
        "/var",
        "/private/var",
        "/private/etc",
        "/library",
        "/applications",
        "/cores",
        "/dev",
    ];
    for f in &forbidden {
        if path_str.starts_with(f) {
            return Err("Cannot use system directories".to_string());
        }
    }
    let home = dirs::home_dir().ok_or("Could not determine home directory")?;
    let canonical_home = home.canonicalize().unwrap_or(home.clone());
    if !canonical.starts_with(&canonical_home) && !canonical.starts_with("/Volumes/") {
        return Err("Forges root must be in your home folder or on an external volume".to_string());
    }

    fs::create_dir_all(&new_root).map_err(|e| format!("Failed to create root: {}", e))?;
    let mut cfg = read_config();
    cfg.forges_root = Some(canonical.to_string_lossy().to_string());
    write_config(&cfg)?;
    Ok(canonical.to_string_lossy().to_string())
}

#[tauri::command]
pub(crate) fn get_forges_root_path() -> String {
    get_forges_root().to_string_lossy().to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn valid_forge_names() {
        assert!(is_valid_forge_name("Personal"));
        assert!(is_valid_forge_name("Work-2024"));
        assert!(is_valid_forge_name("My Forge"));
    }

    #[test]
    fn invalid_forge_names() {
        assert!(!is_valid_forge_name(""));
        assert!(!is_valid_forge_name(".hidden"));
        assert!(!is_valid_forge_name("../escape"));
        assert!(!is_valid_forge_name("a/b"));
        assert!(!is_valid_forge_name("a\0b"));
        let too_long: String = "x".repeat(80);
        assert!(!is_valid_forge_name(&too_long));
    }

    #[test]
    fn looks_like_forge_detects_subdirs() {
        let tmp = std::env::temp_dir().join(format!(
            "moldavite-forge-detect-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir_all(tmp.join("daily")).unwrap();
        assert!(looks_like_forge(&tmp));
        let _ = fs::remove_dir_all(&tmp);

        let tmp2 = std::env::temp_dir().join(format!(
            "moldavite-forge-detect2-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir_all(&tmp2).unwrap();
        assert!(!looks_like_forge(&tmp2));
        let _ = fs::remove_dir_all(&tmp2);
    }

    #[test]
    fn scaffold_creates_subdirs() {
        let tmp = std::env::temp_dir().join(format!(
            "moldavite-scaffold-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        scaffold_forge(&tmp).unwrap();
        for sub in ["daily", "notes", "weekly", "templates", ".trash"] {
            assert!(tmp.join(sub).is_dir(), "missing {}", sub);
        }
        let _ = fs::remove_dir_all(&tmp);
    }
}

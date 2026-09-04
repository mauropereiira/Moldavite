//! Forge management commands: list, create, rename, delete, set-active,
//! set forges root.
//!
//! A "Forge" is a directory under `forges_root` that contains a notes tree
//! (`daily/`, `notes/`, etc.). Switching the active Forge swaps the entire
//! root path that the rest of the backend resolves through `paths::get_notes_dir`.
//! Forge names are single safe directory components; successful switches also
//! rebuild Forge-scoped indexes and restart the watcher before consumers proceed.

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use tauri::{AppHandle, Manager, State};

use crate::backlinks_index::BacklinksIndex;
use crate::forge_watcher::{self, RecentWrites, WatcherSlot};
use crate::paths::{get_active_forge_name, get_forges_root, DEFAULT_FORGE_NAME};
use crate::persist::{read_config, write_config};
use crate::types::ForgeInfo;
use crate::validation::{is_safe_filename, validate_path_within_base};

/// A directory looks like a Forge if it contains at least one of the
/// expected note subdirs.
pub(crate) fn looks_like_forge(dir: &Path) -> bool {
    if fs::symlink_metadata(dir)
        .map(|metadata| metadata.file_type().is_symlink())
        .unwrap_or(true)
    {
        return false;
    }
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

fn ensure_forge_at(path: &Path) -> Result<PathBuf, String> {
    if fs::symlink_metadata(path)
        .map(|metadata| metadata.file_type().is_symlink())
        .unwrap_or(false)
    {
        return Err("Refusing to use a symlinked Forge".to_string());
    }
    if !path.is_dir() {
        scaffold_forge(path)?;
    }
    Ok(path.to_path_buf())
}

pub(crate) fn ensure_active_forge() -> Result<PathBuf, String> {
    let root = get_forges_root();
    let name = get_active_forge_name();
    ensure_forge_at(&root.join(name))
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
    validate_path_within_base(&target, &root)
        .map_err(|_| "Refusing to use a symlinked Forge".to_string())?;
    if !target.is_dir() {
        return Err(format!("Forge \"{}\" does not exist", name));
    }
    if !looks_like_forge(&target) {
        // It's a plain dir that hasn't been scaffolded — make it a Forge.
        validate_path_within_base(&target, &root)
            .map_err(|_| "Refusing to use a symlinked Forge".to_string())?;
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
    let slot = app.try_state::<WatcherSlot>();
    // Stop the old watcher before clearing `recent`, so an event still in
    // flight from the previous Forge cannot repopulate it after the clear.
    if let Some(slot) = &slot {
        slot.replace(None);
    }
    recent.clear();
    match forge_watcher::spawn(app.clone(), recent.inner().clone()) {
        Ok(handle) => {
            if let Some(slot) = &slot {
                slot.replace(Some(handle));
            }
        }
        Err(e) => log::warn!("[forge] watcher respawn failed: {}", e),
    }
    // Rebuild the backlinks index off-thread so the UI doesn't block.
    let idx = index.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        idx.rebuild_from_disk();
    });
    // Swap the semantic index over to the new Forge (async, no-op if the
    // feature is disabled).
    crate::commands::semantic::on_forge_switched(app.clone());
    // The keyword index is per-Forge and lives outside the vault; reconcile
    // the incoming one off-thread. Search falls back to the scan until it lands.
    crate::search_index::spawn_reconcile(target);

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
    // Before the directory goes: the index is filed under the hash of the
    // Forge's canonical path, which stops resolving once it is gone.
    crate::search_index::delete_for(&path);
    delete_forge_dir(&path)
}

/// Remove a Forge directory, refusing a symlinked leaf so `remove_dir_all`
/// can never be pointed at an arbitrary target through a symlink named like
/// a Forge.
fn delete_forge_dir(path: &Path) -> Result<(), String> {
    if fs::symlink_metadata(path)
        .map(|metadata| metadata.file_type().is_symlink())
        .unwrap_or(false)
    {
        return Err("Refusing to delete a symlinked Forge".to_string());
    }
    fs::remove_dir_all(path).map_err(|e| format!("Failed to delete Forge: {}", e))?;
    Ok(())
}

#[derive(Clone, Copy)]
pub(crate) enum StorageLocationKind {
    ForgesRoot,
    /// Validation rules for a single Forge directory rather than the root that
    /// holds them all — chiefly, refusing to sit a Forge inside a system or
    /// cloud-managed location.
    ///
    /// Nothing in the app constructs this today: its only caller was
    /// `set_notes_directory`, removed in 2.0 for fragmenting Forges. The rules
    /// and their tests are kept because they are the specification any future
    /// Forge-mover has to satisfy, and rewriting them from memory later is how
    /// a guard comes back weaker than it went out.
    #[allow(dead_code)]
    NotesDirectory,
}

#[derive(Clone, Copy)]
enum LocationPlatform {
    MacOs,
    Windows,
    Linux,
}

pub(crate) fn strip_windows_verbatim_prefix(path: &Path) -> PathBuf {
    let value = path.to_string_lossy();
    if value
        .get(..8)
        .is_some_and(|prefix| prefix.eq_ignore_ascii_case(r"\\?\UNC\"))
    {
        return PathBuf::from(format!(r"\\{}", &value[8..]));
    }
    if let Some(without_prefix) = value.strip_prefix(r"\\?\") {
        return PathBuf::from(without_prefix);
    }
    path.to_path_buf()
}

fn normalize_windows_path(path: &Path) -> String {
    strip_windows_verbatim_prefix(path)
        .to_string_lossy()
        .replace('/', "\\")
        .trim_end_matches('\\')
        .to_lowercase()
}

fn windows_path_has_valid_shape(path: &Path) -> bool {
    let path = strip_windows_verbatim_prefix(path)
        .to_string_lossy()
        .replace('/', "\\");
    if path
        .split('\\')
        .any(|component| matches!(component, "." | ".."))
    {
        return false;
    }

    let bytes = path.as_bytes();
    let is_drive_absolute =
        bytes.len() >= 3 && bytes[0].is_ascii_alphabetic() && bytes[1] == b':' && bytes[2] == b'\\';
    if is_drive_absolute {
        return true;
    }

    let Some(share) = path.strip_prefix(r"\\") else {
        return false;
    };
    let mut components = share.split('\\');
    components.next().is_some_and(|server| !server.is_empty())
        && components.next().is_some_and(|share| !share.is_empty())
}

fn windows_path_is_within(candidate: &str, root: &str) -> bool {
    candidate == root
        || candidate
            .strip_prefix(root)
            .is_some_and(|suffix| suffix.starts_with('\\'))
}

fn macos_forbidden_prefixes(kind: StorageLocationKind) -> &'static [&'static str] {
    const FORGES_ROOT: &[&str] = &[
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
    const NOTES_DIRECTORY: &[&str] = &[
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
        "/tmp",
        "/private/tmp",
    ];

    match kind {
        StorageLocationKind::ForgesRoot => FORGES_ROOT,
        StorageLocationKind::NotesDirectory => NOTES_DIRECTORY,
    }
}

fn system_directory_error(kind: StorageLocationKind, platform: LocationPlatform) -> String {
    match (kind, platform) {
        (StorageLocationKind::ForgesRoot, LocationPlatform::MacOs) => {
            "Cannot use system directories".to_string()
        }
        (StorageLocationKind::NotesDirectory, LocationPlatform::MacOs) => {
            "Cannot use system directories for notes storage".to_string()
        }
        (StorageLocationKind::ForgesRoot, LocationPlatform::Windows) => {
            "Forges root cannot be inside Windows system directories".to_string()
        }
        (StorageLocationKind::NotesDirectory, LocationPlatform::Windows) => {
            "Notes directory cannot be inside Windows system directories".to_string()
        }
        (StorageLocationKind::ForgesRoot, LocationPlatform::Linux) => {
            "Forges root cannot be inside Linux system directories".to_string()
        }
        (StorageLocationKind::NotesDirectory, LocationPlatform::Linux) => {
            "Notes directory cannot be inside Linux system directories".to_string()
        }
    }
}

fn validate_storage_location_for_platform(
    candidate: &Path,
    home: Option<&Path>,
    windows_system_directories: &[PathBuf],
    platform: LocationPlatform,
    kind: StorageLocationKind,
) -> Result<(), String> {
    match platform {
        LocationPlatform::MacOs => {
            let path_str = candidate.to_string_lossy().to_lowercase();
            if macos_forbidden_prefixes(kind)
                .iter()
                .any(|prefix| path_str.starts_with(prefix))
            {
                return Err(system_directory_error(kind, platform));
            }

            let home = home.ok_or("Could not determine home directory")?;
            if !candidate.starts_with(home) && !candidate.starts_with("/Volumes/") {
                return Err(match kind {
                    StorageLocationKind::ForgesRoot => {
                        "Forges root must be in your home folder or on an external volume"
                            .to_string()
                    }
                    StorageLocationKind::NotesDirectory => {
                        "Notes directory must be in your home folder or on an external volume"
                            .to_string()
                    }
                });
            }
        }
        LocationPlatform::Windows => {
            if !windows_path_has_valid_shape(candidate) {
                return Err(match kind {
                    StorageLocationKind::ForgesRoot => {
                        "Forges root must be an absolute drive or UNC path without . or .. components"
                            .to_string()
                    }
                    StorageLocationKind::NotesDirectory => {
                        "Notes directory must be an absolute drive or UNC path without . or .. components"
                            .to_string()
                    }
                });
            }

            let candidate = normalize_windows_path(candidate);
            const BASELINE_SYSTEM_DIRECTORIES: &[&str] = &[
                r"C:\Windows",
                r"C:\Program Files",
                r"C:\Program Files (x86)",
                r"C:\ProgramData",
            ];
            let is_system_directory = BASELINE_SYSTEM_DIRECTORIES
                .iter()
                .map(|root| normalize_windows_path(Path::new(root)))
                .chain(
                    windows_system_directories
                        .iter()
                        .map(|root| normalize_windows_path(root)),
                )
                .any(|root| !root.is_empty() && windows_path_is_within(&candidate, &root));
            if is_system_directory {
                return Err(system_directory_error(kind, platform));
            }
        }
        LocationPlatform::Linux => {
            const FORBIDDEN: &[&str] = &[
                "/usr", "/bin", "/sbin", "/etc", "/boot", "/proc", "/sys", "/dev",
            ];
            if FORBIDDEN.iter().any(|root| candidate.starts_with(root)) {
                return Err(system_directory_error(kind, platform));
            }

            let home = home.ok_or("Could not determine home directory")?;
            let is_valid_location = candidate.starts_with(home)
                || ["/mnt", "/media", "/run/media"]
                    .iter()
                    .any(|root| candidate.starts_with(root));
            if !is_valid_location {
                return Err(match kind {
                    StorageLocationKind::ForgesRoot => {
                        "Forges root must be in your home folder or under /mnt, /media, or /run/media"
                            .to_string()
                    }
                    StorageLocationKind::NotesDirectory => {
                        "Notes directory must be in your home folder or under /mnt, /media, or /run/media"
                            .to_string()
                    }
                });
            }
        }
    }

    Ok(())
}

pub(crate) fn validate_storage_location(
    candidate: &Path,
    kind: StorageLocationKind,
) -> Result<PathBuf, String> {
    let candidate = strip_windows_verbatim_prefix(candidate);
    let canonical_home = dirs::home_dir().map(|home| home.canonicalize().unwrap_or(home));
    let system_directories: Vec<PathBuf> = [
        "SystemRoot",
        "ProgramFiles",
        "ProgramFiles(x86)",
        "ProgramData",
    ]
    .iter()
    .filter_map(std::env::var_os)
    .map(PathBuf::from)
    .collect();
    let platform = if cfg!(target_os = "windows") {
        LocationPlatform::Windows
    } else if cfg!(target_os = "macos") {
        LocationPlatform::MacOs
    } else {
        LocationPlatform::Linux
    };
    validate_storage_location_for_platform(
        &candidate,
        canonical_home.as_deref(),
        &system_directories,
        platform,
        kind,
    )?;
    Ok(candidate)
}

#[tauri::command]
pub(crate) fn set_forges_root(path: String) -> Result<String, String> {
    let new_root = PathBuf::from(&path);
    if !new_root.is_absolute() {
        return Err("Path must be absolute".to_string());
    }
    let canonical = match new_root.canonicalize() {
        Ok(p) => p,
        Err(_) => {
            let parent = new_root
                .parent()
                .ok_or_else(|| "Path must have a parent directory".to_string())?
                .canonicalize()
                .map_err(|e| format!("Failed to resolve parent directory: {}", e))?;
            let name = new_root
                .file_name()
                .ok_or_else(|| "Path must name a directory".to_string())?;
            parent.join(name)
        }
    };
    let canonical = validate_storage_location(&canonical, StorageLocationKind::ForgesRoot)?;

    fs::create_dir_all(&canonical).map_err(|e| format!("Failed to create root: {}", e))?;
    ensure_forge_at(&canonical.join(DEFAULT_FORGE_NAME))?;
    let mut cfg = read_config();
    cfg.forges_root = Some(canonical.to_string_lossy().to_string());
    cfg.notes_directory = None;
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

    #[cfg(unix)]
    #[test]
    fn security_regression_symlinked_forge_is_never_accepted() {
        use std::os::unix::fs::symlink;

        let tmp = std::env::temp_dir().join(format!(
            "moldavite-forge-symlink-target-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let outside = tmp.join("outside");
        let link = tmp.join("LinkedForge");
        fs::create_dir_all(outside.join("daily")).unwrap();
        symlink(&outside, &link).unwrap();

        assert!(!looks_like_forge(&link));
        assert_eq!(
            ensure_forge_at(&link),
            Err("Refusing to use a symlinked Forge".to_string())
        );
        let _ = fs::remove_dir_all(&tmp);
    }

    #[cfg(unix)]
    #[test]
    fn security_regression_delete_forge_rejects_symlinked_leaf() {
        use std::os::unix::fs::symlink;

        let tmp = std::env::temp_dir().join(format!(
            "moldavite-delete-forge-symlink-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let target = tmp.join("target");
        let link = tmp.join("LinkedForge");
        fs::create_dir_all(target.join("daily")).unwrap();
        fs::write(target.join("daily/keep.md"), "keep").unwrap();
        symlink(&target, &link).unwrap();

        assert_eq!(
            delete_forge_dir(&link),
            Err("Refusing to delete a symlinked Forge".to_string())
        );
        assert!(target.join("daily/keep.md").exists());
        assert_eq!(
            fs::read_to_string(target.join("daily/keep.md")).unwrap(),
            "keep"
        );

        let _ = fs::remove_dir_all(&tmp);
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

    #[test]
    fn ensure_forge_scaffolds_missing_path() {
        let tmp = std::env::temp_dir().join(format!(
            "moldavite-ensure-forge-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));

        assert_eq!(ensure_forge_at(&tmp), Ok(tmp.clone()));
        for sub in ["daily", "notes", "weekly", "templates", ".trash"] {
            assert!(tmp.join(sub).is_dir(), "missing {}", sub);
        }

        let _ = fs::remove_dir_all(&tmp);
    }

    #[cfg(unix)]
    #[test]
    fn ensure_forge_rejects_symlink_without_creating_target() {
        use std::os::unix::fs::symlink;

        let base = std::env::temp_dir().join(format!(
            "moldavite-ensure-forge-symlink-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let target = base.join("target");
        let forge = base.join("Default");
        fs::create_dir_all(&base).unwrap();
        symlink(&target, &forge).unwrap();

        assert_eq!(
            ensure_forge_at(&forge),
            Err("Refusing to use a symlinked Forge".to_string())
        );
        assert!(!target.exists());

        let _ = fs::remove_dir_all(&base);
    }

    #[test]
    fn macos_storage_policy_is_unchanged() {
        let home = Path::new("/Users/mauro");
        assert!(validate_storage_location_for_platform(
            Path::new("/Users/mauro/Documents/Moldavite"),
            Some(home),
            &[],
            LocationPlatform::MacOs,
            StorageLocationKind::ForgesRoot,
        )
        .is_ok());
        assert!(validate_storage_location_for_platform(
            Path::new("/Volumes/External/Moldavite"),
            Some(home),
            &[],
            LocationPlatform::MacOs,
            StorageLocationKind::NotesDirectory,
        )
        .is_ok());
        assert_eq!(
            validate_storage_location_for_platform(
                Path::new("/System/Library/Moldavite"),
                Some(home),
                &[],
                LocationPlatform::MacOs,
                StorageLocationKind::ForgesRoot,
            ),
            Err("Cannot use system directories".to_string())
        );
        assert_eq!(
            validate_storage_location_for_platform(
                Path::new("/Users/someone-else/Moldavite"),
                Some(home),
                &[],
                LocationPlatform::MacOs,
                StorageLocationKind::NotesDirectory,
            ),
            Err("Notes directory must be in your home folder or on an external volume".to_string())
        );
    }

    #[test]
    fn windows_storage_policy_accepts_non_system_drive() {
        assert!(validate_storage_location_for_platform(
            Path::new(r"D:\Notes"),
            None,
            &[],
            LocationPlatform::Windows,
            StorageLocationKind::ForgesRoot,
        )
        .is_ok());
        assert!(validate_storage_location_for_platform(
            Path::new(r"\\server\share\Moldavite"),
            None,
            &[],
            LocationPlatform::Windows,
            StorageLocationKind::NotesDirectory,
        )
        .is_ok());
        assert!(validate_storage_location_for_platform(
            Path::new(r"C:\Program Files-old\Moldavite"),
            None,
            &[],
            LocationPlatform::Windows,
            StorageLocationKind::ForgesRoot,
        )
        .is_ok());
    }

    #[test]
    fn windows_storage_policy_rejects_unresolved_traversal() {
        assert!(validate_storage_location_for_platform(
            Path::new(r"D:\missing-parent\..\Notes"),
            None,
            &[],
            LocationPlatform::Windows,
            StorageLocationKind::NotesDirectory,
        )
        .is_err());
    }

    #[test]
    fn windows_storage_policy_uses_baseline_when_environment_is_absent() {
        assert!(validate_storage_location_for_platform(
            Path::new(r"C:\Windows\System32"),
            None,
            &[],
            LocationPlatform::Windows,
            StorageLocationKind::ForgesRoot,
        )
        .is_err());
    }

    #[test]
    fn windows_storage_policy_rejects_system_directories() {
        let system_directories = vec![
            PathBuf::from(r"D:\Windows"),
            PathBuf::from(r"D:\Program Files"),
            PathBuf::from(r"D:\Program Files (x86)"),
        ];
        assert!(validate_storage_location_for_platform(
            Path::new(r"\\?\D:\WINDOWS\System32"),
            None,
            &system_directories,
            LocationPlatform::Windows,
            StorageLocationKind::ForgesRoot,
        )
        .is_err());
        assert!(validate_storage_location_for_platform(
            Path::new(r"D:\Program Files\Moldavite"),
            None,
            &system_directories,
            LocationPlatform::Windows,
            StorageLocationKind::NotesDirectory,
        )
        .is_err());
    }

    #[test]
    fn linux_storage_policy_accepts_home_and_mount_points() {
        let home = Path::new("/home/mauro");
        for candidate in [
            "/home/mauro/Documents/Moldavite",
            "/mnt/storage/Moldavite",
            "/media/mauro/drive/Moldavite",
            "/run/media/mauro/drive/Moldavite",
        ] {
            assert!(validate_storage_location_for_platform(
                Path::new(candidate),
                Some(home),
                &[],
                LocationPlatform::Linux,
                StorageLocationKind::ForgesRoot,
            )
            .is_ok());
        }
    }

    #[test]
    fn linux_storage_policy_rejects_system_and_other_trees() {
        let home = Path::new("/home/mauro");
        assert_eq!(
            validate_storage_location_for_platform(
                Path::new("/usr/local/share/Moldavite"),
                Some(home),
                &[],
                LocationPlatform::Linux,
                StorageLocationKind::ForgesRoot,
            ),
            Err("Forges root cannot be inside Linux system directories".to_string())
        );
        assert_eq!(
            validate_storage_location_for_platform(
                Path::new("/srv/Moldavite"),
                Some(home),
                &[],
                LocationPlatform::Linux,
                StorageLocationKind::NotesDirectory,
            ),
            Err(
                "Notes directory must be in your home folder or under /mnt, /media, or /run/media"
                    .to_string()
            )
        );
    }

    #[test]
    fn strips_windows_verbatim_prefix() {
        assert_eq!(
            strip_windows_verbatim_prefix(Path::new(r"\\?\C:\Users\me\Documents\Moldavite")),
            PathBuf::from(r"C:\Users\me\Documents\Moldavite")
        );
        assert_eq!(
            strip_windows_verbatim_prefix(Path::new(r"\\?\UNC\server\share\Moldavite")),
            PathBuf::from(r"\\server\share\Moldavite")
        );
    }
}

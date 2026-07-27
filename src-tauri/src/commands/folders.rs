//! Standalone-note folder enumeration and mutation commands.
//!
//! Folder arguments are always relative to `notes/`; daily and weekly trees are
//! outside this module's ownership. Mutations reject traversal and symlink
//! escapes, preserve nested contents on moves, and return relative paths for the
//! frontend addressing model.

use std::fs;
use std::path::Path;

use crate::paths::get_standalone_dir;
use crate::persist::generate_unique_folder_name;
use crate::types::FolderInfo;
use crate::validation::{is_safe_note_path, validate_path_within_base};

// Folder System Helper Functions

pub(crate) fn scan_folders_recursive(dir: &Path, relative_path: &str) -> Vec<FolderInfo> {
    let mut folders = Vec::new();

    if let Ok(entries) = fs::read_dir(dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            // Skip symlinks so we can't be redirected out of the notes tree.
            if fs::symlink_metadata(&path).map(|m| m.file_type().is_symlink()).unwrap_or(false) {
                continue;
            }
            if path.is_dir() {
                let name = path.file_name()
                    .and_then(|s| s.to_str())
                    .unwrap_or("")
                    .to_string();

                // Skip hidden directories
                if name.starts_with('.') {
                    continue;
                }

                let folder_relative_path = if relative_path.is_empty() {
                    name.clone()
                } else {
                    format!("{}/{}", relative_path, name)
                };

                // Recursively scan subdirectories
                let children = scan_folders_recursive(&path, &folder_relative_path);

                folders.push(FolderInfo {
                    name,
                    path: folder_relative_path,
                    children,
                });
            }
        }
    }

    // Sort folders alphabetically
    folders.sort_by_key(|a| a.name.to_lowercase());

    folders
}

// Folder System Commands

#[tauri::command]
pub(crate) fn list_folders() -> Result<Vec<FolderInfo>, String> {
    let standalone_dir = get_standalone_dir();

    if !standalone_dir.exists() {
        return Ok(Vec::new());
    }

    Ok(scan_folders_recursive(&standalone_dir, ""))
}

#[tauri::command]
pub(crate) fn create_folder(path: String) -> Result<(), String> {
    let standalone_dir = get_standalone_dir();
    let folder_path = standalone_dir.join(&path);

    // Validate path - prevent path traversal
    if path.contains("..") {
        return Err("Invalid folder path".to_string());
    }

    // Create the folder (and any parent folders)
    fs::create_dir_all(&folder_path)
        .map_err(|e| format!("Failed to create folder: {}", e))?;

    // Set restrictive permissions
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let permissions = fs::Permissions::from_mode(0o700);
        fs::set_permissions(&folder_path, permissions).ok();
    }

    Ok(())
}

#[tauri::command]
pub(crate) fn rename_folder(old_path: String, new_name: String) -> Result<String, String> {
    let standalone_dir = get_standalone_dir();
    let old_folder_path = standalone_dir.join(&old_path);

    // Validate inputs
    if old_path.contains("..") || new_name.contains('/') || new_name.contains('\\') {
        return Err("Invalid folder path or name".to_string());
    }

    if !old_folder_path.exists() {
        return Err("Folder not found".to_string());
    }

    // Calculate new path (same parent directory, new name)
    let parent = old_folder_path.parent()
        .ok_or_else(|| "Cannot rename root folder".to_string())?;
    let new_folder_path = parent.join(&new_name);

    if new_folder_path.exists() {
        return Err("A folder with this name already exists".to_string());
    }

    fs::rename(&old_folder_path, &new_folder_path)
        .map_err(|e| format!("Failed to rename folder: {}", e))?;

    // Return the new relative path
    let new_relative_path = new_folder_path
        .strip_prefix(&standalone_dir)
        .map_err(|_| "Failed to compute new path".to_string())?
        .to_string_lossy()
        .to_string();

    Ok(new_relative_path)
}

#[tauri::command]
pub(crate) fn delete_folder(path: String, force: bool) -> Result<(), String> {
    let standalone_dir = get_standalone_dir();
    delete_folder_from(&standalone_dir, &path, force)
}

fn delete_folder_from(standalone_dir: &Path, path: &str, force: bool) -> Result<(), String> {
    if !is_safe_note_path(path) {
        return Err("Invalid folder path".to_string());
    }
    let folder_path = standalone_dir.join(path);
    validate_path_within_base(&folder_path, standalone_dir)
        .map_err(|_| "Invalid folder path".to_string())?;

    if !folder_path.exists() {
        return Ok(()); // Already deleted
    }

    // Check if folder is empty (unless force is true)
    if !force {
        let has_contents = fs::read_dir(&folder_path)
            .map(|mut entries| entries.next().is_some())
            .unwrap_or(false);

        if has_contents {
            return Err("Folder is not empty. Use force=true to delete anyway.".to_string());
        }
    }

    if force {
        fs::remove_dir_all(&folder_path)
            .map_err(|e| format!("Failed to delete folder: {}", e))?;
    } else {
        fs::remove_dir(&folder_path)
            .map_err(|e| format!("Failed to delete folder: {}", e))?;
    }

    Ok(())
}

/// Move a folder (and all its contents) to another folder or to root.
/// Handles naming conflicts by appending (2), (3), etc.
#[tauri::command]
pub(crate) fn move_folder(folder_path: String, to_folder: Option<String>) -> Result<String, String> {
    let standalone_dir = get_standalone_dir();
    move_folder_from(&standalone_dir, &folder_path, to_folder.as_deref())
}

fn move_folder_from(
    standalone_dir: &Path,
    folder_path: &str,
    to_folder: Option<&str>,
) -> Result<String, String> {
    if !is_safe_note_path(folder_path) {
        return Err("Invalid folder path".to_string());
    }
    if let Some(dest) = to_folder {
        if !is_safe_note_path(dest) {
            return Err("Invalid destination path".to_string());
        }
    }

    let source_path = standalone_dir.join(folder_path);
    validate_path_within_base(&source_path, standalone_dir)
        .map_err(|_| "Invalid folder path".to_string())?;

    if !source_path.exists() {
        return Err("Folder not found".to_string());
    }

    if !source_path.is_dir() {
        return Err("Path is not a folder".to_string());
    }

    // Get the folder name
    let folder_name = source_path.file_name()
        .ok_or_else(|| "Invalid folder path".to_string())?
        .to_string_lossy()
        .to_string();

    // Calculate destination parent directory
    let dest_parent = match to_folder {
        Some(dest) => standalone_dir.join(dest),
        None => standalone_dir.to_path_buf(),
    };
    if to_folder.is_some() {
        validate_path_within_base(&dest_parent, standalone_dir)
            .map_err(|_| "Invalid destination path".to_string())?;
    }

    // Ensure destination parent exists
    if !dest_parent.exists() {
        return Err("Destination folder does not exist".to_string());
    }

    // Prevent moving folder into itself or its descendants
    if let Some(dest) = to_folder {
        if dest == folder_path || dest.starts_with(&format!("{}/", folder_path)) {
            return Err("Cannot move folder into itself or its subfolder".to_string());
        }
    }

    // Check if we're moving to the same parent (no-op)
    let source_parent = source_path.parent()
        .map(|p| p.to_path_buf())
        .unwrap_or_else(|| standalone_dir.to_path_buf());
    if source_parent == dest_parent {
        return Ok(folder_path.to_string()); // Already in the right place
    }

    // Generate unique folder name if needed
    let final_name = generate_unique_folder_name(&dest_parent, &folder_name);
    let dest_path = dest_parent.join(&final_name);
    validate_path_within_base(&dest_path, standalone_dir)
        .map_err(|_| "Invalid destination path".to_string())?;

    // Move the folder
    fs::rename(&source_path, &dest_path)
        .map_err(|e| format!("Failed to move folder: {}", e))?;

    // Return new relative path
    let new_relative_path = match to_folder {
        Some(dest) => format!("{}/{}", dest, final_name),
        None => final_name,
    };

    Ok(new_relative_path)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    struct TempDir(PathBuf);

    impl TempDir {
        fn new(tag: &str) -> Self {
            let path = std::env::temp_dir().join(format!(
                "moldavite-folders-{tag}-{}-{}",
                std::process::id(),
                std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .unwrap()
                    .as_nanos()
            ));
            fs::create_dir_all(&path).unwrap();
            Self(path)
        }
    }

    impl Drop for TempDir {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    #[test]
    fn delete_folder_rejects_absolute_and_empty_paths_but_deletes_valid_nested_folder() {
        let tmp = TempDir::new("delete-validation");
        let notes = tmp.0.join("notes");
        let outside = tmp.0.join("outside");
        fs::create_dir_all(notes.join("Projects/Old")).unwrap();
        fs::create_dir_all(&outside).unwrap();
        fs::write(outside.join("keep.txt"), "keep").unwrap();

        assert!(delete_folder_from(&notes, outside.to_str().unwrap(), true).is_err());
        assert!(delete_folder_from(&notes, "", true).is_err());
        assert!(outside.join("keep.txt").exists());

        delete_folder_from(&notes, "Projects/Old", true).unwrap();
        assert!(!notes.join("Projects/Old").exists());
        assert!(notes.join("Projects").exists());
    }

    #[test]
    fn move_folder_rejects_absolute_paths_and_moves_valid_nested_folder() {
        let tmp = TempDir::new("move-validation");
        let notes = tmp.0.join("notes");
        let outside = tmp.0.join("outside");
        fs::create_dir_all(notes.join("Projects/Active")).unwrap();
        fs::create_dir_all(notes.join("Archive")).unwrap();
        fs::create_dir_all(&outside).unwrap();

        assert!(move_folder_from(&notes, outside.to_str().unwrap(), None).is_err());
        assert!(move_folder_from(&notes, "Projects/Active", Some(outside.to_str().unwrap())).is_err());
        assert!(notes.join("Projects/Active").exists());

        let moved = move_folder_from(&notes, "Projects/Active", Some("Archive")).unwrap();
        assert_eq!(moved, "Archive/Active");
        assert!(notes.join("Archive/Active").is_dir());
    }
}

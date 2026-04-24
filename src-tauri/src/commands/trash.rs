//! Trash (recycle bin) commands.

use std::fs;
use std::sync::Arc;

use tauri::State;

use crate::backlinks_index::BacklinksIndex;
use crate::paths::{
    ensure_trash_dir, get_daily_dir, get_standalone_dir, get_trash_dir, get_weekly_dir,
};
use crate::persist::{read_trash_metadata, write_trash_metadata};
use crate::types::{TrashMetadata, TrashedNote, TrashedNoteMetadata};
use crate::validation::{is_safe_filename, validate_path_within_base};

#[tauri::command]
pub(crate) fn trash_note(
    filename: String,
    is_daily: bool,
    is_weekly: bool,
    index: State<'_, Arc<BacklinksIndex>>,
) -> Result<(), String> {
    // Prevent path traversal attacks (rejects .., /, \, absolute paths, null bytes)
    if !is_safe_filename(&filename) {
        return Err("Invalid filename".to_string());
    }

    let source_dir = if is_weekly {
        get_weekly_dir()
    } else if is_daily {
        get_daily_dir()
    } else {
        get_standalone_dir()
    };

    let source_path = source_dir.join(&filename);
    if !source_path.exists() {
        return Err("Note does not exist".to_string());
    }

    // Generate unique ID for trash item
    let id = format!("{}", chrono::Utc::now().timestamp_millis());

    // Create trash directory if needed
    ensure_trash_dir()?;

    // Move file to trash with unique name to avoid conflicts
    let trash_filename = format!("{}_{}", id, filename.replace('/', "_"));
    let trash_path = get_trash_dir().join(&trash_filename);
    fs::rename(&source_path, &trash_path).map_err(|e| format!("Failed to move to trash: {}", e))?;

    // Update metadata
    let mut metadata = read_trash_metadata();
    metadata.items.push(TrashedNoteMetadata {
        id: id.clone(),
        filename: filename.clone(),
        original_path: filename.clone(),
        is_daily,
        is_folder: false,
        contained_files: Vec::new(),
        trashed_at: chrono::Utc::now().timestamp(),
    });
    write_trash_metadata(&metadata)?;

    index.remove_note(&filename);

    Ok(())
}

#[tauri::command]
pub(crate) fn list_trash() -> Result<Vec<TrashedNote>, String> {
    let metadata = read_trash_metadata();
    let now = chrono::Utc::now().timestamp();
    let seven_days_secs = 7 * 24 * 60 * 60;

    let items: Vec<TrashedNote> = metadata.items.iter().map(|item| {
        let elapsed_secs = now - item.trashed_at;
        let remaining_secs = seven_days_secs - elapsed_secs;
        let days_remaining = (remaining_secs as f64 / (24.0 * 60.0 * 60.0)).ceil() as i32;

        TrashedNote {
            id: item.id.clone(),
            filename: item.filename.clone(),
            original_path: item.original_path.clone(),
            is_daily: item.is_daily,
            is_folder: item.is_folder,
            contained_files: item.contained_files.clone(),
            trashed_at: item.trashed_at,
            days_remaining: days_remaining.max(0),
        }
    }).collect();

    Ok(items)
}

/// Read the raw contents of a trashed note for read-only preview.
///
/// Returns an empty string for trashed folders (their contents live on disk
/// but there is no single "file" to preview).
#[tauri::command]
pub(crate) fn read_trashed_note(trash_id: String) -> Result<String, String> {
    let metadata = read_trash_metadata();
    let item = metadata
        .items
        .iter()
        .find(|item| item.id == trash_id)
        .ok_or("Trash item not found")?;

    if item.is_folder {
        return Ok(String::new());
    }

    let trash_filename = format!("{}_{}", item.id, item.original_path.replace('/', "_"));
    let trash_path = get_trash_dir().join(&trash_filename);
    validate_path_within_base(&trash_path, &get_trash_dir())?;

    if !trash_path.exists() {
        return Err("Trash file not found on disk".to_string());
    }

    // Refuse to read locked notes from trash (ciphertext is not useful for preview).
    if trash_path
        .file_name()
        .and_then(|n| n.to_str())
        .is_some_and(|n| n.ends_with(".md.locked"))
    {
        return Err("Locked notes cannot be previewed from trash".to_string());
    }

    fs::read_to_string(&trash_path).map_err(|e| format!("Failed to read trashed note: {}", e))
}

#[tauri::command]
pub(crate) fn restore_note(
    trash_id: String,
    index: State<'_, Arc<BacklinksIndex>>,
) -> Result<(), String> {
    let mut metadata = read_trash_metadata();

    // Find the item in metadata
    let item_index = metadata.items.iter().position(|item| item.id == trash_id)
        .ok_or("Trash item not found")?;

    let item = metadata.items[item_index].clone();

    // Build trash file/folder path
    let trash_filename = format!("{}_{}", item.id, item.original_path.replace('/', "_"));
    let trash_path = get_trash_dir().join(&trash_filename);

    if !trash_path.exists() {
        // Remove from metadata anyway
        metadata.items.remove(item_index);
        write_trash_metadata(&metadata)?;
        return Err("Trash file not found on disk".to_string());
    }

    // Determine destination
    let dest_dir = if item.is_daily {
        get_daily_dir()
    } else {
        get_standalone_dir()
    };

    if item.is_folder {
        // Restore entire folder
        let dest_path = dest_dir.join(&item.original_path);

        // Ensure parent directory exists
        if let Some(parent) = dest_path.parent() {
            fs::create_dir_all(parent).map_err(|e| format!("Failed to create directory: {}", e))?;
        }

        // Move folder back
        fs::rename(&trash_path, &dest_path).map_err(|e| format!("Failed to restore folder: {}", e))?;

        // Re-index every contained .md file by walking the restored folder.
        reindex_folder(&dest_path, &index);
    } else {
        // Ensure parent directory exists for notes in folders
        let dest_path = dest_dir.join(&item.original_path);
        if let Some(parent) = dest_path.parent() {
            fs::create_dir_all(parent).map_err(|e| format!("Failed to create directory: {}", e))?;
        }

        // Move file back
        fs::rename(&trash_path, &dest_path).map_err(|e| format!("Failed to restore: {}", e))?;

        if let Some(name) = dest_path.file_name().and_then(|s| s.to_str()) {
            let content = fs::read_to_string(&dest_path).unwrap_or_default();
            index.update_note(name, &content);
        }
    }

    // Update metadata
    metadata.items.remove(item_index);
    write_trash_metadata(&metadata)?;

    Ok(())
}

fn reindex_folder(dir: &std::path::Path, index: &BacklinksIndex) {
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if fs::symlink_metadata(&path)
            .map(|m| m.file_type().is_symlink())
            .unwrap_or(false)
        {
            continue;
        }
        if path.is_dir() {
            reindex_folder(&path, index);
        } else if path.extension().and_then(|s| s.to_str()) == Some("md") {
            if let Some(name) = path.file_name().and_then(|s| s.to_str()) {
                let content = fs::read_to_string(&path).unwrap_or_default();
                index.update_note(name, &content);
            }
        }
    }
}

#[tauri::command]
pub(crate) fn permanently_delete_trash(trash_id: String) -> Result<(), String> {
    let mut metadata = read_trash_metadata();

    // Find the item in metadata
    let item_index = metadata.items.iter().position(|item| item.id == trash_id)
        .ok_or("Trash item not found")?;

    let item = &metadata.items[item_index];

    // Build trash file/folder path and delete
    let trash_filename = format!("{}_{}", item.id, item.original_path.replace('/', "_"));
    let trash_path = get_trash_dir().join(&trash_filename);

    if trash_path.exists() {
        if item.is_folder {
            fs::remove_dir_all(&trash_path).map_err(|e| format!("Failed to delete folder: {}", e))?;
        } else {
            fs::remove_file(&trash_path).map_err(|e| format!("Failed to delete: {}", e))?;
        }
    }

    // Update metadata
    metadata.items.remove(item_index);
    write_trash_metadata(&metadata)?;

    Ok(())
}

#[tauri::command]
pub(crate) fn empty_trash() -> Result<(), String> {
    let metadata = read_trash_metadata();

    // Delete all files and folders
    for item in &metadata.items {
        let trash_filename = format!("{}_{}", item.id, item.original_path.replace('/', "_"));
        let trash_path = get_trash_dir().join(&trash_filename);
        if trash_path.exists() {
            if item.is_folder {
                let _ = fs::remove_dir_all(&trash_path);
            } else {
                let _ = fs::remove_file(&trash_path);
            }
        }
    }

    // Clear metadata
    write_trash_metadata(&TrashMetadata::default())?;

    Ok(())
}

#[tauri::command]
pub(crate) fn cleanup_old_trash() -> Result<u32, String> {
    let mut metadata = read_trash_metadata();
    let now = chrono::Utc::now().timestamp();
    let seven_days_secs = 7 * 24 * 60 * 60;
    let mut deleted_count = 0u32;

    // Find expired items
    let expired_items: Vec<(usize, bool)> = metadata.items.iter().enumerate()
        .filter(|(_, item)| now - item.trashed_at >= seven_days_secs)
        .map(|(i, item)| (i, item.is_folder))
        .collect();

    // Delete files/folders and remove from metadata (in reverse to maintain indices)
    for (i, is_folder) in expired_items.into_iter().rev() {
        let item = &metadata.items[i];
        let trash_filename = format!("{}_{}", item.id, item.original_path.replace('/', "_"));
        let trash_path = get_trash_dir().join(&trash_filename);

        if trash_path.exists() {
            let result = if is_folder {
                fs::remove_dir_all(&trash_path)
            } else {
                fs::remove_file(&trash_path)
            };
            if result.is_ok() {
                deleted_count += 1;
            }
        }

        metadata.items.remove(i);
    }

    write_trash_metadata(&metadata)?;

    Ok(deleted_count)
}

#[tauri::command]
pub(crate) fn trash_folder(
    path: String,
    index: State<'_, Arc<BacklinksIndex>>,
) -> Result<(), String> {
    // Prevent path traversal attacks
    if path.contains("..") {
        return Err("Invalid folder path".to_string());
    }

    let standalone_dir = get_standalone_dir();
    let source_path = standalone_dir.join(&path);

    if !source_path.exists() {
        return Err("Folder does not exist".to_string());
    }

    if !source_path.is_dir() {
        return Err("Path is not a folder".to_string());
    }

    // Collect list of files in the folder
    let mut contained_files: Vec<String> = Vec::new();
    fn collect_files(dir: &std::path::Path, relative_path: &str, files: &mut Vec<String>) {
        if let Ok(entries) = fs::read_dir(dir) {
            for entry in entries.flatten() {
                let path = entry.path();
                if fs::symlink_metadata(&path).map(|m| m.file_type().is_symlink()).unwrap_or(false) {
                    continue;
                }
                let Some(name) = path.file_name().map(|f| f.to_string_lossy().to_string()) else {
                    continue;
                };
                if path.is_dir() {
                    let sub_path = if relative_path.is_empty() {
                        name.clone()
                    } else {
                        format!("{}/{}", relative_path, name)
                    };
                    collect_files(&path, &sub_path, files);
                } else if path.extension().is_some_and(|ext| ext == "md") {
                    let file_path = if relative_path.is_empty() {
                        name
                    } else {
                        format!("{}/{}", relative_path, name)
                    };
                    files.push(file_path);
                }
            }
        }
    }
    collect_files(&source_path, "", &mut contained_files);

    // Generate unique ID for trash item
    let id = format!("{}", chrono::Utc::now().timestamp_millis());

    // Create trash directory if needed
    ensure_trash_dir()?;

    // Move folder to trash
    let folder_name = source_path.file_name()
        .and_then(|s| s.to_str())
        .unwrap_or(&path)
        .to_string();
    let trash_filename = format!("{}_{}", id, path.replace('/', "_"));
    let trash_path = get_trash_dir().join(&trash_filename);
    fs::rename(&source_path, &trash_path).map_err(|e| format!("Failed to move folder to trash: {}", e))?;

    // Update metadata
    let mut metadata = read_trash_metadata();
    metadata.items.push(TrashedNoteMetadata {
        id: id.clone(),
        filename: folder_name,
        original_path: path,
        is_daily: false,
        is_folder: true,
        contained_files: contained_files.clone(),
        trashed_at: chrono::Utc::now().timestamp(),
    });
    write_trash_metadata(&metadata)?;

    // Remove every trashed note from the backlinks index. `contained_files`
    // entries are relative paths inside the folder; we only care about the
    // leaf .md filename for index keying.
    for rel in &contained_files {
        if let Some(name) = std::path::Path::new(rel)
            .file_name()
            .and_then(|s| s.to_str())
        {
            index.remove_note(name);
        }
    }

    Ok(())
}

#[tauri::command]
pub(crate) fn restore_note_from_folder(
    trash_id: String,
    note_filename: String,
    index: State<'_, Arc<BacklinksIndex>>,
) -> Result<(), String> {
    if !is_safe_filename(&note_filename) {
        return Err("Invalid note filename".to_string());
    }
    let mut metadata = read_trash_metadata();

    // Find the folder item in metadata
    let item_index = metadata.items.iter().position(|item| item.id == trash_id && item.is_folder)
        .ok_or("Trashed folder not found")?;

    let item = &metadata.items[item_index];

    // Build trash folder path
    let trash_folder_name = format!("{}_{}", item.id, item.original_path.replace('/', "_"));
    let trash_folder_path = get_trash_dir().join(&trash_folder_name);

    if !trash_folder_path.exists() {
        return Err("Trashed folder not found on disk".to_string());
    }

    // Find the note file inside the trashed folder
    let note_path_in_trash = trash_folder_path.join(&note_filename);

    if !note_path_in_trash.exists() {
        return Err("Note not found in trashed folder".to_string());
    }

    // Destination is root of standalone notes (not back to original folder)
    let standalone_dir = get_standalone_dir();
    let dest_path = standalone_dir.join(note_path_in_trash.file_name().unwrap());

    // Check if destination already exists
    if dest_path.exists() {
        return Err("A note with this name already exists in the notes folder".to_string());
    }

    // Move just this note to the root
    fs::rename(&note_path_in_trash, &dest_path).map_err(|e| format!("Failed to restore note: {}", e))?;

    // Re-index the restored note.
    if let Some(name) = dest_path.file_name().and_then(|s| s.to_str()) {
        let content = fs::read_to_string(&dest_path).unwrap_or_default();
        index.update_note(name, &content);
    }

    // Update the contained_files list in metadata
    let item = &mut metadata.items[item_index];
    item.contained_files.retain(|f| f != &note_filename);

    // If folder is now empty, remove it from trash entirely
    let remaining_files = fs::read_dir(&trash_folder_path)
        .map(|entries| entries.flatten().count())
        .unwrap_or(0);

    if remaining_files == 0 {
        let _ = fs::remove_dir_all(&trash_folder_path);
        metadata.items.remove(item_index);
    }

    write_trash_metadata(&metadata)?;

    Ok(())
}

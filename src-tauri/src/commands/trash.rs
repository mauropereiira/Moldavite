//! Recycle-bin moves, restores, permanent deletion, and expiry cleanup.
//!
//! A metadata record is the authoritative map from opaque trash id to original
//! note path and type. Moves persist the file and metadata together as closely as
//! possible; restores validate the recorded destination, choose a collision-free
//! name when needed, and then repair backlinks and semantic-index state. Trash
//! ids, not caller-supplied paths, address items after deletion.

use std::fs;
use std::sync::atomic::{AtomicI64, Ordering};
use std::sync::Arc;

use tauri::State;

use crate::backlinks_index::BacklinksIndex;
use crate::paths::{
    ensure_trash_dir, get_daily_dir, get_standalone_dir, get_trash_dir, get_weekly_dir,
};
use crate::persist::{read_trash_metadata, write_trash_metadata};
use crate::types::{TrashMetadata, TrashedNote, TrashedNoteMetadata};
use crate::validation::{
    is_safe_existing_filename, is_safe_existing_note_path, validate_path_within_base,
};

/// Trash retention window before an item is eligible for expiry cleanup.
const TRASH_RETENTION_SECS: i64 = 7 * 24 * 60 * 60;

fn next_trash_id() -> String {
    static LAST_ID: AtomicI64 = AtomicI64::new(0);
    let now = chrono::Utc::now().timestamp_millis();
    let mut previous = LAST_ID.load(Ordering::Relaxed);
    loop {
        let next = now.max(previous.saturating_add(1));
        match LAST_ID.compare_exchange_weak(previous, next, Ordering::SeqCst, Ordering::Relaxed) {
            Ok(_) => return next.to_string(),
            Err(actual) => previous = actual,
        }
    }
}

fn trash_item_filename(id: &str, original_path: &str) -> String {
    #[cfg(windows)]
    {
        // Valid Windows note paths contain none of these characters, so their
        // existing trash filenames are unchanged. Only malformed persisted
        // metadata needs the NTFS-safe mapping.
        windows_safe_trash_item_filename(id, original_path)
    }
    #[cfg(not(windows))]
    {
        // Colons and backslashes are legal filename characters on Unix. Keep
        // the original mapping there so existing trash remains addressable.
        format!("{}_{}", id, original_path.replace('/', "_"))
    }
}

#[cfg(any(windows, test))]
fn windows_safe_trash_item_filename(id: &str, original_path: &str) -> String {
    const MAX_WINDOWS_FILENAME_UNITS: usize = 255;

    let flatten = |value: &str| {
        value
            .chars()
            .map(|character| {
                if character.is_control()
                    || matches!(
                        character,
                        '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|'
                    )
                {
                    '_'
                } else {
                    character
                }
            })
            .collect::<String>()
    };
    let mut filename = format!("{}_{}", flatten(id), flatten(original_path));

    if filename.encode_utf16().count() > MAX_WINDOWS_FILENAME_UNITS {
        let mut units = 0;
        filename = filename
            .chars()
            .take_while(|character| {
                let next = units + character.len_utf16();
                if next > MAX_WINDOWS_FILENAME_UNITS {
                    false
                } else {
                    units = next;
                    true
                }
            })
            .collect();
    }
    if matches!(filename.chars().last(), Some(' ' | '.')) {
        filename.pop();
        filename.push('_');
    }

    filename
}

fn trash_item_path(trash_dir: &std::path::Path, item: &TrashedNoteMetadata) -> std::path::PathBuf {
    trash_dir.join(trash_item_filename(&item.id, &item.original_path))
}

fn restore_item_on_disk(
    trash_dir: &std::path::Path,
    daily_dir: &std::path::Path,
    weekly_dir: &std::path::Path,
    standalone_dir: &std::path::Path,
    item: &TrashedNoteMetadata,
) -> Result<std::path::PathBuf, String> {
    let source = trash_item_path(trash_dir, item);
    validate_path_within_base(&source, trash_dir)
        .map_err(|_| "Invalid trash source".to_string())?;
    if !source.exists() {
        return Err("Trash file not found on disk".to_string());
    }
    let root = if item.is_weekly {
        weekly_dir
    } else if item.is_daily {
        daily_dir
    } else {
        standalone_dir
    };
    let valid_original_path = if item.is_daily || item.is_weekly {
        is_safe_existing_filename(&item.original_path)
    } else {
        is_safe_existing_note_path(&item.original_path)
    };
    if !valid_original_path {
        return Err("Invalid original path in trash metadata".to_string());
    }
    let destination = root.join(&item.original_path);
    let parent = destination
        .parent()
        .ok_or_else(|| "Invalid restore destination".to_string())?;
    let relative_parent = parent
        .strip_prefix(root)
        .map_err(|_| "Invalid restore destination".to_string())?;
    let mut current = root.to_path_buf();
    for component in relative_parent.components() {
        current.push(component);
        match fs::symlink_metadata(&current) {
            Ok(metadata) if metadata.file_type().is_symlink() || !metadata.is_dir() => {
                return Err("Invalid restore destination".to_string())
            }
            Ok(_) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                fs::create_dir(&current).map_err(|e| format!("Failed to create directory: {e}"))?;
            }
            Err(error) => return Err(format!("Failed to inspect restore directory: {error}")),
        }
    }
    validate_path_within_base(&destination, root)
        .map_err(|_| "Invalid restore destination".to_string())?;
    fs::rename(&source, &destination).map_err(|e| format!("Failed to restore: {e}"))?;
    Ok(destination)
}

#[allow(clippy::too_many_arguments)]
fn trash_note_on_disk(
    source_dir: &std::path::Path,
    trash_dir: &std::path::Path,
    filename: &str,
    bare_filename: bool,
    is_daily: bool,
    is_weekly: bool,
    id: &str,
    trashed_at: i64,
) -> Result<TrashedNoteMetadata, String> {
    let valid_source = if bare_filename {
        is_safe_existing_filename(filename)
    } else {
        is_safe_existing_note_path(filename)
    };
    if !valid_source {
        return Err("Invalid filename".to_string());
    }

    let source_path = source_dir.join(filename);
    validate_path_within_base(&source_path, source_dir)
        .map_err(|_| "Invalid filename".to_string())?;
    if !source_path.is_file() {
        return Err("Note does not exist".to_string());
    }

    let trash_path = trash_dir.join(trash_item_filename(id, filename));
    validate_path_within_base(&trash_path, trash_dir)
        .map_err(|_| "Invalid trash destination".to_string())?;
    fs::rename(&source_path, &trash_path)
        .map_err(|error| format!("Failed to move to trash: {error}"))?;

    Ok(TrashedNoteMetadata {
        id: id.to_string(),
        filename: filename.to_string(),
        original_path: filename.to_string(),
        is_daily,
        is_weekly,
        is_folder: false,
        contained_files: Vec::new(),
        trashed_at,
    })
}

#[tauri::command]
pub(crate) fn trash_note(
    filename: String,
    is_daily: bool,
    is_weekly: bool,
    index: State<'_, Arc<BacklinksIndex>>,
) -> Result<String, String> {
    let source_dir = if is_weekly {
        get_weekly_dir()
    } else if is_daily {
        get_daily_dir()
    } else {
        get_standalone_dir()
    };

    // Generate unique ID for trash item
    let id = next_trash_id();

    // Create trash directory if needed
    ensure_trash_dir()?;

    let trash_dir = get_trash_dir();
    let item = trash_note_on_disk(
        &source_dir,
        &trash_dir,
        &filename,
        is_daily || is_weekly,
        is_daily,
        is_weekly,
        &id,
        chrono::Utc::now().timestamp(),
    )?;

    // Update metadata
    let mut metadata = read_trash_metadata();
    metadata.items.push(item);
    write_trash_metadata(&metadata)?;

    let index_name = std::path::Path::new(&filename)
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or(&filename);
    index.remove_note(index_name);
    crate::semantic::note_removed(&crate::semantic::note_rel_path(
        &filename, is_daily, is_weekly,
    ));

    Ok(id)
}

#[tauri::command]
pub(crate) fn list_trash() -> Result<Vec<TrashedNote>, String> {
    let metadata = read_trash_metadata();
    let now = chrono::Utc::now().timestamp();
    let seven_days_secs = TRASH_RETENTION_SECS;

    let items: Vec<TrashedNote> = metadata
        .items
        .iter()
        .map(|item| {
            let elapsed_secs = now - item.trashed_at;
            let remaining_secs = seven_days_secs - elapsed_secs;
            let days_remaining = (remaining_secs as f64 / (24.0 * 60.0 * 60.0)).ceil() as i32;

            TrashedNote {
                id: item.id.clone(),
                filename: item.filename.clone(),
                original_path: item.original_path.clone(),
                is_daily: item.is_daily,
                is_weekly: item.is_weekly,
                is_folder: item.is_folder,
                contained_files: item.contained_files.clone(),
                trashed_at: item.trashed_at,
                days_remaining: days_remaining.max(0),
            }
        })
        .collect();

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

    let trash_dir = get_trash_dir();
    let trash_path = trash_item_path(&trash_dir, item);
    validate_path_within_base(&trash_path, &trash_dir)?;

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
) -> Result<String, String> {
    let mut metadata = read_trash_metadata();

    // Find the item in metadata
    let item_index = metadata
        .items
        .iter()
        .position(|item| item.id == trash_id)
        .ok_or("Trash item not found")?;

    let item = metadata.items[item_index].clone();

    let trash_path = trash_item_path(&get_trash_dir(), &item);

    if !trash_path.exists() {
        // Remove from metadata anyway
        metadata.items.remove(item_index);
        write_trash_metadata(&metadata)?;
        return Err("Trash file not found on disk".to_string());
    }

    let restored_path = if item.is_folder {
        let dest_path = restore_item_on_disk(
            &get_trash_dir(),
            &get_daily_dir(),
            &get_weekly_dir(),
            &get_standalone_dir(),
            &item,
        )?;

        // Re-index every contained .md file by walking the restored folder.
        reindex_folder(&dest_path, &index);
        crate::semantic::notes_changed(
            item.contained_files
                .iter()
                .map(|f| format!("notes/{}/{}", item.original_path, f))
                .collect(),
        );
        format!("notes/{}", item.original_path)
    } else {
        let dest_path = restore_item_on_disk(
            &get_trash_dir(),
            &get_daily_dir(),
            &get_weekly_dir(),
            &get_standalone_dir(),
            &item,
        )?;

        if let Some(name) = dest_path.file_name().and_then(|s| s.to_str()) {
            let content = fs::read_to_string(&dest_path).unwrap_or_default();
            index.update_note(name, &content);
        }
        crate::semantic::note_changed(&crate::semantic::note_rel_path(
            &item.original_path,
            item.is_daily,
            item.is_weekly,
        ));
        if item.is_weekly {
            format!("weekly/{}", item.original_path)
        } else if item.is_daily {
            format!("daily/{}", item.original_path)
        } else {
            format!("notes/{}", item.original_path)
        }
    };

    // Update metadata
    metadata.items.remove(item_index);
    write_trash_metadata(&metadata)?;

    Ok(restored_path)
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
    permanently_delete_trash_in(&get_trash_dir(), &mut metadata, &trash_id)?;
    write_trash_metadata(&metadata)?;
    Ok(())
}

fn permanently_delete_trash_in(
    trash_dir: &std::path::Path,
    metadata: &mut TrashMetadata,
    trash_id: &str,
) -> Result<(), String> {
    // Find the item in metadata
    let item_index = metadata
        .items
        .iter()
        .position(|item| item.id == trash_id)
        .ok_or("Trash item not found")?;

    let item = &metadata.items[item_index];

    // Build trash file/folder path and delete
    let trash_path = trash_item_path(trash_dir, item);
    validate_path_within_base(&trash_path, trash_dir)
        .map_err(|_| "Invalid trash item path".to_string())?;

    if trash_path.exists() {
        if item.is_folder {
            fs::remove_dir_all(&trash_path)
                .map_err(|e| format!("Failed to delete folder: {}", e))?;
        } else {
            fs::remove_file(&trash_path).map_err(|e| format!("Failed to delete: {}", e))?;
        }
    }

    // Update metadata
    metadata.items.remove(item_index);
    Ok(())
}

#[tauri::command]
pub(crate) fn empty_trash() -> Result<(), String> {
    let metadata = read_trash_metadata();
    empty_trash_in(&get_trash_dir(), &metadata);
    write_trash_metadata(&TrashMetadata::default())?;
    Ok(())
}

fn empty_trash_in(trash_dir: &std::path::Path, metadata: &TrashMetadata) {
    // Delete all files and folders
    for item in &metadata.items {
        let trash_path = trash_item_path(trash_dir, item);
        if validate_path_within_base(&trash_path, trash_dir).is_err() {
            // Tampered or sync-mangled metadata pointing outside the trash
            // dir — skip it rather than deleting whatever it resolves to.
            continue;
        }
        if trash_path.exists() {
            if item.is_folder {
                let _ = fs::remove_dir_all(&trash_path);
            } else {
                let _ = fs::remove_file(&trash_path);
            }
        }
    }
}

#[tauri::command]
pub(crate) fn cleanup_old_trash() -> Result<Vec<String>, String> {
    let mut metadata = read_trash_metadata();
    let now = chrono::Utc::now().timestamp();
    let deleted_ids = cleanup_old_trash_in(&get_trash_dir(), &mut metadata, now)?;
    write_trash_metadata(&metadata)?;
    Ok(deleted_ids)
}

fn cleanup_old_trash_in(
    trash_dir: &std::path::Path,
    metadata: &mut TrashMetadata,
    now: i64,
) -> Result<Vec<String>, String> {
    let seven_days_secs = TRASH_RETENTION_SECS;
    let mut deleted_ids = Vec::new();

    // Find expired items
    let expired_items: Vec<(usize, bool, String)> = metadata
        .items
        .iter()
        .enumerate()
        .filter(|(_, item)| now - item.trashed_at >= seven_days_secs)
        .map(|(i, item)| (i, item.is_folder, item.id.clone()))
        .collect();

    // Delete files/folders and remove from metadata (in reverse to maintain indices)
    for (i, is_folder, id) in expired_items.into_iter().rev() {
        let item = &metadata.items[i];
        let trash_path = trash_item_path(trash_dir, item);

        if validate_path_within_base(&trash_path, trash_dir).is_err() {
            // Tampered or sync-mangled metadata pointing outside the trash
            // dir — leave the entry in place rather than deleting whatever
            // it resolves to.
            continue;
        }

        if trash_path.exists() {
            let result = if is_folder {
                fs::remove_dir_all(&trash_path)
            } else {
                fs::remove_file(&trash_path)
            };
            result.map_err(|e| format!("Failed to delete expired trash item: {e}"))?;
        }

        metadata.items.remove(i);
        deleted_ids.push(id);
    }

    deleted_ids.reverse();
    Ok(deleted_ids)
}

fn collect_folder_files(dir: &std::path::Path, relative_path: &str, files: &mut Vec<String>) {
    if let Ok(entries) = fs::read_dir(dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if fs::symlink_metadata(&path)
                .map(|m| m.file_type().is_symlink())
                .unwrap_or(false)
            {
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
                collect_folder_files(&path, &sub_path, files);
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

fn trash_folder_on_disk(
    standalone_dir: &std::path::Path,
    trash_dir: &std::path::Path,
    path: &str,
    id: &str,
    trashed_at: i64,
) -> Result<TrashedNoteMetadata, String> {
    if !is_safe_existing_note_path(path) {
        return Err("Invalid folder path".to_string());
    }

    let source_path = standalone_dir.join(path);
    validate_path_within_base(&source_path, standalone_dir)
        .map_err(|_| "Invalid folder path".to_string())?;

    if !source_path.exists() {
        return Err("Folder does not exist".to_string());
    }

    if !source_path.is_dir() {
        return Err("Path is not a folder".to_string());
    }

    let mut contained_files = Vec::new();
    collect_folder_files(&source_path, "", &mut contained_files);

    let folder_name = source_path
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or(path)
        .to_string();
    let trash_filename = trash_item_filename(id, path);
    let trash_path = trash_dir.join(&trash_filename);
    validate_path_within_base(&trash_path, trash_dir)
        .map_err(|_| "Invalid trash destination".to_string())?;
    fs::rename(&source_path, &trash_path)
        .map_err(|e| format!("Failed to move folder to trash: {}", e))?;

    Ok(TrashedNoteMetadata {
        id: id.to_string(),
        filename: folder_name,
        original_path: path.to_string(),
        is_daily: false,
        is_weekly: false,
        is_folder: true,
        contained_files,
        trashed_at,
    })
}

#[tauri::command]
pub(crate) fn trash_folder(
    path: String,
    index: State<'_, Arc<BacklinksIndex>>,
) -> Result<(), String> {
    let standalone_dir = get_standalone_dir();
    ensure_trash_dir()?;
    let trash_dir = get_trash_dir();
    let id = next_trash_id();
    let item = trash_folder_on_disk(
        &standalone_dir,
        &trash_dir,
        &path,
        &id,
        chrono::Utc::now().timestamp(),
    )?;

    // Forge-relative paths of every trashed note, for the semantic index.
    let semantic_paths: Vec<String> = item
        .contained_files
        .iter()
        .map(|rel| format!("notes/{}/{}", path, rel))
        .collect();

    // Update metadata
    let mut metadata = read_trash_metadata();
    metadata.items.push(item.clone());
    write_trash_metadata(&metadata)?;

    // Remove every trashed note from the backlinks index. `contained_files`
    // entries are relative paths inside the folder; we only care about the
    // leaf .md filename for index keying.
    for rel in &item.contained_files {
        if let Some(name) = std::path::Path::new(rel)
            .file_name()
            .and_then(|s| s.to_str())
        {
            index.remove_note(name);
        }
    }
    crate::semantic::notes_removed(semantic_paths);

    Ok(())
}

#[tauri::command]
pub(crate) fn restore_note_from_folder(
    trash_id: String,
    note_filename: String,
    index: State<'_, Arc<BacklinksIndex>>,
) -> Result<(), String> {
    if !is_safe_existing_note_path(&note_filename) {
        return Err("Invalid note filename".to_string());
    }
    let mut metadata = read_trash_metadata();

    // Find the folder item in metadata
    let item_index = metadata
        .items
        .iter()
        .position(|item| item.id == trash_id && item.is_folder)
        .ok_or("Trashed folder not found")?;

    let item = &metadata.items[item_index];

    // Build trash folder path
    let trash_dir = get_trash_dir();
    let trash_folder_path = trash_item_path(&trash_dir, item);
    validate_path_within_base(&trash_folder_path, &trash_dir)
        .map_err(|_| "Invalid trashed folder path".to_string())?;

    if !trash_folder_path.exists() {
        return Err("Trashed folder not found on disk".to_string());
    }

    let standalone_dir = get_standalone_dir();
    let dest_path =
        restore_note_from_folder_on_disk(&trash_folder_path, &standalone_dir, &note_filename)?;

    // Re-index the restored note.
    if let Some(name) = dest_path.file_name().and_then(|s| s.to_str()) {
        let content = fs::read_to_string(&dest_path).unwrap_or_default();
        index.update_note(name, &content);
    }
    crate::semantic::note_changed(&format!("notes/{}", note_filename));

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

fn restore_note_from_folder_on_disk(
    trash_folder_path: &std::path::Path,
    standalone_dir: &std::path::Path,
    note_filename: &str,
) -> Result<std::path::PathBuf, String> {
    let note_path_in_trash = trash_folder_path.join(note_filename);
    validate_path_within_base(&note_path_in_trash, trash_folder_path)
        .map_err(|_| "Invalid note filename".to_string())?;
    if !note_path_in_trash.exists() {
        return Err("Note not found in trashed folder".to_string());
    }

    let leaf = note_path_in_trash
        .file_name()
        .ok_or_else(|| "Invalid note filename".to_string())?;
    let dest_path = standalone_dir.join(leaf);
    validate_path_within_base(&dest_path, standalone_dir)
        .map_err(|_| "Invalid restore destination".to_string())?;
    if dest_path.exists() {
        return Err("A note with this name already exists in the notes folder".to_string());
    }

    validate_path_within_base(&note_path_in_trash, trash_folder_path)
        .map_err(|_| "Invalid note filename".to_string())?;
    validate_path_within_base(&dest_path, standalone_dir)
        .map_err(|_| "Invalid restore destination".to_string())?;
    fs::rename(&note_path_in_trash, &dest_path)
        .map_err(|e| format!("Failed to restore note: {e}"))?;
    Ok(dest_path)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashSet;
    use std::path::PathBuf;

    struct TempDir(PathBuf);
    impl TempDir {
        fn new(tag: &str) -> Self {
            let path = std::env::temp_dir().join(format!(
                "moldavite-trash-{tag}-{}-{}",
                std::process::id(),
                std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .unwrap()
                    .as_nanos()
            ));
            for subdir in ["trash", "daily", "weekly", "notes"] {
                fs::create_dir_all(path.join(subdir)).unwrap();
            }
            Self(path)
        }
    }
    impl Drop for TempDir {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    fn item(id: String, original_path: String, trashed_at: i64) -> TrashedNoteMetadata {
        TrashedNoteMetadata {
            id,
            filename: original_path.clone(),
            original_path,
            is_daily: false,
            is_weekly: false,
            is_folder: false,
            contained_files: Vec::new(),
            trashed_at,
        }
    }

    #[test]
    fn valid_trash_items_keep_the_legacy_storage_name() {
        assert_eq!(
            trash_item_filename("123", "Projects/Deep/note.md"),
            "123_Projects_Deep_note.md"
        );
    }

    #[test]
    fn windows_trash_storage_names_flatten_untrusted_metadata() {
        assert_eq!(
            windows_safe_trash_item_filename("7", r"C:\Users\Mauro\note.md"),
            "7_C__Users_Mauro_note.md"
        );

        let invalid = windows_safe_trash_item_filename(
            r#"bad:id\part"#,
            "bad/name<with>|invalid?chars*.\u{0001}",
        );
        assert!(!invalid.chars().any(|character| {
            character.is_control()
                || matches!(
                    character,
                    '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|'
                )
        }));

        let long_path = format!(r"C:\{}.", "a".repeat(300));
        let long = windows_safe_trash_item_filename("8", &long_path);
        assert!(long.encode_utf16().count() <= 255);
        assert!(!long.ends_with([' ', '.']));
    }

    #[cfg(unix)]
    #[test]
    fn legacy_nonportable_note_can_be_trashed_and_restored() {
        let tmp = TempDir::new("legacy-note");
        let trash = tmp.0.join("trash");
        let daily = tmp.0.join("daily");
        let notes = tmp.0.join("notes");
        let folder = notes.join("Q3: Roadmap.");
        fs::create_dir_all(&folder).unwrap();
        let relative = "Q3: Roadmap./Reports..md";
        fs::write(folder.join("Reports..md"), "legacy body").unwrap();

        let metadata = trash_note_on_disk(
            &notes,
            &trash,
            relative,
            false,
            false,
            false,
            "legacy-id",
            123,
        )
        .unwrap();
        assert!(!notes.join(relative).exists());
        assert_eq!(
            fs::read_to_string(trash_item_path(&trash, &metadata)).unwrap(),
            "legacy body"
        );

        let restored =
            restore_item_on_disk(&trash, &daily, &tmp.0.join("weekly"), &notes, &metadata).unwrap();
        assert_eq!(restored, notes.join(relative));
        assert_eq!(fs::read_to_string(restored).unwrap(), "legacy body");
    }

    #[test]
    fn weekly_note_restores_to_weekly_directory() {
        let tmp = TempDir::new("weekly-note");
        let trash = tmp.0.join("trash");
        let daily = tmp.0.join("daily");
        let weekly = tmp.0.join("weekly");
        let notes = tmp.0.join("notes");
        let filename = "2026-W34.md";
        fs::write(weekly.join(filename), "weekly body").unwrap();

        let metadata = trash_note_on_disk(
            &weekly,
            &trash,
            filename,
            true,
            false,
            true,
            "weekly-id",
            123,
        )
        .unwrap();

        assert!(metadata.is_weekly);
        let restored = restore_item_on_disk(&trash, &daily, &weekly, &notes, &metadata).unwrap();
        assert_eq!(restored, weekly.join(filename));
        assert_eq!(fs::read_to_string(restored).unwrap(), "weekly body");
    }

    #[test]
    fn legacy_trash_metadata_defaults_to_non_weekly() {
        let metadata: TrashMetadata = serde_json::from_str(
            r#"{"items":[{"id":"legacy","filename":"note.md","original_path":"note.md","is_daily":false,"trashed_at":123}]}"#,
        )
        .unwrap();

        assert!(!metadata.items[0].is_weekly);
    }

    #[test]
    fn rapid_trash_ids_are_unique_and_monotonic() {
        let ids: Vec<i64> = (0..1000)
            .map(|_| next_trash_id().parse::<i64>().unwrap())
            .collect();
        assert_eq!(ids.iter().copied().collect::<HashSet<_>>().len(), 1000);
        assert!(ids.windows(2).all(|pair| pair[0] < pair[1]));
    }

    #[test]
    fn stress_restore_all_205_notes_preserves_every_file() {
        let tmp = TempDir::new("restore-all");
        let trash = tmp.0.join("trash");
        let daily = tmp.0.join("daily");
        let notes = tmp.0.join("notes");
        let mut items = Vec::new();
        for i in 0..205 {
            let metadata = item(next_trash_id(), format!("Batch/note-{i}.md"), 0);
            fs::write(trash_item_path(&trash, &metadata), format!("body {i}")).unwrap();
            items.push(metadata);
        }
        for metadata in &items {
            restore_item_on_disk(&trash, &daily, &tmp.0.join("weekly"), &notes, metadata).unwrap();
        }
        assert_eq!(fs::read_dir(&trash).unwrap().count(), 0);
        for i in 0..205 {
            assert_eq!(
                fs::read_to_string(notes.join(format!("Batch/note-{i}.md"))).unwrap(),
                format!("body {i}")
            );
        }
    }

    #[test]
    fn cleanup_honors_exact_seven_day_boundary() {
        let tmp = TempDir::new("cleanup-boundary");
        let trash = tmp.0.join("trash");
        let now = 2_000_000_000_i64;
        let seven_days = TRASH_RETENTION_SECS;
        let expired = item("expired".into(), "expired.md".into(), now - seven_days);
        let fresh = item("fresh".into(), "fresh.md".into(), now - seven_days + 1);
        fs::write(trash_item_path(&trash, &expired), "old").unwrap();
        fs::write(trash_item_path(&trash, &fresh), "new").unwrap();
        let mut metadata = TrashMetadata {
            items: vec![expired, fresh.clone()],
        };
        assert_eq!(
            cleanup_old_trash_in(&trash, &mut metadata, now).unwrap(),
            vec!["expired"]
        );
        assert_eq!(metadata.items.len(), 1);
        assert_eq!(metadata.items[0].id, fresh.id);
        assert!(trash_item_path(&trash, &fresh).exists());
    }

    #[test]
    fn restore_rejects_untrusted_absolute_metadata_and_accepts_nested_path() {
        let tmp = TempDir::new("restore-validation");
        let trash = tmp.0.join("trash");
        let daily = tmp.0.join("daily");
        let notes = tmp.0.join("notes");
        let outside = tmp.0.join("outside.md");
        fs::write(&outside, "keep").unwrap();

        let malicious = item("malicious".into(), outside.to_string_lossy().to_string(), 0);
        fs::write(trash_item_path(&trash, &malicious), "stolen").unwrap();
        assert!(
            restore_item_on_disk(&trash, &daily, &tmp.0.join("weekly"), &notes, &malicious)
                .is_err()
        );
        assert_eq!(fs::read_to_string(&outside).unwrap(), "keep");
        assert!(trash_item_path(&trash, &malicious).exists());

        let legitimate = item("legitimate".into(), "Projects/Deep/note.md".into(), 0);
        fs::write(trash_item_path(&trash, &legitimate), "restored").unwrap();
        let restored =
            restore_item_on_disk(&trash, &daily, &tmp.0.join("weekly"), &notes, &legitimate)
                .unwrap();
        assert_eq!(restored, notes.join("Projects/Deep/note.md"));
        assert_eq!(fs::read_to_string(restored).unwrap(), "restored");
    }

    #[test]
    fn trash_folder_rejects_absolute_path_and_records_valid_relative_path() {
        let tmp = TempDir::new("folder-validation");
        let trash = tmp.0.join("trash");
        let notes = tmp.0.join("notes");
        let outside = tmp.0.join("outside");
        fs::create_dir_all(notes.join("Projects/Deep")).unwrap();
        fs::write(notes.join("Projects/Deep/note.md"), "note").unwrap();
        fs::create_dir_all(&outside).unwrap();
        fs::write(outside.join("keep.md"), "keep").unwrap();

        assert!(trash_folder_on_disk(&notes, &trash, outside.to_str().unwrap(), "bad", 0).is_err());
        assert!(outside.join("keep.md").exists());

        let metadata = trash_folder_on_disk(&notes, &trash, "Projects/Deep", "valid", 123).unwrap();
        assert_eq!(metadata.original_path, "Projects/Deep");
        assert_eq!(metadata.contained_files, vec!["note.md"]);
        assert!(!notes.join("Projects/Deep").exists());
        assert!(trash_item_path(&trash, &metadata).is_dir());
    }

    #[test]
    fn folder_tree_restore_preserves_locked_and_conflict_copy_notes() {
        let tmp = TempDir::new("folder-tree");
        let trash = tmp.0.join("trash");
        let source = trash.join("folder-id_Projects_Deep");
        fs::create_dir_all(source.join("Nested")).unwrap();
        fs::write(source.join("Nested/secret.md.locked"), "ciphertext").unwrap();
        fs::write(
            source.join("Nested/note (conflict 2026-07-13 1200).md"),
            "external version",
        )
        .unwrap();
        let folder = TrashedNoteMetadata {
            id: "folder-id".into(),
            filename: "Deep".into(),
            original_path: "Projects/Deep".into(),
            is_daily: false,
            is_weekly: false,
            is_folder: true,
            contained_files: vec!["Nested/note (conflict 2026-07-13 1200).md".into()],
            trashed_at: 0,
        };
        let restored = restore_item_on_disk(
            &trash,
            &tmp.0.join("daily"),
            &tmp.0.join("weekly"),
            &tmp.0.join("notes"),
            &folder,
        )
        .unwrap();
        assert_eq!(
            fs::read_to_string(restored.join("Nested/secret.md.locked")).unwrap(),
            "ciphertext"
        );
        assert_eq!(
            fs::read_to_string(restored.join("Nested/note (conflict 2026-07-13 1200).md")).unwrap(),
            "external version"
        );
    }

    #[cfg(unix)]
    #[test]
    fn security_regression_folder_restore_rejects_symlinked_note_path() {
        use std::os::unix::fs::symlink;

        let tmp = TempDir::new("folder-note-symlink");
        let trash_folder = tmp.0.join("trash/folder");
        let standalone = tmp.0.join("notes");
        let outside = tmp.0.join("outside");
        fs::create_dir_all(&trash_folder).unwrap();
        fs::create_dir_all(&outside).unwrap();
        fs::write(outside.join("secret.md"), "outside secret").unwrap();
        symlink(&outside, trash_folder.join("link")).unwrap();

        let result = restore_note_from_folder_on_disk(&trash_folder, &standalone, "link/secret.md");

        assert!(result.is_err());
        assert_eq!(
            fs::read_to_string(outside.join("secret.md")).unwrap(),
            "outside secret"
        );
        assert!(!standalone.join("secret.md").exists());
    }

    #[cfg(unix)]
    #[test]
    fn security_regression_trash_cleanup_never_deletes_outside_the_trash_dir() {
        // `trash_item_filename` only strips `/` out of `original_path`, not
        // `id` — a tampered or sync-mangled id can still carry `..`
        // segments and resolve outside the trash dir.
        let tmp = TempDir::new("trash-outside-escape");
        let trash = tmp.0.join("trash");
        let outside = tmp.0.join("outside-secret_note.md");
        fs::write(&outside, "keep").unwrap();

        let malicious = item("../outside-secret".into(), "note.md".into(), 0);

        // permanently_delete_trash_in: single-item command errors and never deletes.
        let mut single_item_metadata = TrashMetadata {
            items: vec![malicious.clone()],
        };
        assert!(permanently_delete_trash_in(
            &trash,
            &mut single_item_metadata,
            "../outside-secret"
        )
        .is_err());
        assert_eq!(fs::read_to_string(&outside).unwrap(), "keep");

        // empty_trash_in: skips the tampered item.
        let empty_metadata = TrashMetadata {
            items: vec![malicious.clone()],
        };
        empty_trash_in(&trash, &empty_metadata);
        assert_eq!(fs::read_to_string(&outside).unwrap(), "keep");

        // cleanup_old_trash_in: skips the tampered item even once "expired".
        let mut cleanup_metadata = TrashMetadata {
            items: vec![malicious],
        };
        let deleted = cleanup_old_trash_in(&trash, &mut cleanup_metadata, i64::MAX).unwrap();
        assert!(deleted.is_empty());
        assert_eq!(fs::read_to_string(&outside).unwrap(), "keep");
    }
}

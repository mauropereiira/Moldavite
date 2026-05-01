//! Note CRUD operations.

use std::fs;
use std::path::Path;
use std::sync::Arc;

use tauri::State;

use crate::backlinks_index::BacklinksIndex;
use crate::forge_watcher::RecentWrites;
use crate::frontmatter;
use crate::paths::{
    file_modified_unix, get_daily_dir, get_standalone_dir, get_weekly_dir,
};
use crate::persist::generate_unique_filename;
use crate::types::{NoteFile, NoteRead};
use crate::validation::is_safe_filename;

// Helper function to recursively scan notes in a directory
pub(crate) fn scan_notes_recursive(dir: &Path, relative_path: &str, notes: &mut Vec<NoteFile>) {
    if let Ok(entries) = fs::read_dir(dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            // Skip symlinks so we never recurse outside the notes tree.
            if fs::symlink_metadata(&path).map(|m| m.file_type().is_symlink()).unwrap_or(false) {
                continue;
            }
            let Some(filename) = path.file_name().map(|f| f.to_string_lossy().to_string()) else {
                continue;
            };

            if path.is_dir() {
                // Skip hidden directories
                if filename.starts_with('.') {
                    continue;
                }

                // Recurse into subdirectory
                let new_relative_path = if relative_path.is_empty() {
                    filename.clone()
                } else {
                    format!("{}/{}", relative_path, filename)
                };
                scan_notes_recursive(&path, &new_relative_path, notes);
            } else if path.is_file() {
                // Determine folder_path (None if at root level)
                let folder_path = if relative_path.is_empty() {
                    None
                } else {
                    Some(relative_path.to_string())
                };

                let modified_at = file_modified_unix(&path);

                // Check for locked files (.md.locked)
                if filename.ends_with(".md.locked") {
                    let base_name = filename.strip_suffix(".locked").unwrap().to_string();
                    let note_path = if relative_path.is_empty() {
                        format!("notes/{}", base_name)
                    } else {
                        format!("notes/{}/{}", relative_path, base_name)
                    };
                    notes.push(NoteFile {
                        name: base_name,
                        path: note_path,
                        is_daily: false,
                        is_weekly: false,
                        date: None,
                        week: None,
                        is_locked: true,
                        folder_path,
                        modified_at,
                    });
                } else if path.extension().is_some_and(|ext| ext == "md") {
                    let note_path = if relative_path.is_empty() {
                        format!("notes/{}", filename)
                    } else {
                        format!("notes/{}/{}", relative_path, filename)
                    };
                    notes.push(NoteFile {
                        name: filename,
                        path: note_path,
                        is_daily: false,
                        is_weekly: false,
                        date: None,
                        week: None,
                        is_locked: false,
                        folder_path,
                        modified_at,
                    });
                }
            }
        }
    }
}

#[tauri::command]
pub(crate) fn list_notes() -> Result<Vec<NoteFile>, String> {
    let mut notes = Vec::new();

    // List daily notes (non-recursive, daily notes are only at root level)
    let daily_dir = get_daily_dir();
    if daily_dir.exists() {
        if let Ok(entries) = fs::read_dir(&daily_dir) {
            for entry in entries.flatten() {
                let path = entry.path();
                let filename = path.file_name().unwrap().to_string_lossy().to_string();
                let modified_at = file_modified_unix(&path);

                // Check for locked files (.md.locked)
                if filename.ends_with(".md.locked") {
                    let base_name = filename.strip_suffix(".locked").unwrap().to_string();
                    let date = base_name.strip_suffix(".md").map(|s| s.to_string());
                    notes.push(NoteFile {
                        name: base_name.clone(),
                        path: format!("daily/{}", base_name),
                        is_daily: true,
                        is_weekly: false,
                        date,
                        week: None,
                        is_locked: true,
                        folder_path: None,
                        modified_at,
                    });
                } else if path.extension().is_some_and(|ext| ext == "md") {
                    let date = filename.strip_suffix(".md").map(|s| s.to_string());
                    notes.push(NoteFile {
                        name: filename.clone(),
                        path: format!("daily/{}", filename),
                        is_daily: true,
                        is_weekly: false,
                        date,
                        week: None,
                        is_locked: false,
                        folder_path: None,
                        modified_at,
                    });
                }
            }
        }
    }

    // List weekly notes (non-recursive, weekly notes are only at root level)
    let weekly_dir = get_weekly_dir();
    if weekly_dir.exists() {
        if let Ok(entries) = fs::read_dir(&weekly_dir) {
            for entry in entries.flatten() {
                let path = entry.path();
                let filename = path.file_name().unwrap().to_string_lossy().to_string();
                let modified_at = file_modified_unix(&path);

                // Check for locked files (.md.locked)
                if filename.ends_with(".md.locked") {
                    let base_name = filename.strip_suffix(".locked").unwrap().to_string();
                    let week = base_name.strip_suffix(".md").map(|s| s.to_string());
                    notes.push(NoteFile {
                        name: base_name.clone(),
                        path: format!("weekly/{}", base_name),
                        is_daily: false,
                        is_weekly: true,
                        date: None,
                        week,
                        is_locked: true,
                        folder_path: None,
                        modified_at,
                    });
                } else if path.extension().is_some_and(|ext| ext == "md") {
                    let week = filename.strip_suffix(".md").map(|s| s.to_string());
                    notes.push(NoteFile {
                        name: filename.clone(),
                        path: format!("weekly/{}", filename),
                        is_daily: false,
                        is_weekly: true,
                        date: None,
                        week,
                        is_locked: false,
                        folder_path: None,
                        modified_at,
                    });
                }
            }
        }
    }

    // List standalone notes (recursive to support folders)
    let standalone_dir = get_standalone_dir();
    if standalone_dir.exists() {
        scan_notes_recursive(&standalone_dir, "", &mut notes);
    }

    Ok(notes)
}

#[tauri::command]
pub(crate) fn read_note(
    filename: String,
    is_daily: bool,
    is_weekly: bool,
) -> Result<NoteRead, String> {
    // Prevent path traversal attacks (rejects .., /, \, absolute paths, null bytes)
    if !is_safe_filename(&filename) {
        return Err("Invalid filename".to_string());
    }

    let dir = if is_weekly {
        get_weekly_dir()
    } else if is_daily {
        get_daily_dir()
    } else {
        get_standalone_dir()
    };

    let path = dir.join(&filename);

    if !path.exists() {
        return Ok(NoteRead {
            content: String::new(),
            color: None,
        });
    }

    let raw = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    let parsed = frontmatter::parse_note(&raw);
    Ok(NoteRead {
        content: parsed.body,
        color: parsed.color,
    })
}

#[tauri::command]
pub(crate) fn write_note(
    filename: String,
    content: String,
    is_daily: bool,
    is_weekly: bool,
    color: Option<String>,
    index: State<'_, Arc<BacklinksIndex>>,
    recent: State<'_, Arc<RecentWrites>>,
) -> Result<(), String> {
    // Prevent path traversal attacks (rejects .., /, \, absolute paths, null bytes)
    if !is_safe_filename(&filename) {
        return Err("Invalid filename".to_string());
    }

    let dir = if is_weekly {
        get_weekly_dir()
    } else if is_daily {
        get_daily_dir()
    } else {
        get_standalone_dir()
    };

    let path = dir.join(&filename);

    // Preserve any extra frontmatter keys from the existing file so external
    // tools that add their own metadata don't lose it on save. If the caller
    // didn't pass a `color`, also preserve the existing color from the file
    // so a normal content save doesn't strip it.
    let existing = fs::read_to_string(&path).unwrap_or_default();
    let parsed_existing = frontmatter::parse_note(&existing);
    let resolved_color: Option<String> = match color {
        // Explicit clear: caller passed "default" or "" to wipe color.
        Some(ref c) if c.is_empty() || c == "default" => None,
        // Explicit set.
        Some(c) => Some(c),
        // Untouched: keep what's on disk.
        None => parsed_existing.color.clone(),
    };
    let serialized = frontmatter::serialize_note(
        resolved_color.as_deref(),
        &parsed_existing.extra,
        &content,
    );

    fs::write(&path, &serialized).map_err(|e| e.to_string())?;
    recent.record(&path);

    // Set restrictive file permissions (600 = owner read/write only)
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let permissions = fs::Permissions::from_mode(0o600);
        fs::set_permissions(&path, permissions).map_err(|e| e.to_string())?;
    }

    // The backlinks index only cares about the body, not frontmatter.
    index.update_note(&filename, &content);

    Ok(())
}

#[tauri::command]
pub(crate) fn delete_note(
    filename: String,
    is_daily: bool,
    is_weekly: bool,
    index: State<'_, Arc<BacklinksIndex>>,
) -> Result<(), String> {
    // Prevent path traversal attacks (rejects .., /, \, absolute paths, null bytes)
    if !is_safe_filename(&filename) {
        return Err("Invalid filename".to_string());
    }

    let dir = if is_weekly {
        get_weekly_dir()
    } else if is_daily {
        get_daily_dir()
    } else {
        get_standalone_dir()
    };

    let path = dir.join(&filename);

    if path.exists() {
        fs::remove_file(&path).map_err(|e| e.to_string())?;
    }
    index.remove_note(&filename);
    Ok(())
}

#[tauri::command]
pub(crate) fn create_note(
    title: String,
    folder_path: Option<String>,
    index: State<'_, Arc<BacklinksIndex>>,
) -> Result<String, String> {
    // Prevent path traversal attacks
    if title.contains("..") {
        return Err("Invalid title".to_string());
    }
    if let Some(ref folder) = folder_path {
        if folder.contains("..") {
            return Err("Invalid folder path".to_string());
        }
    }

    let base_dir = get_standalone_dir();
    let dir = match &folder_path {
        Some(folder) => base_dir.join(folder),
        None => base_dir,
    };

    // Ensure the folder exists
    if !dir.exists() {
        return Err("Folder does not exist".to_string());
    }

    // Generate unique filename if needed
    let filename = generate_unique_filename(&dir, &title, "md");
    let path = dir.join(&filename);

    fs::write(&path, "").map_err(|e| e.to_string())?;

    // Set restrictive file permissions (600 = owner read/write only)
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let permissions = fs::Permissions::from_mode(0o600);
        fs::set_permissions(&path, permissions).map_err(|e| e.to_string())?;
    }

    index.update_note(&filename, "");

    // Return the full relative path
    match folder_path {
        Some(folder) => Ok(format!("{}/{}", folder, filename)),
        None => Ok(filename),
    }
}

#[tauri::command]
pub(crate) fn duplicate_note(
    filename: String,
    is_daily: bool,
    is_weekly: bool,
    index: State<'_, Arc<BacklinksIndex>>,
) -> Result<String, String> {
    if !is_safe_filename(&filename) {
        return Err("Invalid filename".to_string());
    }
    // Determine source directory
    let dir = if is_weekly {
        get_weekly_dir()
    } else if is_daily {
        get_daily_dir()
    } else {
        get_standalone_dir()
    };

    let source_path = dir.join(&filename);

    if !source_path.exists() {
        return Err("Note not found".to_string());
    }

    // Read source content
    let content = fs::read_to_string(&source_path).map_err(|e| e.to_string())?;

    // Generate new filename with " (copy)" suffix
    let base_name = filename.trim_end_matches(".md");
    let new_base = format!("{} (copy)", base_name);
    let new_filename = generate_unique_filename(&dir, &new_base, "md");
    let new_path = dir.join(&new_filename);

    // Write content to new file
    fs::write(&new_path, &content).map_err(|e| e.to_string())?;

    // Set restrictive file permissions (600 = owner read/write only)
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let permissions = fs::Permissions::from_mode(0o600);
        fs::set_permissions(&new_path, permissions).map_err(|e| e.to_string())?;
    }

    index.update_note(&new_filename, &content);

    Ok(new_filename)
}

#[tauri::command]
pub(crate) fn export_single_note(
    filename: String,
    destination: String,
    is_daily: bool,
    is_weekly: bool,
) -> Result<String, String> {
    if !is_safe_filename(&filename) {
        return Err("Invalid filename".to_string());
    }
    // Determine source directory
    let dir = if is_weekly {
        get_weekly_dir()
    } else if is_daily {
        get_daily_dir()
    } else {
        get_standalone_dir()
    };

    let source_path = dir.join(&filename);

    if !source_path.exists() {
        return Err("Note not found".to_string());
    }

    // Read source content
    let content = fs::read_to_string(&source_path).map_err(|e| e.to_string())?;

    // Validate the destination: the caller receives `destination` from the OS save
    // dialog (plugin-dialog), but this command is also callable from any JS context,
    // so re-check that the path's parent exists and is writeable by the user.
    let dest_path = Path::new(&destination);
    let parent = dest_path
        .parent()
        .ok_or_else(|| "Invalid destination path".to_string())?;
    if !parent.is_dir() {
        return Err("Destination directory does not exist".to_string());
    }
    // Only allow writing plain markdown/text via this command.
    let ext_ok = dest_path
        .extension()
        .and_then(|s| s.to_str())
        .is_some_and(|e| matches!(e.to_ascii_lowercase().as_str(), "md" | "markdown" | "txt"));
    if !ext_ok {
        return Err("Destination must have a .md, .markdown, or .txt extension".to_string());
    }
    fs::write(dest_path, &content).map_err(|e| e.to_string())?;

    Ok(destination)
}

#[tauri::command]
pub(crate) fn rename_note(
    old_filename: String,
    new_filename: String,
    is_daily: bool,
    is_weekly: bool,
    index: State<'_, Arc<BacklinksIndex>>,
) -> Result<(), String> {
    if !is_safe_filename(&old_filename) || !is_safe_filename(&new_filename) {
        return Err("Invalid filename".to_string());
    }
    let dir = if is_weekly {
        get_weekly_dir()
    } else if is_daily {
        get_daily_dir()
    } else {
        get_standalone_dir()
    };

    let old_path = dir.join(&old_filename);
    let new_path = dir.join(&new_filename);

    if !old_path.exists() {
        return Err("Note not found".to_string());
    }

    if new_path.exists() {
        return Err("A note with this name already exists".to_string());
    }

    fs::rename(&old_path, &new_path).map_err(|e| e.to_string())?;

    let content_after_rename = fs::read_to_string(&new_path).unwrap_or_default();
    index.rename_note(&old_filename, &new_filename, &content_after_rename);

    Ok(())
}

#[tauri::command]
pub(crate) fn clear_all_notes(index: State<'_, Arc<BacklinksIndex>>) -> Result<(), String> {
    // Delete all files in daily directory
    let daily_dir = get_daily_dir();
    if daily_dir.exists() {
        if let Ok(entries) = fs::read_dir(&daily_dir) {
            for entry in entries.flatten() {
                let path = entry.path();
                if path.is_file() && path.extension().is_some_and(|ext| ext == "md") {
                    fs::remove_file(&path).map_err(|e| e.to_string())?;
                }
            }
        }
    }

    // Delete all files in standalone directory
    let standalone_dir = get_standalone_dir();
    if standalone_dir.exists() {
        if let Ok(entries) = fs::read_dir(&standalone_dir) {
            for entry in entries.flatten() {
                let path = entry.path();
                if path.is_file() && path.extension().is_some_and(|ext| ext == "md") {
                    fs::remove_file(&path).map_err(|e| e.to_string())?;
                }
            }
        }
    }

    index.remove_all();

    Ok(())
}

#[tauri::command]
pub(crate) fn move_note(
    note_path: String,
    to_folder: Option<String>,
    index: State<'_, Arc<BacklinksIndex>>,
) -> Result<String, String> {
    let standalone_dir = get_standalone_dir();

    // Validate paths
    if note_path.contains("..") {
        return Err("Invalid note path".to_string());
    }
    if let Some(ref folder) = to_folder {
        if folder.contains("..") {
            return Err("Invalid folder path".to_string());
        }
    }

    let source_path = standalone_dir.join(&note_path);

    if !source_path.exists() {
        return Err("Note not found".to_string());
    }

    // Get the filename and extract base name without extension
    let filename = source_path.file_name()
        .ok_or_else(|| "Invalid note path".to_string())?
        .to_string_lossy()
        .to_string();

    // Calculate destination path
    let dest_dir = match &to_folder {
        Some(folder) => standalone_dir.join(folder),
        None => standalone_dir.clone(),
    };

    // Ensure destination folder exists
    if !dest_dir.exists() {
        return Err("Destination folder does not exist".to_string());
    }

    // Generate unique filename if needed (handle conflicts)
    let base_name = filename.trim_end_matches(".md");
    let final_filename = generate_unique_filename(&dest_dir, base_name, "md");
    let dest_path = dest_dir.join(&final_filename);

    // Move the file
    fs::rename(&source_path, &dest_path)
        .map_err(|e| format!("Failed to move note: {}", e))?;

    // Keep backlinks index in sync: drop entries from old filename, then
    // re-index using the (possibly deduplicated) new filename + content.
    let old_filename = filename.clone();
    index.remove_note(&old_filename);
    let content = fs::read_to_string(&dest_path).unwrap_or_default();
    index.update_note(&final_filename, &content);

    // Return new relative path
    let new_relative_path = match &to_folder {
        Some(folder) => format!("{}/{}", folder, final_filename),
        None => final_filename,
    };

    Ok(format!("notes/{}", new_relative_path))
}

// Fix permissions on existing note files
#[tauri::command]
pub(crate) fn fix_note_permissions() -> Result<u32, String> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mut fixed_count = 0u32;

        for dir in [get_daily_dir(), get_standalone_dir()] {
            if !dir.exists() {
                continue;
            }

            if let Ok(entries) = fs::read_dir(&dir) {
                for entry in entries.flatten() {
                    let path = entry.path();
                    if path.extension().is_some_and(|ext| ext == "md") {
                        let permissions = fs::Permissions::from_mode(0o600);
                        if fs::set_permissions(&path, permissions).is_ok() {
                            fixed_count += 1;
                        }
                    }
                }
            }
        }

        Ok(fixed_count)
    }

    #[cfg(not(unix))]
    Ok(0)
}

//! Note listing, reads, writes, creation, rename, move, duplication, and deletion.
//!
//! Daily and weekly notes are addressed by bare filename; standalone notes are
//! addressed by their `notes/`-relative path, including folders. Display titles
//! never select a disk path. Writes are atomic and compare the caller's base hash
//! with current disk content; a mismatch preserves both versions via a conflict
//! copy. Disk mutations update backlinks, semantic search, and watcher suppression
//! only after the filesystem operation succeeds.

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, OnceLock};

use tauri::State;

use crate::backlinks_index::BacklinksIndex;
use crate::forge_watcher::RecentWrites;
use crate::frontmatter;
use crate::paths::{file_modified_unix, get_daily_dir, get_standalone_dir, get_weekly_dir};
use crate::persist::{generate_unique_filename, write_atomic};
use crate::types::{NoteFile, NoteRead, NoteWriteResult};
use crate::validation::{is_safe_filename, is_safe_note_path, validate_path_within_base};

/// Standalone notes may live in folders and are addressed by a notes/-relative
/// path; daily and weekly notes are always addressed by a bare filename.
fn is_valid_note_ref(filename: &str, is_daily: bool, is_weekly: bool) -> bool {
    if is_daily || is_weekly {
        is_safe_filename(filename)
    } else {
        is_safe_note_path(filename)
    }
}

/// The backlinks index is keyed by bare filename, so folder-relative refs
/// must be reduced to their final component before touching the index.
fn index_key(filename: &str) -> String {
    Path::new(filename)
        .file_name()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_else(|| filename.to_string())
}

/// SHA-256 hex digest of a note body. The frontend keeps the hash from its
/// last read and sends it back on save so we can tell whether the disk copy
/// changed underneath it (external editor, sync tool, git…).
pub(crate) fn sha256_hex(content: &str) -> String {
    use sha2::{Digest, Sha256};
    let mut hasher = Sha256::new();
    hasher.update(content.as_bytes());
    format!("{:x}", hasher.finalize())
}

/// True when a daily-note stem is an actual date ("2025-01-01"). Files in
/// daily/ with other names (e.g. conflict copies) are listed without a
/// `date` so the frontend never tries to parse them as calendar days.
fn is_date_stem(stem: &str) -> bool {
    let b = stem.as_bytes();
    b.len() == 10
        && b.iter().enumerate().all(|(i, c)| match i {
            4 | 7 => *c == b'-',
            _ => c.is_ascii_digit(),
        })
}

/// True when a weekly-note stem is an actual ISO week ("2024-W52").
fn is_week_stem(stem: &str) -> bool {
    let b = stem.as_bytes();
    b.len() == 8
        && b[..4].iter().all(u8::is_ascii_digit)
        && &b[4..6] == b"-W"
        && b[6..].iter().all(u8::is_ascii_digit)
}

/// External-edit conflict safety: when the on-disk note diverged from what
/// the frontend last read (`base_hash`) AND from what it is about to write,
/// copy the disk version to a sibling `<stem> (conflict YYYY-MM-DD HHMM).md`
/// before the save overwrites it, so neither version is lost.
///
/// Returns `Some((conflict_filename, disk_body))` when a copy was created —
/// the body is handed back so the caller can index it — or `None` when no
/// conflict exists (no base hash, missing file, hash matches, or the incoming
/// content is identical to the disk anyway).
fn conflict_copy_lock() -> &'static Mutex<()> {
    static LOCK: OnceLock<Mutex<()>> = OnceLock::new();
    LOCK.get_or_init(|| Mutex::new(()))
}

fn conflict_copy_destination(path: &Path, stamp: &str) -> Result<(PathBuf, String), String> {
    let dir = path
        .parent()
        .ok_or_else(|| "Invalid note path".to_string())?;
    let stem = path
        .file_stem()
        .and_then(|s| s.to_str())
        .ok_or_else(|| "Invalid note path".to_string())?;
    let name = generate_unique_filename(dir, &format!("{} (conflict {})", stem, stamp), "md");
    Ok((dir.join(&name), name))
}

/// Test wrapper with an injectable timestamp.
#[cfg(test)]
fn preserve_conflict_copy_at(
    path: &Path,
    base_hash: Option<&str>,
    new_content: &str,
    stamp: &str,
) -> Result<Option<(String, String)>, String> {
    // Filename selection plus creation must be one critical section. Without
    // it, two saves in the same minute can both select the same free conflict
    // name and the later atomic rename silently replaces the first copy.
    let _guard = conflict_copy_lock()
        .lock()
        .map_err(|_| "Conflict-copy lock poisoned".to_string())?;
    preserve_conflict_copy_unlocked(path, base_hash, new_content, stamp)
}

fn preserve_conflict_copy_unlocked(
    path: &Path,
    base_hash: Option<&str>,
    new_content: &str,
    stamp: &str,
) -> Result<Option<(String, String)>, String> {
    let Some(base) = base_hash else {
        // Caller didn't opt in to conflict detection — legacy behavior.
        return Ok(None);
    };
    // A missing file can't conflict — the save simply creates it.
    let Ok(raw) = fs::read_to_string(path) else {
        return Ok(None);
    };
    let disk_body = frontmatter::parse_note(&raw).body;
    // No conflict when the disk still matches what the frontend last read,
    // or when the incoming save is identical to the disk content anyway.
    if sha256_hex(&disk_body) == base || disk_body == new_content {
        return Ok(None);
    }
    let (conflict_path, conflict_name) = conflict_copy_destination(path, stamp)?;
    // Preserve the disk version byte-for-byte (frontmatter included).
    write_atomic(&conflict_path, raw.as_bytes(), Some(0o600))?;
    Ok(Some((conflict_name, disk_body)))
}

#[cfg(test)]
fn preserve_buffer_copy_at(path: &Path, content: &str, stamp: &str) -> Result<String, String> {
    let _guard = conflict_copy_lock()
        .lock()
        .map_err(|_| "Conflict-copy lock poisoned".to_string())?;
    preserve_buffer_copy_unlocked(path, content, stamp)
}

fn preserve_buffer_copy_unlocked(
    path: &Path,
    content: &str,
    stamp: &str,
) -> Result<String, String> {
    let (conflict_path, conflict_name) = conflict_copy_destination(path, stamp)?;
    write_atomic(&conflict_path, content.as_bytes(), Some(0o600))?;
    Ok(conflict_name)
}

fn delete_note_at(path: &Path, base_hash: Option<&str>) -> Result<bool, String> {
    if !path.exists() {
        return Ok(false);
    }
    if let Some(base) = base_hash {
        let raw = fs::read_to_string(path).map_err(|e| e.to_string())?;
        let body = frontmatter::parse_note(&raw).body;
        if sha256_hex(&body) != base {
            return Err("Note changed on disk since it was last read — not deleting".to_string());
        }
    }
    fs::remove_file(path).map_err(|e| e.to_string())?;
    Ok(true)
}

/// Serialize conflict detection, frontmatter preservation, and the replacing
/// write as one operation. This prevents concurrent saves from both observing
/// the same old disk version and then silently overwriting one another.
pub(crate) fn save_note_with_conflict(
    path: &Path,
    base_hash: Option<&str>,
    content: &str,
    color: Option<&str>,
) -> Result<Option<(String, String)>, String> {
    let _guard = conflict_copy_lock()
        .lock()
        .map_err(|_| "Conflict-copy lock poisoned".to_string())?;
    ensure_note_is_writable(path)?;
    let stamp = chrono::Local::now().format("%Y-%m-%d %H%M").to_string();
    let conflict = preserve_conflict_copy_unlocked(path, base_hash, content, &stamp)?;
    let existing = fs::read_to_string(path).unwrap_or_default();
    let parsed_existing = frontmatter::parse_note(&existing);
    let resolved_color = match color {
        Some("") | Some("default") => None,
        Some(value) => Some(value),
        None => parsed_existing.color.as_deref(),
    };
    let serialized = frontmatter::serialize_note(resolved_color, &parsed_existing.extra, content);
    write_atomic(path, serialized.as_bytes(), Some(0o600))?;
    Ok(conflict)
}

fn ensure_note_is_writable(path: &Path) -> Result<(), String> {
    let mut locked_name = path.as_os_str().to_os_string();
    locked_name.push(".locked");
    if PathBuf::from(locked_name).exists() {
        return Err("Note is locked".to_string());
    }
    Ok(())
}

// Helper function to recursively scan notes in a directory
pub(crate) fn scan_notes_recursive(dir: &Path, relative_path: &str, notes: &mut Vec<NoteFile>) {
    if let Ok(entries) = fs::read_dir(dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            // Skip symlinks so we never recurse outside the notes tree.
            if fs::symlink_metadata(&path)
                .map(|m| m.file_type().is_symlink())
                .unwrap_or(false)
            {
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
                    let date = base_name
                        .strip_suffix(".md")
                        .filter(|s| is_date_stem(s))
                        .map(|s| s.to_string());
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
                    let date = filename
                        .strip_suffix(".md")
                        .filter(|s| is_date_stem(s))
                        .map(|s| s.to_string());
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
                    let week = base_name
                        .strip_suffix(".md")
                        .filter(|s| is_week_stem(s))
                        .map(|s| s.to_string());
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
                    let week = filename
                        .strip_suffix(".md")
                        .filter(|s| is_week_stem(s))
                        .map(|s| s.to_string());
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

/// Read one addressed note body plus the hash used for optimistic conflict checks.
///
/// A missing file is represented as empty content and its empty-content hash;
/// callers use that stable base when creating a note through the write path.
#[tauri::command]
pub(crate) fn read_note(
    filename: String,
    is_daily: bool,
    is_weekly: bool,
) -> Result<NoteRead, String> {
    // Prevent path traversal attacks; standalone notes may include a folder path.
    if !is_valid_note_ref(&filename, is_daily, is_weekly) {
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
            content_hash: sha256_hex(""),
        });
    }

    let raw = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    let parsed = frontmatter::parse_note(&raw);
    Ok(NoteRead {
        content_hash: sha256_hex(&parsed.body),
        content: parsed.body,
        color: parsed.color,
    })
}

// Tauri command parameters map 1:1 to the IPC payload; grouping them into a
// struct would change the wire shape for every existing caller.
/// Atomically save a note, preserving an externally changed disk copy on hash mismatch.
///
/// `base_hash` must be the hash returned by the caller's latest read or save.
/// Successful writes return the new base hash and any conflict-copy address.
#[allow(clippy::too_many_arguments)]
#[tauri::command]
pub(crate) fn write_note(
    filename: String,
    content: String,
    is_daily: bool,
    is_weekly: bool,
    color: Option<String>,
    base_hash: Option<String>,
    index: State<'_, Arc<BacklinksIndex>>,
    recent: State<'_, Arc<RecentWrites>>,
) -> Result<NoteWriteResult, String> {
    // Prevent path traversal attacks; standalone notes may include a folder path.
    if !is_valid_note_ref(&filename, is_daily, is_weekly) {
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
    // External-edit conflict safety: if the disk copy changed since the
    // frontend last read it (and differs from what we're about to write),
    // preserve the disk version as a sibling conflict copy first so the
    // save below can never silently destroy it.
    let conflict_copy =
        match save_note_with_conflict(&path, base_hash.as_deref(), &content, color.as_deref())? {
            Some((conflict_name, disk_body)) => {
                if let Some(parent) = path.parent() {
                    // The copy is our own write — suppress the watcher echo.
                    recent.record(&parent.join(&conflict_name));
                }
                index.update_note(&conflict_name, &disk_body);
                // Echo back the same folder-relative shape we were addressed with.
                let rel = match filename.rsplit_once('/') {
                    Some((folder, _)) => format!("{}/{}", folder, conflict_name),
                    None => conflict_name,
                };
                Some(rel)
            }
            None => None,
        };

    recent.record(&path);

    // The backlinks index only cares about the body, not frontmatter.
    index.update_note(&index_key(&filename), &content);

    // Keep the semantic index fresh (debounced, async; no-op when disabled).
    crate::semantic::note_changed(&crate::semantic::note_rel_path(
        &filename, is_daily, is_weekly,
    ));
    if let Some(rel) = conflict_copy.as_deref() {
        crate::semantic::note_changed(&crate::semantic::note_rel_path(rel, is_daily, is_weekly));
    }

    Ok(NoteWriteResult {
        content_hash: sha256_hex(&content),
        conflict_copy,
    })
}

#[tauri::command]
pub(crate) fn delete_note(
    filename: String,
    is_daily: bool,
    is_weekly: bool,
    base_hash: Option<String>,
    index: State<'_, Arc<BacklinksIndex>>,
) -> Result<(), String> {
    // Prevent path traversal attacks; standalone notes may include a folder path.
    if !is_valid_note_ref(&filename, is_daily, is_weekly) {
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

    delete_note_at(&path, base_hash.as_deref())?;
    index.remove_note(&index_key(&filename));
    crate::semantic::note_removed(&crate::semantic::note_rel_path(
        &filename, is_daily, is_weekly,
    ));
    Ok(())
}

#[tauri::command]
pub(crate) fn preserve_buffer_copy(
    filename: String,
    is_daily: bool,
    is_weekly: bool,
    content: String,
    index: State<'_, Arc<BacklinksIndex>>,
    recent: State<'_, Arc<RecentWrites>>,
) -> Result<String, String> {
    if !is_valid_note_ref(&filename, is_daily, is_weekly) {
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
    validate_path_within_base(&path, &dir).map_err(|_| "Invalid note path".to_string())?;

    let stamp = chrono::Local::now().format("%Y-%m-%d %H%M").to_string();
    let conflict_name = {
        let _guard = conflict_copy_lock()
            .lock()
            .map_err(|_| "Conflict-copy lock poisoned".to_string())?;
        preserve_buffer_copy_unlocked(&path, &content, &stamp)?
    };
    let conflict_path = path
        .parent()
        .ok_or_else(|| "Invalid note path".to_string())?
        .join(&conflict_name);
    recent.record(&conflict_path);
    index.update_note(&conflict_name, &content);

    let relative = match filename.rsplit_once('/') {
        Some((folder, _)) => format!("{}/{}", folder, conflict_name),
        None => conflict_name,
    };
    crate::semantic::note_changed(&crate::semantic::note_rel_path(
        &relative, is_daily, is_weekly,
    ));
    Ok(relative)
}

#[tauri::command]
pub(crate) fn create_note(
    title: String,
    folder_path: Option<String>,
    index: State<'_, Arc<BacklinksIndex>>,
) -> Result<String, String> {
    let base_dir = get_standalone_dir();
    let (filename, relative_path) =
        create_note_in(&base_dir, &title, folder_path.as_deref())?;
    index.update_note(&filename, "");
    Ok(relative_path)
}

fn create_note_in(
    base_dir: &Path,
    title: &str,
    folder_path: Option<&str>,
) -> Result<(String, String), String> {
    if !is_safe_filename(title) {
        return Err("Invalid title".to_string());
    }
    if let Some(folder) = folder_path {
        if !is_safe_note_path(folder) {
            return Err("Invalid folder path".to_string());
        }
    }

    let dir = match folder_path {
        Some(folder) => base_dir.join(folder),
        None => base_dir.to_path_buf(),
    };
    if folder_path.is_some() {
        validate_path_within_base(&dir, base_dir)
            .map_err(|_| "Invalid folder path".to_string())?;
    }

    // Ensure the folder exists
    if !dir.exists() {
        return Err("Folder does not exist".to_string());
    }

    // Generate unique filename if needed
    let filename = generate_unique_filename(&dir, title, "md");
    let path = dir.join(&filename);
    validate_path_within_base(&path, base_dir).map_err(|_| "Invalid note path".to_string())?;

    write_atomic(&path, b"", Some(0o600))?;

    // Return the full relative path
    match folder_path {
        Some(folder) => Ok((filename.clone(), format!("{}/{}", folder, filename))),
        None => Ok((filename.clone(), filename)),
    }
}

#[tauri::command]
pub(crate) fn duplicate_note(
    filename: String,
    is_daily: bool,
    is_weekly: bool,
    index: State<'_, Arc<BacklinksIndex>>,
) -> Result<String, String> {
    if !is_valid_note_ref(&filename, is_daily, is_weekly) {
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
    write_atomic(&new_path, content.as_bytes(), Some(0o600))?;

    index.update_note(&index_key(&new_filename), &content);

    crate::semantic::note_changed(&crate::semantic::note_rel_path(
        &new_filename,
        is_daily,
        is_weekly,
    ));

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
    write_atomic(dest_path, content.as_bytes(), None)?;

    Ok(destination)
}

/// Rename a note and rewrite inbound wiki-link targets after the disk rename succeeds.
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

    // A rename must not break inbound [[links]]: rewrite targets that
    // resolved to the old name in every other note.
    let old_stem = old_filename.trim_end_matches(".md");
    let new_stem = new_filename.trim_end_matches(".md");
    rewrite_inbound_links(old_stem, new_stem, &index);

    crate::semantic::note_removed(&crate::semantic::note_rel_path(
        &old_filename,
        is_daily,
        is_weekly,
    ));
    crate::semantic::note_changed(&crate::semantic::note_rel_path(
        &new_filename,
        is_daily,
        is_weekly,
    ));

    Ok(())
}

/// Rewrite `[[old]]` links across the whole vault after a note rename.
/// Failures on individual files are logged and skipped so one unreadable
/// note doesn't abort the rename that already happened.
fn rewrite_inbound_links(old_stem: &str, new_stem: &str, index: &Arc<BacklinksIndex>) {
    rewrite_inbound_links_in_roots(
        &[get_daily_dir(), get_weekly_dir(), get_standalone_dir()],
        old_stem,
        new_stem,
        index,
        None,
    );
}

fn rewrite_inbound_links_in_roots(
    roots: &[PathBuf],
    old_stem: &str,
    new_stem: &str,
    index: &Arc<BacklinksIndex>,
    resolver: Option<&crate::backlinks_index::Resolver>,
) {
    for root in roots {
        if !root.exists() {
            continue;
        }
        for entry in walkdir::WalkDir::new(root)
            .into_iter()
            .filter_entry(|e| !e.file_name().to_string_lossy().starts_with('.'))
            .flatten()
        {
            let path = entry.path();
            if !entry.file_type().is_file()
                || path.extension().and_then(|s| s.to_str()) != Some("md")
            {
                continue;
            }
            let Ok(raw) = fs::read_to_string(path) else {
                continue;
            };
            let Some(rewritten) = crate::wiki::rewrite_links_for_rename(&raw, old_stem, new_stem)
            else {
                continue;
            };
            if let Err(e) = write_atomic(path, rewritten.as_bytes(), Some(0o600)) {
                log::warn!("rename: failed to rewrite links in {:?}: {}", path, e);
                continue;
            }
            if let Some(name) = path.file_name().and_then(|s| s.to_str()) {
                let body = crate::frontmatter::parse_note(&rewritten).body;
                if let Some(resolver) = resolver {
                    index.update_note_with(name, &body, resolver);
                } else {
                    index.update_note(name, &body);
                }
            }
        }
    }
}

#[tauri::command]
pub(crate) fn clear_all_notes(index: State<'_, Arc<BacklinksIndex>>) -> Result<(), String> {
    let roots = [get_daily_dir(), get_weekly_dir(), get_standalone_dir()];
    visit_note_files(&roots, |path| {
        fs::remove_file(path).map_err(|e| e.to_string())
    })?;

    index.remove_all();
    crate::semantic::all_notes_removed();

    Ok(())
}

fn visit_note_files(
    roots: &[PathBuf],
    mut operation: impl FnMut(&Path) -> Result<(), String>,
) -> Result<u32, String> {
    let mut count = 0;
    for root in roots {
        if !root.exists() {
            continue;
        }
        for entry in walkdir::WalkDir::new(root)
            .follow_links(false)
            .into_iter()
            .filter_entry(|entry| {
                entry.depth() == 0
                    || !entry.file_type().is_dir()
                    || !entry.file_name().to_string_lossy().starts_with('.')
            })
        {
            let entry = entry.map_err(|e| e.to_string())?;
            if !entry.file_type().is_file() {
                continue;
            }
            let name = entry.file_name().to_string_lossy();
            if !name.ends_with(".md") && !name.ends_with(".md.locked") {
                continue;
            }
            operation(entry.path())?;
            count += 1;
        }
    }
    Ok(count)
}

/// Move a standalone note within `notes/` and return its new relative address.
#[tauri::command]
pub(crate) fn move_note(
    note_path: String,
    to_folder: Option<String>,
    index: State<'_, Arc<BacklinksIndex>>,
) -> Result<String, String> {
    let standalone_dir = get_standalone_dir();
    let (old_filename, final_filename, new_relative_path, dest_path) =
        move_note_in(&standalone_dir, &note_path, to_folder.as_deref())?;

    // Keep backlinks index in sync: drop entries from old filename, then
    // re-index using the (possibly deduplicated) new filename + content.
    index.remove_note(&old_filename);
    let content = fs::read_to_string(&dest_path).unwrap_or_default();
    index.update_note(&final_filename, &content);

    crate::semantic::note_removed(&format!("notes/{}", note_path));
    crate::semantic::note_changed(&format!("notes/{}", new_relative_path));

    Ok(format!("notes/{}", new_relative_path))
}

fn move_note_in(
    standalone_dir: &Path,
    note_path: &str,
    to_folder: Option<&str>,
) -> Result<(String, String, String, PathBuf), String> {
    if !is_safe_note_path(note_path) {
        return Err("Invalid note path".to_string());
    }
    if let Some(folder) = to_folder {
        if !is_safe_note_path(folder) {
            return Err("Invalid folder path".to_string());
        }
    }

    let source_path = standalone_dir.join(note_path);
    validate_path_within_base(&source_path, standalone_dir)
        .map_err(|_| "Invalid note path".to_string())?;

    if !source_path.exists() {
        return Err("Note not found".to_string());
    }

    // Get the filename and extract base name without extension
    let filename = source_path
        .file_name()
        .ok_or_else(|| "Invalid note path".to_string())?
        .to_string_lossy()
        .to_string();

    // Calculate destination path
    let dest_dir = match to_folder {
        Some(folder) => standalone_dir.join(folder),
        None => standalone_dir.to_path_buf(),
    };
    if to_folder.is_some() {
        validate_path_within_base(&dest_dir, standalone_dir)
            .map_err(|_| "Invalid folder path".to_string())?;
    }

    // Ensure destination folder exists
    if !dest_dir.exists() {
        return Err("Destination folder does not exist".to_string());
    }

    // Generate unique filename if needed (handle conflicts)
    let base_name = filename.trim_end_matches(".md");
    let final_filename = generate_unique_filename(&dest_dir, base_name, "md");
    let dest_path = dest_dir.join(&final_filename);
    validate_path_within_base(&dest_path, standalone_dir)
        .map_err(|_| "Invalid note path".to_string())?;

    // Move the file
    fs::rename(&source_path, &dest_path).map_err(|e| format!("Failed to move note: {}", e))?;

    // Return new relative path
    let new_relative_path = match to_folder {
        Some(folder) => format!("{}/{}", folder, final_filename),
        None => final_filename.clone(),
    };

    Ok((filename, final_filename, new_relative_path, dest_path))
}

// Fix permissions on existing note files
#[tauri::command]
pub(crate) fn fix_note_permissions() -> Result<u32, String> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mut fixed_count = 0u32;

        let roots = [get_daily_dir(), get_weekly_dir(), get_standalone_dir()];
        fixed_count += visit_note_files(&roots, |path| {
            let permissions = fs::Permissions::from_mode(0o600);
            fs::set_permissions(path, permissions).map_err(|e| e.to_string())
        })?;

        Ok(fixed_count)
    }

    #[cfg(not(unix))]
    Ok(0)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    struct TempDir(PathBuf);
    impl TempDir {
        fn new(tag: &str) -> Self {
            let base = std::env::temp_dir().join(format!(
                "moldavite-conflict-{}-{}",
                tag,
                std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .unwrap()
                    .as_nanos()
            ));
            fs::create_dir_all(&base).unwrap();
            Self(base)
        }
        fn path(&self) -> &Path {
            &self.0
        }
    }
    impl Drop for TempDir {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    const STAMP: &str = "2026-07-12 1015";

    #[test]
    fn conflict_creates_copy_and_both_versions_survive() {
        let tmp = TempDir::new("basic");
        let path = tmp.path().join("note.md");
        // Frontend last read "original"; an external tool wrote "external".
        fs::write(&path, "external").unwrap();
        let base = sha256_hex("original");

        let result = preserve_conflict_copy_at(&path, Some(&base), "mine", STAMP)
            .unwrap()
            .expect("conflict copy should be created");
        assert_eq!(result.0, format!("note (conflict {}).md", STAMP));
        assert_eq!(result.1, "external");

        // Simulate the main write that follows the copy.
        write_atomic(&path, b"mine", Some(0o600)).unwrap();

        // Both versions are intact on disk.
        assert_eq!(fs::read_to_string(&path).unwrap(), "mine");
        assert_eq!(
            fs::read_to_string(tmp.path().join(&result.0)).unwrap(),
            "external"
        );
    }

    #[test]
    fn conflict_copy_preserves_frontmatter_byte_for_byte() {
        let tmp = TempDir::new("frontmatter");
        let path = tmp.path().join("note.md");
        let raw = "---\ncolor: blue\ncustom: kept\n---\nexternal body";
        fs::write(&path, raw).unwrap();
        let base = sha256_hex("original body");

        let (name, body) = preserve_conflict_copy_at(&path, Some(&base), "mine", STAMP)
            .unwrap()
            .expect("conflict copy should be created");
        assert_eq!(body, "external body");
        assert_eq!(fs::read_to_string(tmp.path().join(&name)).unwrap(), raw);
    }

    #[test]
    fn no_conflict_when_base_hash_matches_disk() {
        let tmp = TempDir::new("match");
        let path = tmp.path().join("note.md");
        fs::write(&path, "same content").unwrap();
        let base = sha256_hex("same content");

        let result = preserve_conflict_copy_at(&path, Some(&base), "mine", STAMP).unwrap();
        assert!(result.is_none());
        // No stray conflict files.
        assert_eq!(fs::read_dir(tmp.path()).unwrap().count(), 1);
    }

    #[test]
    fn no_conflict_when_base_hash_is_none() {
        let tmp = TempDir::new("none");
        let path = tmp.path().join("note.md");
        fs::write(&path, "external").unwrap();

        let result = preserve_conflict_copy_at(&path, None, "mine", STAMP).unwrap();
        assert!(result.is_none());
        assert_eq!(fs::read_dir(tmp.path()).unwrap().count(), 1);
    }

    #[test]
    fn no_conflict_when_incoming_content_equals_disk() {
        let tmp = TempDir::new("identical");
        let path = tmp.path().join("note.md");
        fs::write(&path, "external").unwrap();
        // Base is stale, but we're writing the exact disk content anyway.
        let base = sha256_hex("original");

        let result = preserve_conflict_copy_at(&path, Some(&base), "external", STAMP).unwrap();
        assert!(result.is_none());
    }

    #[test]
    fn no_conflict_when_file_is_missing() {
        let tmp = TempDir::new("missing");
        let path = tmp.path().join("nope.md");
        let base = sha256_hex("anything");

        let result = preserve_conflict_copy_at(&path, Some(&base), "mine", STAMP).unwrap();
        assert!(result.is_none());
    }

    #[test]
    fn locked_sibling_prevents_plaintext_recreation() {
        let tmp = TempDir::new("locked");
        let path = tmp.path().join("secret.md");
        fs::write(tmp.path().join("secret.md.locked"), "ciphertext").unwrap();

        assert_eq!(
            ensure_note_is_writable(&path),
            Err("Note is locked".to_string())
        );
        assert!(!path.exists());
    }

    #[test]
    fn guarded_delete_removes_matching_disk_body() {
        let tmp = TempDir::new("guarded-delete-match");
        let path = tmp.path().join("note.md");
        fs::write(&path, "---\ncolor: blue\n---\nbody").unwrap();

        assert_eq!(delete_note_at(&path, Some(&sha256_hex("body"))), Ok(true));
        assert!(!path.exists());
    }

    #[test]
    fn guarded_delete_rejects_changed_disk_body() {
        let tmp = TempDir::new("guarded-delete-mismatch");
        let path = tmp.path().join("note.md");
        fs::write(&path, "external body").unwrap();

        assert_eq!(
            delete_note_at(&path, Some(&sha256_hex("previous body"))),
            Err("Note changed on disk since it was last read — not deleting".to_string())
        );
        assert_eq!(fs::read_to_string(&path).unwrap(), "external body");
    }

    #[test]
    fn unguarded_delete_keeps_legacy_behavior() {
        let tmp = TempDir::new("unguarded-delete");
        let path = tmp.path().join("note.md");
        fs::write(&path, "external body").unwrap();

        assert_eq!(delete_note_at(&path, None), Ok(true));
        assert!(!path.exists());
    }

    #[test]
    fn conflict_filename_is_uniquified_with_counter() {
        let tmp = TempDir::new("unique");
        let path = tmp.path().join("note.md");
        fs::write(&path, "external one").unwrap();
        let base = sha256_hex("original");

        let (first, _) = preserve_conflict_copy_at(&path, Some(&base), "mine", STAMP)
            .unwrap()
            .unwrap();
        assert_eq!(first, format!("note (conflict {}).md", STAMP));

        // Same minute, still-diverged disk: the second copy must not clobber
        // the first.
        fs::write(&path, "external two").unwrap();
        let (second, _) = preserve_conflict_copy_at(&path, Some(&base), "mine", STAMP)
            .unwrap()
            .unwrap();
        assert_eq!(second, format!("note (conflict {}) (2).md", STAMP));
        assert_eq!(
            fs::read_to_string(tmp.path().join(&first)).unwrap(),
            "external one"
        );
        assert_eq!(
            fs::read_to_string(tmp.path().join(&second)).unwrap(),
            "external two"
        );
    }

    #[test]
    fn preserved_buffer_copy_uses_unique_conflict_names() {
        let tmp = TempDir::new("buffer-copy-unique");
        let path = tmp.path().join("note.md");

        let first = preserve_buffer_copy_at(&path, "first buffer", STAMP).unwrap();
        let second = preserve_buffer_copy_at(&path, "second buffer", STAMP).unwrap();

        assert_eq!(first, format!("note (conflict {}).md", STAMP));
        assert_eq!(second, format!("note (conflict {}) (2).md", STAMP));
        assert_eq!(
            fs::read_to_string(tmp.path().join(first)).unwrap(),
            "first buffer"
        );
        assert_eq!(
            fs::read_to_string(tmp.path().join(second)).unwrap(),
            "second buffer"
        );
    }

    #[test]
    fn conflict_filename_uniquifies_twelve_same_minute_collisions() {
        let tmp = TempDir::new("many-collisions");
        let path = tmp.path().join("note.md");
        let base = sha256_hex("original");
        for i in 0..12 {
            fs::write(&path, format!("external {i}")).unwrap();
            let (name, body) = preserve_conflict_copy_at(&path, Some(&base), "mine", STAMP)
                .unwrap()
                .unwrap();
            assert_eq!(body, format!("external {i}"));
            assert_eq!(fs::read_to_string(tmp.path().join(name)).unwrap(), body);
        }
        assert_eq!(fs::read_dir(tmp.path()).unwrap().count(), 13);
    }

    #[test]
    fn concurrent_conflict_copies_never_clobber_each_other() {
        let tmp = TempDir::new("threaded-collisions");
        let path = tmp.path().join("nested/Projects/note.md");
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(&path, "external").unwrap();
        let base = sha256_hex("original");
        std::thread::scope(|scope| {
            let mut handles = Vec::new();
            for _ in 0..16 {
                let path = path.clone();
                let base = base.clone();
                handles.push(scope.spawn(move || {
                    preserve_conflict_copy_at(&path, Some(&base), "mine", STAMP)
                        .unwrap()
                        .unwrap()
                        .0
                }));
            }
            let mut names: Vec<String> = handles
                .into_iter()
                .map(|handle| handle.join().unwrap())
                .collect();
            names.sort();
            names.dedup();
            assert_eq!(names.len(), 16);
            assert!(names.iter().all(|name| {
                fs::read_to_string(path.parent().unwrap().join(name)).unwrap() == "external"
            }));
        });
    }

    #[test]
    fn concurrent_app_saves_preserve_external_and_both_app_versions() {
        let tmp = TempDir::new("external-app-race");
        let path = tmp.path().join("note.md");
        fs::write(&path, "external version").unwrap();
        let base = sha256_hex("original version");
        let barrier = Arc::new(std::sync::Barrier::new(3));
        std::thread::scope(|scope| {
            let mut handles = Vec::new();
            for content in ["app version A", "app version B"] {
                let path = path.clone();
                let base = base.clone();
                let barrier = barrier.clone();
                handles.push(scope.spawn(move || {
                    barrier.wait();
                    save_note_with_conflict(&path, Some(&base), content, None)
                        .unwrap()
                        .unwrap()
                        .0
                }));
            }
            barrier.wait();
            let conflict_names: Vec<String> = handles
                .into_iter()
                .map(|handle| handle.join().unwrap())
                .collect();
            assert_ne!(conflict_names[0], conflict_names[1]);
            let mut versions = vec![fs::read_to_string(&path).unwrap()];
            versions.extend(
                conflict_names
                    .iter()
                    .map(|name| fs::read_to_string(tmp.path().join(name)).unwrap()),
            );
            versions.sort();
            assert_eq!(
                versions,
                vec!["app version A", "app version B", "external version"]
            );
        });
    }

    #[test]
    fn nested_conflict_copy_survives_followup_rename() {
        let tmp = TempDir::new("nested-rename");
        let dir = tmp.path().join("Área/日本語");
        fs::create_dir_all(&dir).unwrap();
        let path = dir.join("café.md");
        fs::write(&path, "external version").unwrap();
        let base = sha256_hex("original");
        let (conflict, _) = preserve_conflict_copy_at(&path, Some(&base), "app version", STAMP)
            .unwrap()
            .unwrap();
        write_atomic(&path, b"app version", Some(0o600)).unwrap();
        let renamed = dir.join("résumé.md");
        fs::rename(&path, &renamed).unwrap();
        assert_eq!(fs::read_to_string(renamed).unwrap(), "app version");
        assert_eq!(
            fs::read_to_string(dir.join(conflict)).unwrap(),
            "external version"
        );
    }

    #[test]
    fn conflict_filename_passes_path_validation() {
        let tmp = TempDir::new("valid-name");
        let path = tmp.path().join("note.md");
        fs::write(&path, "external").unwrap();
        let base = sha256_hex("original");

        let (name, _) = preserve_conflict_copy_at(&path, Some(&base), "mine", STAMP)
            .unwrap()
            .unwrap();
        assert!(is_safe_filename(&name));
        assert!(is_safe_note_path(&name));
    }

    #[test]
    fn sha256_hex_matches_known_vector() {
        assert_eq!(
            sha256_hex(""),
            "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
        );
        assert_eq!(
            sha256_hex("abc"),
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        );
    }

    #[test]
    fn date_and_week_stems_are_strictly_validated() {
        assert!(is_date_stem("2025-01-01"));
        assert!(!is_date_stem("2025-01-01 (conflict 2026-07-12 1015)"));
        assert!(!is_date_stem("2025-1-1"));
        assert!(!is_date_stem("notes"));

        assert!(is_week_stem("2024-W52"));
        assert!(!is_week_stem("2024-W52 (conflict 2026-07-12 1015)"));
        assert!(!is_week_stem("2024-52"));
    }

    #[test]
    fn create_note_rejects_absolute_inputs_and_accepts_valid_nested_folder() {
        let tmp = TempDir::new("create-validation");
        let notes = tmp.path().join("notes");
        let projects = notes.join("Projects/Active");
        fs::create_dir_all(&projects).unwrap();

        assert!(create_note_in(&notes, "/tmp/escaped", None).is_err());
        assert!(
            create_note_in(&notes, "Safe title", Some(tmp.path().to_str().unwrap())).is_err()
        );
        assert!(!tmp.path().join("escaped.md").exists());

        let (filename, relative) =
            create_note_in(&notes, "Project plan", Some("Projects/Active")).unwrap();
        assert_eq!(filename, "Project plan.md");
        assert_eq!(relative, "Projects/Active/Project plan.md");
        assert!(projects.join("Project plan.md").is_file());
    }

    #[test]
    fn move_note_rejects_absolute_source_and_destination_and_accepts_nested_paths() {
        let tmp = TempDir::new("move-validation");
        let notes = tmp.path().join("notes");
        fs::create_dir_all(notes.join("Projects")).unwrap();
        fs::create_dir_all(notes.join("Archive")).unwrap();
        fs::write(notes.join("Projects/note.md"), "body").unwrap();
        let outside = tmp.path().join("outside");
        fs::create_dir_all(&outside).unwrap();
        fs::write(outside.join("keep.md"), "keep").unwrap();

        assert!(move_note_in(&notes, outside.join("keep.md").to_str().unwrap(), None).is_err());
        assert!(
            move_note_in(&notes, "Projects/note.md", Some(outside.to_str().unwrap())).is_err()
        );
        assert!(outside.join("keep.md").exists());
        assert!(notes.join("Projects/note.md").exists());

        let (_, final_filename, relative, destination) =
            move_note_in(&notes, "Projects/note.md", Some("Archive")).unwrap();
        assert_eq!(final_filename, "note.md");
        assert_eq!(relative, "Archive/note.md");
        assert_eq!(fs::read_to_string(destination).unwrap(), "body");
    }

    #[test]
    fn clear_all_notes_recursively_removes_weekly_nested_and_locked_files() {
        let tmp = TempDir::new("clear-recursive");
        let daily = tmp.path().join("daily");
        let weekly = tmp.path().join("weekly");
        let notes = tmp.path().join("notes");
        for dir in [
            daily.join("Nested"),
            weekly.join("Nested"),
            notes.join("Projects/Deep"),
            notes.join(".hidden"),
        ] {
            fs::create_dir_all(dir).unwrap();
        }
        for path in [
            daily.join("today.md"),
            daily.join("Nested/today.md.locked"),
            weekly.join("week.md"),
            weekly.join("Nested/week.md.locked"),
            notes.join("Projects/Deep/note.md"),
            notes.join("Projects/Deep/secret.md.locked"),
        ] {
            fs::write(path, "note").unwrap();
        }
        fs::write(notes.join("Projects/Deep/keep.txt"), "keep").unwrap();
        fs::write(notes.join(".hidden/keep.md"), "hidden").unwrap();

        let removed = visit_note_files(&[daily, weekly, notes.clone()], |path| {
            fs::remove_file(path).map_err(|e| e.to_string())
        })
        .unwrap();
        assert_eq!(removed, 6);
        assert!(notes.join("Projects/Deep/keep.txt").exists());
        assert!(notes.join(".hidden/keep.md").exists());
    }

    #[cfg(unix)]
    #[test]
    fn fix_note_permissions_recursively_secures_weekly_nested_and_locked_files() {
        use std::os::unix::fs::PermissionsExt;

        let tmp = TempDir::new("permissions-recursive");
        let daily = tmp.path().join("daily");
        let weekly = tmp.path().join("weekly/Nested");
        let notes = tmp.path().join("notes/Projects");
        for dir in [&daily, &weekly, &notes] {
            fs::create_dir_all(dir).unwrap();
        }
        let files = [
            daily.join("today.md"),
            weekly.join("week.md"),
            weekly.join("secret.md.locked"),
            notes.join("note.md"),
        ];
        for path in &files {
            fs::write(path, "note").unwrap();
            fs::set_permissions(path, fs::Permissions::from_mode(0o644)).unwrap();
        }

        let fixed = visit_note_files(
            &[
                tmp.path().join("daily"),
                tmp.path().join("weekly"),
                tmp.path().join("notes"),
            ],
            |path| {
                fs::set_permissions(path, fs::Permissions::from_mode(0o600))
                    .map_err(|e| e.to_string())
            },
        )
        .unwrap();
        assert_eq!(fixed, files.len() as u32);
        for path in files {
            assert_eq!(fs::metadata(path).unwrap().permissions().mode() & 0o777, 0o600);
        }
    }

    #[test]
    fn stress_rewrite_500_inbound_links_across_folders_unicode_and_locked_notes() {
        let tmp = TempDir::new("rewrite-large-unicode");
        let daily = tmp.path().join("daily");
        let weekly = tmp.path().join("weekly");
        let original_notes = tmp.path().join("notes/Original/深い");
        for dir in [&daily, &weekly, &original_notes] {
            fs::create_dir_all(dir).unwrap();
        }
        for i in 0..550 {
            fs::write(
                original_notes.join(format!("inbound-{i}.md")),
                format!("# Inbound {i}\nSee [[Café]] and [[label|café]]."),
            )
            .unwrap();
        }
        fs::write(
            original_notes.join("locked.md.locked"),
            "ciphertext containing [[café]] must stay byte-identical",
        )
        .unwrap();
        fs::rename(
            tmp.path().join("notes/Original"),
            tmp.path().join("notes/Moved"),
        )
        .unwrap();
        let notes = tmp.path().join("notes/Moved/深い");
        let locked = notes.join("locked.md.locked");
        let index = Arc::new(BacklinksIndex::new());
        let started = std::time::Instant::now();
        rewrite_inbound_links_in_roots(
            &[daily, weekly, tmp.path().join("notes")],
            "café",
            "日本語ノート",
            &index,
            Some(&crate::wiki::note_name_to_filename),
        );
        let elapsed = started.elapsed();
        for i in 0..550 {
            let body = fs::read_to_string(notes.join(format!("inbound-{i}.md"))).unwrap();
            assert!(body.contains("[[日本語ノート]]"));
            assert!(body.contains("[[label|日本語ノート]]"));
            assert!(!body.contains("[[Café]]"));
        }
        assert_eq!(
            fs::read_to_string(locked).unwrap(),
            "ciphertext containing [[café]] must stay byte-identical"
        );
        eprintln!("[stress] rewrote 550 foldered Unicode backlinks in {elapsed:?}");
        assert!(elapsed.as_secs() < 30, "link rewrite took {elapsed:?}");
    }
}

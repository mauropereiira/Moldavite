//! Note CRUD operations
//!
//! This module handles all note-related Tauri commands including:
//! - Listing notes (daily, weekly, standalone)
//! - Reading and writing note content
//! - Creating, duplicating, and deleting notes
//! - Renaming and exporting notes
//!
//! # Security
//! All commands validate paths to prevent directory traversal attacks.
//! File permissions are set to 0o600 (owner read/write only) on Unix systems.

// Note: These imports will be used when commands are migrated to this module
// use crate::utils::{
//     get_daily_dir, get_notes_dir, get_standalone_dir, get_weekly_dir,
//     set_dir_permissions, set_file_permissions,
// };
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::Path;

// =============================================================================
// DATA STRUCTURES
// =============================================================================

/// Represents a note file in the system
#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NoteFile {
    /// The filename (e.g., "my-note.md")
    pub name: String,
    /// The full relative path (e.g., "notes/folder/my-note.md")
    pub path: String,
    /// Whether this is a daily note
    pub is_daily: bool,
    /// Whether this is a weekly note
    pub is_weekly: bool,
    /// The date for daily notes (YYYY-MM-DD format)
    pub date: Option<String>,
    /// The week identifier for weekly notes (YYYY-WNN format)
    pub week: Option<String>,
    /// Whether the note is encrypted/locked
    pub is_locked: bool,
    /// The folder path for standalone notes
    pub folder_path: Option<String>,
}

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/// Generate a unique filename by appending (2), (3), etc. if needed
pub fn generate_unique_filename(dir: &Path, base_name: &str, extension: &str) -> String {
    let filename = format!("{}.{}", base_name, extension);
    let path = dir.join(&filename);

    if !path.exists() {
        return filename;
    }

    let re = regex::Regex::new(r"^(.+) \((\d+)\)$").unwrap();
    let (actual_base, start_num) = if let Some(caps) = re.captures(base_name) {
        (
            caps.get(1).unwrap().as_str().to_string(),
            caps.get(2).unwrap().as_str().parse::<u32>().unwrap_or(1),
        )
    } else {
        (base_name.to_string(), 1)
    };

    let mut counter = if start_num == 1 { 2 } else { start_num + 1 };

    loop {
        let new_filename = format!("{} ({}).{}", actual_base, counter, extension);
        let new_path = dir.join(&new_filename);
        if !new_path.exists() {
            return new_filename;
        }
        counter += 1;
        if counter > 10000 {
            let timestamp = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_secs();
            return format!("{} ({}).{}", actual_base, timestamp, extension);
        }
    }
}

/// Recursively scan notes in a directory
pub fn scan_notes_recursive(dir: &Path, relative_path: &str, notes: &mut Vec<NoteFile>) {
    if let Ok(entries) = fs::read_dir(dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            let filename = path.file_name().unwrap().to_string_lossy().to_string();

            if path.is_dir() {
                // Skip hidden directories
                if filename.starts_with('.') {
                    continue;
                }

                let new_relative_path = if relative_path.is_empty() {
                    filename.clone()
                } else {
                    format!("{}/{}", relative_path, filename)
                };
                scan_notes_recursive(&path, &new_relative_path, notes);
            } else if path.is_file() {
                let folder_path = if relative_path.is_empty() {
                    None
                } else {
                    Some(relative_path.to_string())
                };

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
                    });
                } else if path.extension().map_or(false, |ext| ext == "md") {
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
                    });
                }
            }
        }
    }
}

// =============================================================================
// TAURI COMMANDS
// =============================================================================

// Note: The actual Tauri command implementations remain in lib.rs for now.
// This module defines the shared types and helper functions.
//
// Commands to be migrated here:
// - ensure_directories
// - list_notes
// - read_note
// - write_note
// - delete_note
// - create_note
// - duplicate_note
// - export_single_note
// - rename_note
// - clear_all_notes
// - fix_note_permissions

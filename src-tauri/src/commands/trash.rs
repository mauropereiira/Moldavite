//! Trash/recycle bin operations
//!
//! This module handles trash-related Tauri commands including:
//! - Moving notes and folders to trash
//! - Listing and restoring trashed items
//! - Permanently deleting and emptying trash
//! - Auto-cleanup of items older than 7 days
//!
//! # Trash System Design
//! - Items are moved to `.trash/` directory in the notes folder
//! - Metadata is stored in `.trash/metadata.json`
//! - Each item gets a unique ID based on timestamp
//! - Items are automatically deleted after 7 days

use crate::utils::get_trash_dir;
use serde::{Deserialize, Serialize};
use std::fs;

// =============================================================================
// DATA STRUCTURES
// =============================================================================

/// A note or folder in the trash (returned to frontend)
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct TrashedNote {
    /// Unique identifier for this trash item
    pub id: String,
    /// Original filename or folder name
    pub filename: String,
    /// Original path before deletion
    pub original_path: String,
    /// Whether this was a daily note
    pub is_daily: bool,
    /// Whether this is a folder
    pub is_folder: bool,
    /// List of files contained (for folders)
    pub contained_files: Vec<String>,
    /// Unix timestamp when trashed
    pub trashed_at: i64,
    /// Days remaining before auto-deletion
    pub days_remaining: i32,
}

/// Metadata stored in trash/metadata.json
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct TrashedNoteMetadata {
    pub id: String,
    pub filename: String,
    pub original_path: String,
    pub is_daily: bool,
    #[serde(default)]
    pub is_folder: bool,
    #[serde(default)]
    pub contained_files: Vec<String>,
    pub trashed_at: i64,
}

/// Container for all trash metadata
#[derive(Debug, Serialize, Deserialize, Default)]
pub struct TrashMetadata {
    pub items: Vec<TrashedNoteMetadata>,
}

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/// Get the path to trash metadata file
pub fn get_trash_metadata_path() -> std::path::PathBuf {
    get_trash_dir().join("metadata.json")
}

/// Ensure the trash directory exists
pub fn ensure_trash_dir() -> Result<(), String> {
    let trash_dir = get_trash_dir();
    fs::create_dir_all(&trash_dir)
        .map_err(|e| format!("Failed to create trash directory: {}", e))?;
    Ok(())
}

/// Read trash metadata from disk
pub fn read_trash_metadata() -> TrashMetadata {
    let metadata_path = get_trash_metadata_path();
    if metadata_path.exists() {
        if let Ok(content) = fs::read_to_string(&metadata_path) {
            if let Ok(metadata) = serde_json::from_str::<TrashMetadata>(&content) {
                return metadata;
            }
        }
    }
    TrashMetadata::default()
}

/// Write trash metadata to disk
pub fn write_trash_metadata(metadata: &TrashMetadata) -> Result<(), String> {
    ensure_trash_dir()?;
    let metadata_path = get_trash_metadata_path();
    let json = serde_json::to_string_pretty(metadata).map_err(|e| e.to_string())?;
    fs::write(&metadata_path, json).map_err(|e| format!("Failed to write trash metadata: {}", e))?;
    Ok(())
}

// =============================================================================
// TAURI COMMANDS
// =============================================================================

// Note: The actual Tauri command implementations remain in lib.rs for now.
// This module defines the shared types and helper functions.
//
// Commands to be migrated here:
// - trash_note
// - trash_folder
// - list_trash
// - restore_note
// - restore_note_from_folder
// - permanently_delete_trash
// - empty_trash
// - cleanup_old_trash

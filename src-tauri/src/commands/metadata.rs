//! Note metadata operations
//!
//! This module handles note metadata-related Tauri commands including:
//! - Getting and setting note colors
//! - Loading all note colors at startup
//!
//! # Metadata Storage
//! - Stored in `.note-metadata.json` in the notes directory
//! - Currently only stores color mappings
//! - Can be extended for other per-note settings

use crate::utils::get_notes_dir;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;

// =============================================================================
// DATA STRUCTURES
// =============================================================================

/// Note metadata container
#[derive(Debug, Serialize, Deserialize, Default, Clone)]
#[serde(rename_all = "camelCase")]
pub struct NoteMetadata {
    /// Map of note path to color ID
    #[serde(default)]
    pub colors: HashMap<String, String>,
}

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/// Get the path to the metadata file
pub fn get_metadata_path() -> std::path::PathBuf {
    get_notes_dir().join(".note-metadata.json")
}

/// Read note metadata from disk
pub fn read_note_metadata() -> NoteMetadata {
    let path = get_metadata_path();
    if path.exists() {
        if let Ok(content) = fs::read_to_string(&path) {
            if let Ok(metadata) = serde_json::from_str(&content) {
                return metadata;
            }
        }
    }
    NoteMetadata::default()
}

/// Write note metadata to disk
pub fn write_note_metadata(metadata: &NoteMetadata) -> Result<(), String> {
    let path = get_metadata_path();
    let content = serde_json::to_string_pretty(metadata).map_err(|e| e.to_string())?;
    fs::write(&path, content).map_err(|e| e.to_string())?;
    Ok(())
}

// =============================================================================
// TAURI COMMANDS
// =============================================================================

// Note: The actual Tauri command implementations remain in lib.rs for now.
// This module defines the shared types and helper functions.
//
// Commands to be migrated here:
// - get_note_color
// - set_note_color
// - get_all_note_colors

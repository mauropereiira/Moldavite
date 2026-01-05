//! Import/export and backup operations
//!
//! This module handles import/export-related Tauri commands including:
//! - Exporting notes to ZIP archive
//! - Importing notes from ZIP with merge support
//! - Encrypted backup export/import
//! - Notes directory configuration
//!
//! # Backup Format
//! - Standard export: ZIP file containing markdown files
//! - Encrypted export: `.notomattic-backup` file (AES-256-GCM encrypted)

use serde::{Deserialize, Serialize};

// =============================================================================
// DATA STRUCTURES
// =============================================================================

/// Result of an import operation
#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportResult {
    /// Number of daily notes imported
    pub daily_notes: u32,
    /// Number of standalone notes imported
    pub standalone_notes: u32,
    /// Number of templates imported
    pub templates: u32,
}

// =============================================================================
// TAURI COMMANDS
// =============================================================================

// Note: The actual Tauri command implementations remain in lib.rs for now.
// This module is a placeholder for the import/export commands.
//
// Commands to be migrated here:
// - export_notes
// - import_notes
// - export_encrypted_backup
// - import_encrypted_backup
// - get_notes_directory
// - set_notes_directory

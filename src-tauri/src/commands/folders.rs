//! Folder management operations
//!
//! This module handles folder-related Tauri commands including:
//! - Listing folder hierarchy
//! - Creating, renaming, and deleting folders
//! - Moving folders and notes between folders
//!
//! # Security
//! All commands validate paths to prevent directory traversal attacks.
//! Directory permissions are set to 0o700 (owner only) on Unix systems.

// Note: These imports will be used when commands are migrated to this module
// use crate::utils::{get_standalone_dir, set_dir_permissions};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::Path;

// =============================================================================
// DATA STRUCTURES
// =============================================================================

/// Represents a folder in the hierarchy
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct FolderInfo {
    /// The folder name
    pub name: String,
    /// The relative path from the notes root
    pub path: String,
    /// Child folders
    pub children: Vec<FolderInfo>,
}

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/// Generate a unique folder name by appending (2), (3), etc. if needed
pub fn generate_unique_folder_name(parent_dir: &Path, base_name: &str) -> String {
    let path = parent_dir.join(base_name);

    if !path.exists() {
        return base_name.to_string();
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
        let new_name = format!("{} ({})", actual_base, counter);
        let new_path = parent_dir.join(&new_name);
        if !new_path.exists() {
            return new_name;
        }
        counter += 1;
        if counter > 10000 {
            let timestamp = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_secs();
            return format!("{} ({})", actual_base, timestamp);
        }
    }
}

/// Recursively scan folders and build the hierarchy
pub fn scan_folders_recursive(dir: &Path, relative_path: &str) -> Vec<FolderInfo> {
    let mut folders = Vec::new();

    if let Ok(entries) = fs::read_dir(dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                let name = path
                    .file_name()
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

                let children = scan_folders_recursive(&path, &folder_relative_path);

                folders.push(FolderInfo {
                    name,
                    path: folder_relative_path,
                    children,
                });
            }
        }
    }

    // Sort alphabetically
    folders.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));

    folders
}

// =============================================================================
// TAURI COMMANDS
// =============================================================================

// Note: The actual Tauri command implementations remain in lib.rs for now.
// This module defines the shared types and helper functions.
//
// Commands to be migrated here:
// - list_folders
// - create_folder
// - rename_folder
// - delete_folder
// - move_folder
// - move_note

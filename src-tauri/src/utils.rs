//! Shared utilities for Moldavite
//!
//! This module contains helper functions used across multiple command modules,
//! including directory paths, configuration, and file permissions.
//!
//! Note: Some functions are currently unused as command migration is in progress.

#![allow(dead_code)]

use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;

// =============================================================================
// APP CONFIGURATION
// =============================================================================

/// Application configuration stored in user's config directory
#[derive(Debug, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct AppConfig {
    pub notes_directory: Option<String>,
}

/// Get the path to the app config file
pub fn get_config_path() -> PathBuf {
    dirs::config_dir()
        .expect("Could not find config directory")
        .join("Moldavite")
        .join("config.json")
}

/// Read the app configuration from disk
pub fn read_config() -> AppConfig {
    let config_path = get_config_path();
    if config_path.exists() {
        if let Ok(content) = fs::read_to_string(&config_path) {
            if let Ok(config) = serde_json::from_str::<AppConfig>(&content) {
                return config;
            }
        }
    }
    AppConfig::default()
}

/// Write the app configuration to disk
pub fn write_config(config: &AppConfig) -> Result<(), String> {
    let config_path = get_config_path();

    // Ensure config directory exists
    if let Some(parent) = config_path.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create config directory: {}", e))?;
    }

    let json = serde_json::to_string_pretty(config).map_err(|e| e.to_string())?;
    fs::write(&config_path, json).map_err(|e| format!("Failed to write config: {}", e))?;

    Ok(())
}

// =============================================================================
// DIRECTORY PATHS
// =============================================================================

/// Get the default notes directory (Documents/Moldavite)
pub fn get_default_notes_dir() -> PathBuf {
    dirs::document_dir()
        .expect("Could not find Documents directory")
        .join("Moldavite")
}

/// Get the current notes directory (custom or default)
pub fn get_notes_dir() -> PathBuf {
    let config = read_config();
    if let Some(custom_dir) = config.notes_directory {
        let path = PathBuf::from(&custom_dir);
        if path.exists() {
            return path;
        }
    }
    get_default_notes_dir()
}

/// Get the daily notes directory
pub fn get_daily_dir() -> PathBuf {
    get_notes_dir().join("daily")
}

/// Get the standalone notes directory
pub fn get_standalone_dir() -> PathBuf {
    get_notes_dir().join("notes")
}

/// Get the weekly notes directory
pub fn get_weekly_dir() -> PathBuf {
    get_notes_dir().join("weekly")
}

/// Get the trash directory
pub fn get_trash_dir() -> PathBuf {
    get_notes_dir().join(".trash")
}

/// Get the templates directory
pub fn get_templates_dir() -> PathBuf {
    get_notes_dir().join("templates")
}

// =============================================================================
// FILE PERMISSIONS
// =============================================================================

/// Set restrictive file permissions (600 = owner read/write only)
#[cfg(unix)]
pub fn set_file_permissions(path: &std::path::Path) -> Result<(), String> {
    use std::os::unix::fs::PermissionsExt;
    let permissions = fs::Permissions::from_mode(0o600);
    fs::set_permissions(path, permissions).map_err(|e| e.to_string())
}

#[cfg(not(unix))]
pub fn set_file_permissions(_path: &std::path::Path) -> Result<(), String> {
    Ok(())
}

/// Set restrictive directory permissions (700 = owner only)
#[cfg(unix)]
pub fn set_dir_permissions(path: &std::path::Path) -> Result<(), String> {
    use std::os::unix::fs::PermissionsExt;
    let permissions = fs::Permissions::from_mode(0o700);
    fs::set_permissions(path, permissions).map_err(|e| e.to_string())
}

#[cfg(not(unix))]
pub fn set_dir_permissions(_path: &std::path::Path) -> Result<(), String> {
    Ok(())
}

// =============================================================================
// FILENAME UTILITIES
// =============================================================================

/// Generate a unique filename by appending numbers if file exists
pub fn generate_unique_filename(
    dir: &std::path::Path,
    base_name: &str,
    extension: &str,
) -> String {
    let mut filename = format!("{}.{}", base_name, extension);
    let mut counter = 1;

    while dir.join(&filename).exists() {
        filename = format!("{} ({}).{}", base_name, counter, extension);
        counter += 1;
    }

    filename
}

/// Generate a unique folder name by appending numbers if folder exists
pub fn generate_unique_folder_name(parent_dir: &std::path::Path, base_name: &str) -> String {
    let mut folder_name = base_name.to_string();
    let mut counter = 1;

    while parent_dir.join(&folder_name).exists() {
        folder_name = format!("{} ({})", base_name, counter);
        counter += 1;
    }

    folder_name
}

/// Validate a filename to prevent path traversal attacks
pub fn is_valid_filename(filename: &str) -> bool {
    !filename.contains("..")
        && !filename.contains('/')
        && !filename.contains('\\')
        && !filename.is_empty()
}

/// Validate a path to prevent traversal attacks (allows forward slashes for paths)
pub fn is_valid_path(path: &str) -> bool {
    !path.contains("..") && !path.contains('\\') && !path.is_empty()
}

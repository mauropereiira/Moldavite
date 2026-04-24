//! On-disk state read/write helpers (config, trash metadata, note metadata).

use std::fs;
use std::path::Path;

use crate::paths::{
    ensure_trash_dir, get_config_path, get_metadata_path, get_trash_metadata_path,
};
use crate::types::{AppConfig, NoteMetadata, TrashMetadata};

pub(crate) fn read_config() -> AppConfig {
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

pub(crate) fn write_config(config: &AppConfig) -> Result<(), String> {
    let config_path = get_config_path();

    // Ensure config directory exists
    if let Some(parent) = config_path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("Failed to create config directory: {}", e))?;
    }

    let json = serde_json::to_string_pretty(config).map_err(|e| e.to_string())?;
    fs::write(&config_path, &json).map_err(|e| format!("Failed to write config: {}", e))?;

    // Set restrictive permissions on config file (0o600 = owner read/write only)
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let permissions = fs::Permissions::from_mode(0o600);
        let _ = fs::set_permissions(&config_path, permissions);
    }

    Ok(())
}

pub(crate) fn read_trash_metadata() -> TrashMetadata {
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

pub(crate) fn write_trash_metadata(metadata: &TrashMetadata) -> Result<(), String> {
    ensure_trash_dir()?;
    let metadata_path = get_trash_metadata_path();
    let json = serde_json::to_string_pretty(metadata).map_err(|e| e.to_string())?;
    fs::write(&metadata_path, json).map_err(|e| format!("Failed to write trash metadata: {}", e))?;
    Ok(())
}

pub(crate) fn read_note_metadata() -> NoteMetadata {
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

pub(crate) fn write_note_metadata(metadata: &NoteMetadata) -> Result<(), String> {
    let path = get_metadata_path();
    let content = serde_json::to_string_pretty(metadata).map_err(|e| e.to_string())?;
    fs::write(&path, content).map_err(|e| e.to_string())?;
    Ok(())
}

/// Generate a unique filename in the given directory.
/// If "name.md" exists, tries "name (2).md", "name (3).md", etc.
pub(crate) fn generate_unique_filename(dir: &Path, base_name: &str, extension: &str) -> String {
    let filename = format!("{}.{}", base_name, extension);
    let path = dir.join(&filename);

    if !path.exists() {
        return filename;
    }

    // File exists, need to find a unique name
    // First, check if base_name already ends with " (N)" pattern
    let re = regex::Regex::new(r"^(.+) \((\d+)\)$").unwrap();
    let (actual_base, start_num) = if let Some(caps) = re.captures(base_name) {
        (caps.get(1).unwrap().as_str().to_string(), caps.get(2).unwrap().as_str().parse::<u32>().unwrap_or(1))
    } else {
        (base_name.to_string(), 1)
    };

    // Start from 2 if this is a fresh duplicate, or from existing number + 1
    let mut counter = if start_num == 1 { 2 } else { start_num + 1 };

    loop {
        let new_filename = format!("{} ({}).{}", actual_base, counter, extension);
        let new_path = dir.join(&new_filename);
        if !new_path.exists() {
            return new_filename;
        }
        counter += 1;
        // Safety limit to prevent infinite loops
        if counter > 10000 {
            // Fallback with timestamp
            let timestamp = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_secs();
            return format!("{} ({}).{}", actual_base, timestamp, extension);
        }
    }
}

/// Generate a unique folder name in the given directory.
pub(crate) fn generate_unique_folder_name(parent_dir: &Path, base_name: &str) -> String {
    let path = parent_dir.join(base_name);

    if !path.exists() {
        return base_name.to_string();
    }

    // Folder exists, need to find a unique name
    let re = regex::Regex::new(r"^(.+) \((\d+)\)$").unwrap();
    let (actual_base, start_num) = if let Some(caps) = re.captures(base_name) {
        (caps.get(1).unwrap().as_str().to_string(), caps.get(2).unwrap().as_str().parse::<u32>().unwrap_or(1))
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

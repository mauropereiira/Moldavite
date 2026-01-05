//! Notomattic - A privacy-first note-taking app
//!
//! This is the main library file that contains all Tauri commands.
//! The codebase is organized into modules for better maintainability:
//!
//! # Module Structure
//!
//! - `commands/` - Tauri command modules (types and helpers)
//!   - `notes.rs` - Note CRUD operations
//!   - `folders.rs` - Folder management
//!   - `trash.rs` - Trash/recycle bin
//!   - `templates.rs` - Template management
//!   - `encryption.rs` - Note locking/unlocking
//!   - `import_export.rs` - Import/export operations
//!   - `wiki.rs` - Wiki link system
//!   - `metadata.rs` - Note metadata (colors)
//!
//! - `encryption.rs` - Core AES-256-GCM encryption logic
//! - `security.rs` - Rate limiting and security utilities
//! - `calendar.rs` - macOS calendar integration (EventKit)
//! - `utils.rs` - Shared utilities (paths, config, permissions)
//!
//! # Security
//!
//! - All file operations validate paths to prevent traversal attacks
//! - File permissions are set to 0o600 (owner read/write only)
//! - Directory permissions are set to 0o700 (owner only)
//! - Note encryption uses AES-256-GCM with Argon2 key derivation
//! - Rate limiting prevents brute-force attacks on locked notes

use chrono::Local;
use lazy_static::lazy_static;
use regex::Regex;
use serde::{Deserialize, Serialize};
use std::fs;
use std::io::{Read as IoRead, Write as IoWrite};
use std::path::{Path, PathBuf};
use zip::write::SimpleFileOptions;
use zip::ZipArchive;

// =============================================================================
// MODULE DECLARATIONS
// =============================================================================

/// macOS calendar integration (EventKit)
#[cfg(target_os = "macos")]
mod calendar;
#[cfg(target_os = "macos")]
use calendar::{CalendarEvent, CalendarInfo, CalendarPermission};

/// Core encryption logic (AES-256-GCM)
mod encryption;

/// Security utilities (rate limiting)
mod security;

/// Shared utilities (paths, config, permissions)
mod utils;

/// Command modules (types and helpers)
mod commands;

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NoteFile {
    name: String,
    path: String,
    is_daily: bool,
    is_weekly: bool,
    date: Option<String>,
    week: Option<String>,
    is_locked: bool,
    folder_path: Option<String>,
}

// Folder System Data Structures

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct FolderInfo {
    name: String,
    path: String,
    children: Vec<FolderInfo>,
}

// Trash System Data Structures

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct TrashedNote {
    id: String,
    filename: String,
    original_path: String,
    is_daily: bool,
    is_folder: bool,
    contained_files: Vec<String>,
    trashed_at: i64,
    days_remaining: i32,
}

#[derive(Debug, Serialize, Deserialize, Default)]
struct TrashMetadata {
    items: Vec<TrashedNoteMetadata>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
struct TrashedNoteMetadata {
    id: String,
    filename: String,
    original_path: String,
    is_daily: bool,
    #[serde(default)]
    is_folder: bool,
    #[serde(default)]
    contained_files: Vec<String>,
    trashed_at: i64,
}

// Template System Data Structures

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct Template {
    id: String,
    name: String,
    description: String,
    icon: String,
    is_default: bool,
    content: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct TemplateFile {
    id: String,
    name: String,
    description: String,
    icon: String,
}

#[derive(Debug, Deserialize)]
struct SaveTemplateInput {
    name: String,
    description: String,
    icon: String,
    content: String,
}

// Wiki Link System Data Structures

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct WikiLink {
    text: String,
    target: String,
    exists: bool,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct BacklinkInfo {
    from_note: String,
    from_title: String,
    context: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct LinkIndex {
    note: String,
    links_to: Vec<String>,
}

// App Configuration for custom notes directory
#[derive(Debug, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct AppConfig {
    notes_directory: Option<String>,
}

// Export/Import Result structures
#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ImportResult {
    daily_notes: u32,
    standalone_notes: u32,
    templates: u32,
}

// Note Metadata for colors and other per-note settings
#[derive(Debug, Serialize, Deserialize, Default, Clone)]
#[serde(rename_all = "camelCase")]
struct NoteMetadata {
    #[serde(default)]
    colors: std::collections::HashMap<String, String>,
}

// Wiki Link Regex
lazy_static! {
    // Matches [[Note Name]] or [[Display|note-name]]
    static ref WIKI_LINK_REGEX: Regex = Regex::new(r"\[\[([^\]|]+)(?:\|([^\]]+))?\]\]").unwrap();
}

// Config file helper functions

fn get_config_path() -> PathBuf {
    dirs::config_dir()
        .expect("Could not find config directory")
        .join("Notomattic")
        .join("config.json")
}

fn read_config() -> AppConfig {
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

fn write_config(config: &AppConfig) -> Result<(), String> {
    let config_path = get_config_path();

    // Ensure config directory exists
    if let Some(parent) = config_path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("Failed to create config directory: {}", e))?;
    }

    let json = serde_json::to_string_pretty(config).map_err(|e| e.to_string())?;
    fs::write(&config_path, json).map_err(|e| format!("Failed to write config: {}", e))?;

    Ok(())
}

fn get_default_notes_dir() -> PathBuf {
    dirs::document_dir()
        .expect("Could not find Documents directory")
        .join("Notomattic")
}

fn get_notes_dir() -> PathBuf {
    let config = read_config();
    if let Some(custom_dir) = config.notes_directory {
        let path = PathBuf::from(&custom_dir);
        if path.exists() {
            return path;
        }
    }
    get_default_notes_dir()
}

fn get_daily_dir() -> PathBuf {
    get_notes_dir().join("daily")
}

fn get_standalone_dir() -> PathBuf {
    get_notes_dir().join("notes")
}

fn get_weekly_dir() -> PathBuf {
    get_notes_dir().join("weekly")
}

fn get_trash_dir() -> PathBuf {
    get_notes_dir().join(".trash")
}

fn get_trash_metadata_path() -> PathBuf {
    get_trash_dir().join("metadata.json")
}

fn ensure_trash_dir() -> Result<(), String> {
    let trash_dir = get_trash_dir();
    fs::create_dir_all(&trash_dir).map_err(|e| format!("Failed to create trash directory: {}", e))?;
    Ok(())
}

fn read_trash_metadata() -> TrashMetadata {
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

fn write_trash_metadata(metadata: &TrashMetadata) -> Result<(), String> {
    ensure_trash_dir()?;
    let metadata_path = get_trash_metadata_path();
    let json = serde_json::to_string_pretty(metadata).map_err(|e| e.to_string())?;
    fs::write(&metadata_path, json).map_err(|e| format!("Failed to write trash metadata: {}", e))?;
    Ok(())
}

// Template System Helper Functions

fn get_templates_dir() -> Result<PathBuf, String> {
    let path = get_notes_dir().join("templates");
    Ok(path)
}

fn ensure_templates_dir() -> Result<(), String> {
    let templates_dir = get_templates_dir()?;
    fs::create_dir_all(&templates_dir).map_err(|e| e.to_string())?;
    Ok(())
}

fn get_default_templates() -> Vec<Template> {
    vec![
        Template {
            id: "meeting-notes".to_string(),
            name: "Meeting Notes".to_string(),
            description: "Structured template for meeting documentation".to_string(),
            icon: "users".to_string(),
            is_default: true,
            content: include_str!("templates/meeting-notes.md").to_string(),
        },
        Template {
            id: "daily-log".to_string(),
            name: "Daily Log".to_string(),
            description: "Track your daily goals, accomplishments, and reflections".to_string(),
            icon: "calendar".to_string(),
            is_default: true,
            content: include_str!("templates/daily-log.md").to_string(),
        },
        Template {
            id: "project-plan".to_string(),
            name: "Project Plan".to_string(),
            description: "Plan and track project goals, timeline, and resources".to_string(),
            icon: "clipboard".to_string(),
            is_default: true,
            content: include_str!("templates/project-plan.md").to_string(),
        },
    ]
}

fn replace_template_variables(content: String) -> String {
    let now = Local::now();
    let date = now.format("%Y-%m-%d").to_string();
    let time = now.format("%H:%M").to_string();
    let day_of_week = now.format("%A").to_string();

    content
        .replace("{{date}}", &date)
        .replace("{{time}}", &time)
        .replace("{{day_of_week}}", &day_of_week)
}

fn generate_template_id(name: &str) -> String {
    name.to_lowercase()
        .chars()
        .map(|c| if c.is_alphanumeric() { c } else { '-' })
        .collect::<String>()
        .split('-')
        .filter(|s| !s.is_empty())
        .collect::<Vec<&str>>()
        .join("-")
}

// Wiki Link System Helper Functions

fn parse_wiki_links(content: &str) -> Vec<String> {
    let mut links = Vec::new();

    for cap in WIKI_LINK_REGEX.captures_iter(content) {
        // Get the target (second capture group if exists, otherwise first)
        let target = cap
            .get(2)
            .or_else(|| cap.get(1))
            .map(|m| m.as_str().to_string())
            .unwrap_or_default();

        if !target.is_empty() {
            links.push(target);
        }
    }

    links
}

fn note_name_to_filename(note_name: &str) -> String {
    // Convert "Meeting Notes" -> "meeting-notes.md"
    let slug = note_name
        .to_lowercase()
        .trim()
        .replace(' ', "-")
        .replace(|c: char| !c.is_alphanumeric() && c != '-', "");

    format!("{}.md", slug)
}

fn note_exists(note_name: &str) -> Result<(bool, String), String> {
    let notes_dir = get_notes_dir();

    // Try as standalone note first
    let filename = note_name_to_filename(note_name);
    let standalone_path = notes_dir.join("notes").join(&filename);

    if standalone_path.exists() {
        return Ok((true, filename));
    }

    // Try as daily note (YYYY-MM-DD format)
    let daily_filename = if note_name.ends_with(".md") {
        note_name.to_string()
    } else {
        format!("{}.md", note_name)
    };
    let daily_path = notes_dir.join("daily").join(&daily_filename);
    if daily_path.exists() {
        return Ok((true, daily_filename));
    }

    Ok((false, filename))
}

fn get_link_context(content: &str, link_text: &str) -> String {
    // Try both with and without pipe syntax
    let search_patterns = vec![
        format!("[[{}]]", link_text),
        format!("[[{}|", link_text),
    ];

    for search in search_patterns {
        if let Some(pos) = content.find(&search) {
            let start = pos.saturating_sub(50);
            let end = (pos + search.len() + 50).min(content.len());

            // Find the actual end of the link
            let actual_end = if search.ends_with('|') {
                // Find the closing ]]
                content[pos..]
                    .find("]]")
                    .map(|p| (pos + p + 2 + 50).min(content.len()))
                    .unwrap_or(end)
            } else {
                end
            };

            let context = &content[start..actual_end];

            // Add ellipsis if truncated
            let mut result = String::new();
            if start > 0 {
                result.push_str("...");
            }
            result.push_str(context);
            if actual_end < content.len() {
                result.push_str("...");
            }

            return result;
        }
    }

    String::new()
}

// Wiki Link System Commands

#[tauri::command]
fn scan_note_links(content: String) -> Result<Vec<WikiLink>, String> {
    let link_names = parse_wiki_links(&content);
    let mut wiki_links = Vec::new();

    for name in link_names {
        let (exists, target) =
            note_exists(&name).map_err(|e| format!("Failed to check note existence: {}", e))?;

        wiki_links.push(WikiLink {
            text: name.clone(),
            target,
            exists,
        });
    }

    Ok(wiki_links)
}

#[tauri::command]
fn get_backlinks(filename: String) -> Result<Vec<BacklinkInfo>, String> {
    let notes_dir = get_notes_dir();
    let mut backlinks = Vec::new();

    // Get the note name from filename (for matching)
    let note_name = filename.trim_end_matches(".md");

    // Scan all notes (daily + standalone)
    let daily_dir = notes_dir.join("daily");
    let standalone_dir = notes_dir.join("notes");

    for dir in [daily_dir, standalone_dir] {
        if !dir.exists() {
            continue;
        }

        let entries =
            std::fs::read_dir(&dir).map_err(|e| format!("Failed to read directory: {}", e))?;

        for entry in entries.flatten() {
            let path = entry.path();

            if !path.is_file() || path.extension().and_then(|s| s.to_str()) != Some("md") {
                continue;
            }

            let from_filename = path
                .file_name()
                .and_then(|s| s.to_str())
                .unwrap_or("")
                .to_string();

            // Don't include self-links
            if from_filename == filename {
                continue;
            }

            let content =
                std::fs::read_to_string(&path).map_err(|e| format!("Failed to read file: {}", e))?;

            let links = parse_wiki_links(&content);

            // Check if this note links to our target
            for link in links {
                let (_, target) = note_exists(&link).unwrap_or((false, String::new()));

                if target == filename || link == note_name {
                    let context = get_link_context(&content, &link);

                    // Extract title from first heading
                    let title = content
                        .lines()
                        .find(|line| line.starts_with("# "))
                        .map(|line| line.trim_start_matches("# ").to_string())
                        .unwrap_or(from_filename.clone());

                    backlinks.push(BacklinkInfo {
                        from_note: from_filename.clone(),
                        from_title: title,
                        context,
                    });

                    break; // Only add once per note
                }
            }
        }
    }

    Ok(backlinks)
}

#[tauri::command]
fn create_note_from_link(note_name: String) -> Result<String, String> {
    let filename = note_name_to_filename(&note_name);
    let notes_dir = get_notes_dir();
    let notes_path = notes_dir.join("notes");

    std::fs::create_dir_all(&notes_path)
        .map_err(|e| format!("Failed to create notes directory: {}", e))?;

    let file_path = notes_path.join(&filename);

    // Check if file already exists
    if file_path.exists() {
        return Err(format!("Note '{}' already exists", filename));
    }

    // Create with a basic heading
    let initial_content = format!("# {}\n\n", note_name);

    std::fs::write(&file_path, initial_content).map_err(|e| format!("Failed to create note: {}", e))?;

    // Set restrictive file permissions (600 = owner read/write only)
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let permissions = fs::Permissions::from_mode(0o600);
        fs::set_permissions(&file_path, permissions).map_err(|e| e.to_string())?;
    }

    Ok(filename)
}

#[tauri::command]
fn ensure_directories() -> Result<(), String> {
    let notes_dir = get_notes_dir();
    let daily_dir = get_daily_dir();
    let standalone_dir = get_standalone_dir();
    let weekly_dir = get_weekly_dir();

    for dir in [&notes_dir, &daily_dir, &standalone_dir, &weekly_dir] {
        fs::create_dir_all(dir).map_err(|e| e.to_string())?;

        // Set restrictive directory permissions (700 = owner only)
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let permissions = fs::Permissions::from_mode(0o700);
            fs::set_permissions(dir, permissions).map_err(|e| e.to_string())?;
        }
    }

    Ok(())
}

// Helper function to recursively scan notes in a directory
fn scan_notes_recursive(dir: &std::path::Path, relative_path: &str, notes: &mut Vec<NoteFile>) {
    if let Ok(entries) = fs::read_dir(dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            let filename = path.file_name().unwrap().to_string_lossy().to_string();

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

#[tauri::command]
fn list_notes() -> Result<Vec<NoteFile>, String> {
    let mut notes = Vec::new();

    // List daily notes (non-recursive, daily notes are only at root level)
    let daily_dir = get_daily_dir();
    if daily_dir.exists() {
        if let Ok(entries) = fs::read_dir(&daily_dir) {
            for entry in entries.flatten() {
                let path = entry.path();
                let filename = path.file_name().unwrap().to_string_lossy().to_string();

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
                    });
                } else if path.extension().map_or(false, |ext| ext == "md") {
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
                    });
                } else if path.extension().map_or(false, |ext| ext == "md") {
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
fn read_note(filename: String, is_daily: bool, is_weekly: bool) -> Result<String, String> {
    // Prevent path traversal attacks
    if filename.contains("..") {
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
        fs::read_to_string(&path).map_err(|e| e.to_string())
    } else {
        Ok(String::new())
    }
}

#[tauri::command]
fn write_note(filename: String, content: String, is_daily: bool, is_weekly: bool) -> Result<(), String> {
    // Prevent path traversal attacks
    if filename.contains("..") {
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
    fs::write(&path, content).map_err(|e| e.to_string())?;

    // Set restrictive file permissions (600 = owner read/write only)
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let permissions = fs::Permissions::from_mode(0o600);
        fs::set_permissions(&path, permissions).map_err(|e| e.to_string())?;
    }

    Ok(())
}

#[tauri::command]
fn delete_note(filename: String, is_daily: bool, is_weekly: bool) -> Result<(), String> {
    // Prevent path traversal attacks
    if filename.contains("..") {
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
        fs::remove_file(&path).map_err(|e| e.to_string())
    } else {
        Ok(())
    }
}

// Trash System Commands

#[tauri::command]
fn trash_note(filename: String, is_daily: bool, is_weekly: bool) -> Result<(), String> {
    // Prevent path traversal attacks
    if filename.contains("..") {
        return Err("Invalid filename".to_string());
    }

    let source_dir = if is_weekly {
        get_weekly_dir()
    } else if is_daily {
        get_daily_dir()
    } else {
        get_standalone_dir()
    };

    let source_path = source_dir.join(&filename);
    if !source_path.exists() {
        return Err("Note does not exist".to_string());
    }

    // Generate unique ID for trash item
    let id = format!("{}", chrono::Utc::now().timestamp_millis());

    // Create trash directory if needed
    ensure_trash_dir()?;

    // Move file to trash with unique name to avoid conflicts
    let trash_filename = format!("{}_{}", id, filename.replace('/', "_"));
    let trash_path = get_trash_dir().join(&trash_filename);
    fs::rename(&source_path, &trash_path).map_err(|e| format!("Failed to move to trash: {}", e))?;

    // Update metadata
    let mut metadata = read_trash_metadata();
    metadata.items.push(TrashedNoteMetadata {
        id: id.clone(),
        filename: filename.clone(),
        original_path: filename,
        is_daily,
        is_folder: false,
        contained_files: Vec::new(),
        trashed_at: chrono::Utc::now().timestamp(),
    });
    write_trash_metadata(&metadata)?;

    Ok(())
}

#[tauri::command]
fn list_trash() -> Result<Vec<TrashedNote>, String> {
    let metadata = read_trash_metadata();
    let now = chrono::Utc::now().timestamp();
    let seven_days_secs = 7 * 24 * 60 * 60;

    let items: Vec<TrashedNote> = metadata.items.iter().map(|item| {
        let elapsed_secs = now - item.trashed_at;
        let remaining_secs = seven_days_secs - elapsed_secs;
        let days_remaining = (remaining_secs as f64 / (24.0 * 60.0 * 60.0)).ceil() as i32;

        TrashedNote {
            id: item.id.clone(),
            filename: item.filename.clone(),
            original_path: item.original_path.clone(),
            is_daily: item.is_daily,
            is_folder: item.is_folder,
            contained_files: item.contained_files.clone(),
            trashed_at: item.trashed_at,
            days_remaining: days_remaining.max(0),
        }
    }).collect();

    Ok(items)
}

#[tauri::command]
fn restore_note(trash_id: String) -> Result<(), String> {
    let mut metadata = read_trash_metadata();

    // Find the item in metadata
    let item_index = metadata.items.iter().position(|item| item.id == trash_id)
        .ok_or("Trash item not found")?;

    let item = metadata.items[item_index].clone();

    // Build trash file/folder path
    let trash_filename = format!("{}_{}", item.id, item.original_path.replace('/', "_"));
    let trash_path = get_trash_dir().join(&trash_filename);

    if !trash_path.exists() {
        // Remove from metadata anyway
        metadata.items.remove(item_index);
        write_trash_metadata(&metadata)?;
        return Err("Trash file not found on disk".to_string());
    }

    // Determine destination
    let dest_dir = if item.is_daily {
        get_daily_dir()
    } else {
        get_standalone_dir()
    };

    if item.is_folder {
        // Restore entire folder
        let dest_path = dest_dir.join(&item.original_path);

        // Ensure parent directory exists
        if let Some(parent) = dest_path.parent() {
            fs::create_dir_all(parent).map_err(|e| format!("Failed to create directory: {}", e))?;
        }

        // Move folder back
        fs::rename(&trash_path, &dest_path).map_err(|e| format!("Failed to restore folder: {}", e))?;
    } else {
        // Ensure parent directory exists for notes in folders
        let dest_path = dest_dir.join(&item.original_path);
        if let Some(parent) = dest_path.parent() {
            fs::create_dir_all(parent).map_err(|e| format!("Failed to create directory: {}", e))?;
        }

        // Move file back
        fs::rename(&trash_path, &dest_path).map_err(|e| format!("Failed to restore: {}", e))?;
    }

    // Update metadata
    metadata.items.remove(item_index);
    write_trash_metadata(&metadata)?;

    Ok(())
}

#[tauri::command]
fn permanently_delete_trash(trash_id: String) -> Result<(), String> {
    let mut metadata = read_trash_metadata();

    // Find the item in metadata
    let item_index = metadata.items.iter().position(|item| item.id == trash_id)
        .ok_or("Trash item not found")?;

    let item = &metadata.items[item_index];

    // Build trash file/folder path and delete
    let trash_filename = format!("{}_{}", item.id, item.original_path.replace('/', "_"));
    let trash_path = get_trash_dir().join(&trash_filename);

    if trash_path.exists() {
        if item.is_folder {
            fs::remove_dir_all(&trash_path).map_err(|e| format!("Failed to delete folder: {}", e))?;
        } else {
            fs::remove_file(&trash_path).map_err(|e| format!("Failed to delete: {}", e))?;
        }
    }

    // Update metadata
    metadata.items.remove(item_index);
    write_trash_metadata(&metadata)?;

    Ok(())
}

#[tauri::command]
fn empty_trash() -> Result<(), String> {
    let metadata = read_trash_metadata();

    // Delete all files and folders
    for item in &metadata.items {
        let trash_filename = format!("{}_{}", item.id, item.original_path.replace('/', "_"));
        let trash_path = get_trash_dir().join(&trash_filename);
        if trash_path.exists() {
            if item.is_folder {
                let _ = fs::remove_dir_all(&trash_path);
            } else {
                let _ = fs::remove_file(&trash_path);
            }
        }
    }

    // Clear metadata
    write_trash_metadata(&TrashMetadata::default())?;

    Ok(())
}

#[tauri::command]
fn cleanup_old_trash() -> Result<u32, String> {
    let mut metadata = read_trash_metadata();
    let now = chrono::Utc::now().timestamp();
    let seven_days_secs = 7 * 24 * 60 * 60;
    let mut deleted_count = 0u32;

    // Find expired items
    let expired_items: Vec<(usize, bool)> = metadata.items.iter().enumerate()
        .filter(|(_, item)| now - item.trashed_at >= seven_days_secs)
        .map(|(i, item)| (i, item.is_folder))
        .collect();

    // Delete files/folders and remove from metadata (in reverse to maintain indices)
    for (i, is_folder) in expired_items.into_iter().rev() {
        let item = &metadata.items[i];
        let trash_filename = format!("{}_{}", item.id, item.original_path.replace('/', "_"));
        let trash_path = get_trash_dir().join(&trash_filename);

        if trash_path.exists() {
            let result = if is_folder {
                fs::remove_dir_all(&trash_path)
            } else {
                fs::remove_file(&trash_path)
            };
            if result.is_ok() {
                deleted_count += 1;
            }
        }

        metadata.items.remove(i);
    }

    write_trash_metadata(&metadata)?;

    Ok(deleted_count)
}

#[tauri::command]
fn trash_folder(path: String) -> Result<(), String> {
    // Prevent path traversal attacks
    if path.contains("..") {
        return Err("Invalid folder path".to_string());
    }

    let standalone_dir = get_standalone_dir();
    let source_path = standalone_dir.join(&path);

    if !source_path.exists() {
        return Err("Folder does not exist".to_string());
    }

    if !source_path.is_dir() {
        return Err("Path is not a folder".to_string());
    }

    // Collect list of files in the folder
    let mut contained_files: Vec<String> = Vec::new();
    fn collect_files(dir: &std::path::Path, relative_path: &str, files: &mut Vec<String>) {
        if let Ok(entries) = fs::read_dir(dir) {
            for entry in entries.flatten() {
                let path = entry.path();
                let name = path.file_name().unwrap().to_string_lossy().to_string();
                if path.is_dir() {
                    let sub_path = if relative_path.is_empty() {
                        name.clone()
                    } else {
                        format!("{}/{}", relative_path, name)
                    };
                    collect_files(&path, &sub_path, files);
                } else if path.extension().map_or(false, |ext| ext == "md") {
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
    collect_files(&source_path, "", &mut contained_files);

    // Generate unique ID for trash item
    let id = format!("{}", chrono::Utc::now().timestamp_millis());

    // Create trash directory if needed
    ensure_trash_dir()?;

    // Move folder to trash
    let folder_name = source_path.file_name()
        .and_then(|s| s.to_str())
        .unwrap_or(&path)
        .to_string();
    let trash_filename = format!("{}_{}", id, path.replace('/', "_"));
    let trash_path = get_trash_dir().join(&trash_filename);
    fs::rename(&source_path, &trash_path).map_err(|e| format!("Failed to move folder to trash: {}", e))?;

    // Update metadata
    let mut metadata = read_trash_metadata();
    metadata.items.push(TrashedNoteMetadata {
        id: id.clone(),
        filename: folder_name,
        original_path: path,
        is_daily: false,
        is_folder: true,
        contained_files,
        trashed_at: chrono::Utc::now().timestamp(),
    });
    write_trash_metadata(&metadata)?;

    Ok(())
}

#[tauri::command]
fn restore_note_from_folder(trash_id: String, note_filename: String) -> Result<(), String> {
    let mut metadata = read_trash_metadata();

    // Find the folder item in metadata
    let item_index = metadata.items.iter().position(|item| item.id == trash_id && item.is_folder)
        .ok_or("Trashed folder not found")?;

    let item = &metadata.items[item_index];

    // Build trash folder path
    let trash_folder_name = format!("{}_{}", item.id, item.original_path.replace('/', "_"));
    let trash_folder_path = get_trash_dir().join(&trash_folder_name);

    if !trash_folder_path.exists() {
        return Err("Trashed folder not found on disk".to_string());
    }

    // Find the note file inside the trashed folder
    let note_path_in_trash = trash_folder_path.join(&note_filename);

    if !note_path_in_trash.exists() {
        return Err("Note not found in trashed folder".to_string());
    }

    // Destination is root of standalone notes (not back to original folder)
    let standalone_dir = get_standalone_dir();
    let dest_path = standalone_dir.join(note_path_in_trash.file_name().unwrap());

    // Check if destination already exists
    if dest_path.exists() {
        return Err("A note with this name already exists in the notes folder".to_string());
    }

    // Move just this note to the root
    fs::rename(&note_path_in_trash, &dest_path).map_err(|e| format!("Failed to restore note: {}", e))?;

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

/// Generate a unique filename in the given directory.
/// If "name.md" exists, tries "name (2).md", "name (3).md", etc.
fn generate_unique_filename(dir: &Path, base_name: &str, extension: &str) -> String {
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
fn generate_unique_folder_name(parent_dir: &Path, base_name: &str) -> String {
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

#[tauri::command]
fn create_note(title: String, folder_path: Option<String>) -> Result<String, String> {
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

    // Return the full relative path
    match folder_path {
        Some(folder) => Ok(format!("{}/{}", folder, filename)),
        None => Ok(filename),
    }
}

#[tauri::command]
fn duplicate_note(filename: String, is_daily: bool, is_weekly: bool) -> Result<String, String> {
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

    Ok(new_filename)
}

#[tauri::command]
fn export_single_note(
    filename: String,
    destination: String,
    is_daily: bool,
    is_weekly: bool,
) -> Result<String, String> {
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

    // Write to destination
    let dest_path = Path::new(&destination);
    fs::write(dest_path, &content).map_err(|e| e.to_string())?;

    Ok(destination)
}

#[tauri::command]
fn rename_note(old_filename: String, new_filename: String, is_daily: bool, is_weekly: bool) -> Result<(), String> {
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

    fs::rename(&old_path, &new_path).map_err(|e| e.to_string())
}

#[tauri::command]
fn clear_all_notes() -> Result<(), String> {
    // Delete all files in daily directory
    let daily_dir = get_daily_dir();
    if daily_dir.exists() {
        if let Ok(entries) = fs::read_dir(&daily_dir) {
            for entry in entries.flatten() {
                let path = entry.path();
                if path.is_file() && path.extension().map_or(false, |ext| ext == "md") {
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
                if path.is_file() && path.extension().map_or(false, |ext| ext == "md") {
                    fs::remove_file(&path).map_err(|e| e.to_string())?;
                }
            }
        }
    }

    Ok(())
}

// Folder System Helper Functions

fn scan_folders_recursive(dir: &std::path::Path, relative_path: &str) -> Vec<FolderInfo> {
    let mut folders = Vec::new();

    if let Ok(entries) = fs::read_dir(dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                let name = path.file_name()
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

                // Recursively scan subdirectories
                let children = scan_folders_recursive(&path, &folder_relative_path);

                folders.push(FolderInfo {
                    name,
                    path: folder_relative_path,
                    children,
                });
            }
        }
    }

    // Sort folders alphabetically
    folders.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));

    folders
}

// Folder System Commands

#[tauri::command]
fn list_folders() -> Result<Vec<FolderInfo>, String> {
    let standalone_dir = get_standalone_dir();

    if !standalone_dir.exists() {
        return Ok(Vec::new());
    }

    Ok(scan_folders_recursive(&standalone_dir, ""))
}

#[tauri::command]
fn create_folder(path: String) -> Result<(), String> {
    let standalone_dir = get_standalone_dir();
    let folder_path = standalone_dir.join(&path);

    // Validate path - prevent path traversal
    if path.contains("..") {
        return Err("Invalid folder path".to_string());
    }

    // Create the folder (and any parent folders)
    fs::create_dir_all(&folder_path)
        .map_err(|e| format!("Failed to create folder: {}", e))?;

    // Set restrictive permissions
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let permissions = fs::Permissions::from_mode(0o700);
        fs::set_permissions(&folder_path, permissions).ok();
    }

    Ok(())
}

#[tauri::command]
fn rename_folder(old_path: String, new_name: String) -> Result<String, String> {
    let standalone_dir = get_standalone_dir();
    let old_folder_path = standalone_dir.join(&old_path);

    // Validate inputs
    if old_path.contains("..") || new_name.contains('/') || new_name.contains('\\') {
        return Err("Invalid folder path or name".to_string());
    }

    if !old_folder_path.exists() {
        return Err("Folder not found".to_string());
    }

    // Calculate new path (same parent directory, new name)
    let parent = old_folder_path.parent()
        .ok_or_else(|| "Cannot rename root folder".to_string())?;
    let new_folder_path = parent.join(&new_name);

    if new_folder_path.exists() {
        return Err("A folder with this name already exists".to_string());
    }

    fs::rename(&old_folder_path, &new_folder_path)
        .map_err(|e| format!("Failed to rename folder: {}", e))?;

    // Return the new relative path
    let new_relative_path = new_folder_path
        .strip_prefix(&standalone_dir)
        .map_err(|_| "Failed to compute new path".to_string())?
        .to_string_lossy()
        .to_string();

    Ok(new_relative_path)
}

#[tauri::command]
fn delete_folder(path: String, force: bool) -> Result<(), String> {
    let standalone_dir = get_standalone_dir();
    let folder_path = standalone_dir.join(&path);

    // Validate path
    if path.contains("..") {
        return Err("Invalid folder path".to_string());
    }

    if !folder_path.exists() {
        return Ok(()); // Already deleted
    }

    // Check if folder is empty (unless force is true)
    if !force {
        let has_contents = fs::read_dir(&folder_path)
            .map(|mut entries| entries.next().is_some())
            .unwrap_or(false);

        if has_contents {
            return Err("Folder is not empty. Use force=true to delete anyway.".to_string());
        }
    }

    if force {
        fs::remove_dir_all(&folder_path)
            .map_err(|e| format!("Failed to delete folder: {}", e))?;
    } else {
        fs::remove_dir(&folder_path)
            .map_err(|e| format!("Failed to delete folder: {}", e))?;
    }

    Ok(())
}

/// Move a folder (and all its contents) to another folder or to root.
/// Handles naming conflicts by appending (2), (3), etc.
#[tauri::command]
fn move_folder(folder_path: String, to_folder: Option<String>) -> Result<String, String> {
    let standalone_dir = get_standalone_dir();

    // Validate paths
    if folder_path.contains("..") {
        return Err("Invalid folder path".to_string());
    }
    if let Some(ref dest) = to_folder {
        if dest.contains("..") {
            return Err("Invalid destination path".to_string());
        }
    }

    let source_path = standalone_dir.join(&folder_path);

    if !source_path.exists() {
        return Err("Folder not found".to_string());
    }

    if !source_path.is_dir() {
        return Err("Path is not a folder".to_string());
    }

    // Get the folder name
    let folder_name = source_path.file_name()
        .ok_or_else(|| "Invalid folder path".to_string())?
        .to_string_lossy()
        .to_string();

    // Calculate destination parent directory
    let dest_parent = match &to_folder {
        Some(dest) => standalone_dir.join(dest),
        None => standalone_dir.clone(),
    };

    // Ensure destination parent exists
    if !dest_parent.exists() {
        return Err("Destination folder does not exist".to_string());
    }

    // Prevent moving folder into itself or its descendants
    if let Some(ref dest) = to_folder {
        if dest == &folder_path || dest.starts_with(&format!("{}/", folder_path)) {
            return Err("Cannot move folder into itself or its subfolder".to_string());
        }
    }

    // Check if we're moving to the same parent (no-op)
    let source_parent = source_path.parent()
        .map(|p| p.to_path_buf())
        .unwrap_or_else(|| standalone_dir.clone());
    if source_parent == dest_parent {
        return Ok(folder_path); // Already in the right place
    }

    // Generate unique folder name if needed
    let final_name = generate_unique_folder_name(&dest_parent, &folder_name);
    let dest_path = dest_parent.join(&final_name);

    // Move the folder
    fs::rename(&source_path, &dest_path)
        .map_err(|e| format!("Failed to move folder: {}", e))?;

    // Return new relative path
    let new_relative_path = match &to_folder {
        Some(dest) => format!("{}/{}", dest, final_name),
        None => final_name,
    };

    Ok(new_relative_path)
}

#[tauri::command]
fn move_note(note_path: String, to_folder: Option<String>) -> Result<String, String> {
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

    // Return new relative path
    let new_relative_path = match &to_folder {
        Some(folder) => format!("{}/{}", folder, final_filename),
        None => final_filename,
    };

    Ok(format!("notes/{}", new_relative_path))
}

// Template System Commands

#[tauri::command]
fn list_templates() -> Result<Vec<Template>, String> {
    let mut templates = get_default_templates();

    // Load custom templates from disk
    let templates_dir = get_templates_dir()?;
    if templates_dir.exists() {
        if let Ok(entries) = fs::read_dir(&templates_dir) {
            for entry in entries.flatten() {
                let path = entry.path();
                if path.extension().map_or(false, |ext| ext == "json") {
                    if let Ok(content) = fs::read_to_string(&path) {
                        if let Ok(template) = serde_json::from_str::<Template>(&content) {
                            templates.push(template);
                        }
                    }
                }
            }
        }
    }

    Ok(templates)
}

#[tauri::command]
fn get_template(id: String) -> Result<Template, String> {
    // Check default templates first
    let defaults = get_default_templates();
    if let Some(template) = defaults.into_iter().find(|t| t.id == id) {
        return Ok(template);
    }

    // Check custom templates
    let templates_dir = get_templates_dir()?;
    let template_path = templates_dir.join(format!("{}.json", id));

    if template_path.exists() {
        let content = fs::read_to_string(&template_path).map_err(|e| e.to_string())?;
        let template: Template = serde_json::from_str(&content).map_err(|e| e.to_string())?;
        return Ok(template);
    }

    Err(format!("Template '{}' not found", id))
}

#[tauri::command]
fn save_template(input: SaveTemplateInput) -> Result<Template, String> {
    ensure_templates_dir()?;

    let id = generate_template_id(&input.name);
    let templates_dir = get_templates_dir()?;
    let template_path = templates_dir.join(format!("{}.json", id));

    // Check if template with this ID already exists
    if template_path.exists() {
        return Err(format!("A template with the name '{}' already exists", input.name));
    }

    // Check if trying to overwrite a default template
    let defaults = get_default_templates();
    if defaults.iter().any(|t| t.id == id) {
        return Err("Cannot overwrite a default template".to_string());
    }

    let template = Template {
        id: id.clone(),
        name: input.name,
        description: input.description,
        icon: input.icon,
        is_default: false,
        content: input.content,
    };

    let json = serde_json::to_string_pretty(&template).map_err(|e| e.to_string())?;
    fs::write(&template_path, json).map_err(|e| e.to_string())?;

    Ok(template)
}

#[tauri::command]
fn update_template(id: String, input: SaveTemplateInput) -> Result<Template, String> {
    // Check if trying to update a default template
    let defaults = get_default_templates();
    if defaults.iter().any(|t| t.id == id) {
        return Err("Cannot modify a default template".to_string());
    }

    let templates_dir = get_templates_dir()?;
    let template_path = templates_dir.join(format!("{}.json", id));

    if !template_path.exists() {
        return Err(format!("Template '{}' not found", id));
    }

    let template = Template {
        id: id.clone(),
        name: input.name,
        description: input.description,
        icon: input.icon,
        is_default: false,
        content: input.content,
    };

    let json = serde_json::to_string_pretty(&template).map_err(|e| e.to_string())?;
    fs::write(&template_path, json).map_err(|e| e.to_string())?;

    Ok(template)
}

#[tauri::command]
fn delete_template(id: String) -> Result<(), String> {
    // Check if trying to delete a default template
    let defaults = get_default_templates();
    if defaults.iter().any(|t| t.id == id) {
        return Err("Cannot delete a default template".to_string());
    }

    let templates_dir = get_templates_dir()?;
    let template_path = templates_dir.join(format!("{}.json", id));

    if template_path.exists() {
        fs::remove_file(&template_path).map_err(|e| e.to_string())?;
    }

    Ok(())
}

#[tauri::command]
fn apply_template(template_id: String) -> Result<String, String> {
    let template = get_template(template_id)?;
    let content = replace_template_variables(template.content);
    Ok(content)
}

#[tauri::command]
fn create_note_from_template(
    filename: String,
    template_id: String,
    is_daily: bool,
) -> Result<(), String> {
    let dir = if is_daily {
        get_daily_dir()
    } else {
        get_standalone_dir()
    };

    let path = dir.join(&filename);

    if path.exists() {
        return Err("A note with this name already exists".to_string());
    }

    let template = get_template(template_id)?;
    let content = replace_template_variables(template.content);

    fs::write(&path, content).map_err(|e| e.to_string())?;

    // Set restrictive file permissions (600 = owner read/write only)
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let permissions = fs::Permissions::from_mode(0o600);
        fs::set_permissions(&path, permissions).map_err(|e| e.to_string())?;
    }

    Ok(())
}

// Fix permissions on existing note files
#[tauri::command]
fn fix_note_permissions() -> Result<u32, String> {
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
                    if path.extension().map_or(false, |ext| ext == "md") {
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

// Note Locking Commands

/// Lock a note by encrypting it with a password
#[tauri::command]
fn lock_note(filename: String, password: String, is_daily: bool, is_weekly: bool) -> Result<(), String> {
    let dir = if is_weekly {
        get_weekly_dir()
    } else if is_daily {
        get_daily_dir()
    } else {
        get_standalone_dir()
    };

    let original_path = dir.join(&filename);
    let locked_path = dir.join(format!("{}.locked", filename));

    // Check if original file exists
    if !original_path.exists() {
        return Err("Note not found".to_string());
    }

    // Check if already locked
    if locked_path.exists() {
        return Err("Note is already locked".to_string());
    }

    // Read the original content
    let content = fs::read_to_string(&original_path)
        .map_err(|e| format!("Failed to read note: {}", e))?;

    // Encrypt the content
    let encrypted = encryption::encrypt_content(&content, &password)?;

    // Write the encrypted content to the new file
    fs::write(&locked_path, encrypted)
        .map_err(|e| format!("Failed to write locked note: {}", e))?;

    // Set restrictive permissions on the locked file
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let permissions = fs::Permissions::from_mode(0o600);
        fs::set_permissions(&locked_path, permissions).ok();
    }

    // Delete the original unencrypted file
    fs::remove_file(&original_path)
        .map_err(|e| format!("Failed to remove original note: {}", e))?;

    Ok(())
}

/// Unlock a note temporarily to view it (returns decrypted content without saving)
/// Includes brute-force protection with rate limiting.
#[tauri::command]
fn unlock_note(filename: String, password: String, is_daily: bool, is_weekly: bool) -> Result<String, String> {
    // Create a unique identifier for this note
    let note_id = format!("{}:{}:{}", if is_weekly { "weekly" } else if is_daily { "daily" } else { "standalone" }, filename, "");

    // Check rate limit before attempting
    let rate_check = security::check_rate_limit(&note_id);
    if !rate_check.allowed {
        let secs = rate_check.retry_after_secs.unwrap_or(30);
        return Err(format!("RATE_LIMITED:{}:Too many failed attempts. Please wait {} seconds before trying again.", secs, secs));
    }

    let dir = if is_weekly {
        get_weekly_dir()
    } else if is_daily {
        get_daily_dir()
    } else {
        get_standalone_dir()
    };

    let locked_path = dir.join(format!("{}.locked", filename));

    // Check if locked file exists
    if !locked_path.exists() {
        return Err("Locked note not found".to_string());
    }

    // Read the encrypted content
    let encrypted = fs::read_to_string(&locked_path)
        .map_err(|e| format!("Failed to read locked note: {}", e))?;

    // Attempt to decrypt
    match encryption::decrypt_content(&encrypted, &password) {
        Ok(content) => {
            // Success - clear the attempt history
            security::record_successful_attempt(&note_id);
            Ok(content)
        }
        Err(_) => {
            // Failed - record the attempt and return error with remaining attempts
            let result = security::record_failed_attempt(&note_id);
            if !result.allowed {
                let secs = result.retry_after_secs.unwrap_or(30);
                Err(format!("RATE_LIMITED:{}:Too many failed attempts. Please wait {} seconds before trying again.", secs, secs))
            } else {
                let remaining = result.remaining_attempts.unwrap_or(0);
                Err(format!("WRONG_PASSWORD:{}:Incorrect password. {} attempts remaining.", remaining, remaining))
            }
        }
    }
}

/// Permanently unlock a note (decrypt and save as regular .md file)
/// Includes brute-force protection with rate limiting.
#[tauri::command]
fn permanently_unlock_note(filename: String, password: String, is_daily: bool, is_weekly: bool) -> Result<(), String> {
    // Create a unique identifier for this note (same as unlock_note)
    let note_id = format!("{}:{}:{}", if is_weekly { "weekly" } else if is_daily { "daily" } else { "standalone" }, filename, "");

    // Check rate limit before attempting
    let rate_check = security::check_rate_limit(&note_id);
    if !rate_check.allowed {
        let secs = rate_check.retry_after_secs.unwrap_or(30);
        return Err(format!("RATE_LIMITED:{}:Too many failed attempts. Please wait {} seconds before trying again.", secs, secs));
    }

    let dir = if is_weekly {
        get_weekly_dir()
    } else if is_daily {
        get_daily_dir()
    } else {
        get_standalone_dir()
    };

    let locked_path = dir.join(format!("{}.locked", filename));
    let original_path = dir.join(&filename);

    // Check if locked file exists
    if !locked_path.exists() {
        return Err("Locked note not found".to_string());
    }

    // Read the encrypted content
    let encrypted = fs::read_to_string(&locked_path)
        .map_err(|e| format!("Failed to read locked note: {}", e))?;

    // Attempt to decrypt the content
    let decrypted = match encryption::decrypt_content(&encrypted, &password) {
        Ok(content) => {
            // Success - clear the attempt history
            security::record_successful_attempt(&note_id);
            content
        }
        Err(_) => {
            // Failed - record the attempt and return error with remaining attempts
            let result = security::record_failed_attempt(&note_id);
            if !result.allowed {
                let secs = result.retry_after_secs.unwrap_or(30);
                return Err(format!("RATE_LIMITED:{}:Too many failed attempts. Please wait {} seconds before trying again.", secs, secs));
            } else {
                let remaining = result.remaining_attempts.unwrap_or(0);
                return Err(format!("WRONG_PASSWORD:{}:Incorrect password. {} attempts remaining.", remaining, remaining));
            }
        }
    };

    // Write the decrypted content to the original path
    fs::write(&original_path, &decrypted)
        .map_err(|e| format!("Failed to write unlocked note: {}", e))?;

    // Set restrictive permissions
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let permissions = fs::Permissions::from_mode(0o600);
        fs::set_permissions(&original_path, permissions).ok();
    }

    // Delete the locked file
    fs::remove_file(&locked_path)
        .map_err(|e| format!("Failed to remove locked note: {}", e))?;

    Ok(())
}

/// Check if a note is locked
#[tauri::command]
fn is_note_locked(filename: String, is_daily: bool, is_weekly: bool) -> bool {
    let dir = if is_weekly {
        get_weekly_dir()
    } else if is_daily {
        get_daily_dir()
    } else {
        get_standalone_dir()
    };

    let locked_path = dir.join(format!("{}.locked", filename));
    locked_path.exists()
}

// Directory Management Commands

/// Get the current notes directory path
#[tauri::command]
fn get_notes_directory() -> String {
    get_notes_dir().to_string_lossy().to_string()
}

/// Set a new notes directory and move all existing notes
#[tauri::command]
fn set_notes_directory(new_path: String) -> Result<(), String> {
    let new_dir = PathBuf::from(&new_path);
    let old_dir = get_notes_dir();

    // Don't do anything if it's the same directory
    if new_dir == old_dir {
        return Ok(());
    }

    // Create the new directory structure
    fs::create_dir_all(&new_dir).map_err(|e| format!("Failed to create new directory: {}", e))?;

    // Move/copy all subdirectories (daily, notes, templates)
    for subdir in ["daily", "notes", "templates"] {
        let old_subdir = old_dir.join(subdir);
        let new_subdir = new_dir.join(subdir);

        if old_subdir.exists() {
            fs::create_dir_all(&new_subdir)
                .map_err(|e| format!("Failed to create {}: {}", subdir, e))?;

            // Copy all files from old to new
            if let Ok(entries) = fs::read_dir(&old_subdir) {
                for entry in entries.flatten() {
                    let path = entry.path();
                    if path.is_file() {
                        let filename = path.file_name().unwrap();
                        let dest = new_subdir.join(filename);
                        fs::copy(&path, &dest)
                            .map_err(|e| format!("Failed to copy file: {}", e))?;
                    }
                }
            }
        }
    }

    // Update the config
    let mut config = read_config();
    config.notes_directory = Some(new_path);
    write_config(&config)?;

    // After successful copy, remove old files
    for subdir in ["daily", "notes", "templates"] {
        let old_subdir = old_dir.join(subdir);
        if old_subdir.exists() {
            if let Ok(entries) = fs::read_dir(&old_subdir) {
                for entry in entries.flatten() {
                    let path = entry.path();
                    if path.is_file() {
                        let _ = fs::remove_file(&path);
                    }
                }
            }
        }
    }

    Ok(())
}

// Export/Import Commands

/// Export all notes and templates to a ZIP file
#[tauri::command]
fn export_notes(destination: String) -> Result<String, String> {
    let notes_dir = get_notes_dir();
    let zip_path = PathBuf::from(&destination);

    let file = fs::File::create(&zip_path)
        .map_err(|e| format!("Failed to create ZIP file: {}", e))?;
    let mut zip = zip::ZipWriter::new(file);

    let options = SimpleFileOptions::default()
        .compression_method(zip::CompressionMethod::Deflated)
        .unix_permissions(0o600);

    // Add files from each subdirectory
    for subdir in ["daily", "notes", "templates"] {
        let subdir_path = notes_dir.join(subdir);
        if !subdir_path.exists() {
            continue;
        }

        if let Ok(entries) = fs::read_dir(&subdir_path) {
            for entry in entries.flatten() {
                let path = entry.path();
                if path.is_file() {
                    let filename = path.file_name().unwrap().to_string_lossy();
                    let archive_path = format!("{}/{}", subdir, filename);

                    let mut file_content = Vec::new();
                    if let Ok(mut f) = fs::File::open(&path) {
                        if f.read_to_end(&mut file_content).is_ok() {
                            zip.start_file(&archive_path, options)
                                .map_err(|e| format!("Failed to add file to ZIP: {}", e))?;
                            zip.write_all(&file_content)
                                .map_err(|e| format!("Failed to write file content: {}", e))?;
                        }
                    }
                }
            }
        }
    }

    zip.finish().map_err(|e| format!("Failed to finalize ZIP: {}", e))?;

    Ok(zip_path.to_string_lossy().to_string())
}

/// Import notes and templates from a ZIP file
#[tauri::command]
fn import_notes(zip_path: String, merge: bool) -> Result<ImportResult, String> {
    let notes_dir = get_notes_dir();
    let zip_file = fs::File::open(&zip_path)
        .map_err(|e| format!("Failed to open ZIP file: {}", e))?;
    let mut archive = ZipArchive::new(zip_file)
        .map_err(|e| format!("Failed to read ZIP archive: {}", e))?;

    let mut result = ImportResult {
        daily_notes: 0,
        standalone_notes: 0,
        templates: 0,
    };

    // If not merging, clear existing notes first (but not templates)
    if !merge {
        for subdir in ["daily", "notes"] {
            let subdir_path = notes_dir.join(subdir);
            if subdir_path.exists() {
                if let Ok(entries) = fs::read_dir(&subdir_path) {
                    for entry in entries.flatten() {
                        let path = entry.path();
                        if path.is_file() {
                            let _ = fs::remove_file(&path);
                        }
                    }
                }
            }
        }
    }

    // Extract files from the ZIP
    for i in 0..archive.len() {
        let mut file = archive.by_index(i)
            .map_err(|e| format!("Failed to read ZIP entry: {}", e))?;

        let name = file.name().to_string();

        // Parse the path (subdir/filename)
        let parts: Vec<&str> = name.split('/').collect();
        if parts.len() != 2 {
            continue; // Skip invalid paths
        }

        let subdir = parts[0];
        let filename = parts[1];

        // Only process valid subdirectories
        if !["daily", "notes", "templates"].contains(&subdir) {
            continue;
        }

        let dest_dir = notes_dir.join(subdir);
        fs::create_dir_all(&dest_dir)
            .map_err(|e| format!("Failed to create directory: {}", e))?;

        let dest_path = dest_dir.join(filename);

        // If merging, skip existing files
        if merge && dest_path.exists() {
            continue;
        }

        // Extract the file
        let mut content = Vec::new();
        file.read_to_end(&mut content)
            .map_err(|e| format!("Failed to read file from ZIP: {}", e))?;

        fs::write(&dest_path, content)
            .map_err(|e| format!("Failed to write file: {}", e))?;

        // Set restrictive permissions
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let permissions = fs::Permissions::from_mode(0o600);
            let _ = fs::set_permissions(&dest_path, permissions);
        }

        // Update counts
        match subdir {
            "daily" => result.daily_notes += 1,
            "notes" => result.standalone_notes += 1,
            "templates" => result.templates += 1,
            _ => {}
        }
    }

    Ok(result)
}

/// Export all notes and templates to an encrypted backup file
#[tauri::command]
fn export_encrypted_backup(destination: String, password: String) -> Result<String, String> {
    use std::io::Cursor;

    let notes_dir = get_notes_dir();

    // Create ZIP in memory
    let mut zip_buffer = Cursor::new(Vec::new());
    {
        let mut zip = zip::ZipWriter::new(&mut zip_buffer);
        let options = SimpleFileOptions::default()
            .compression_method(zip::CompressionMethod::Deflated)
            .unix_permissions(0o600);

        // Add files from each subdirectory
        for subdir in ["daily", "notes", "templates", "weekly"] {
            let subdir_path = notes_dir.join(subdir);
            if !subdir_path.exists() {
                continue;
            }

            if let Ok(entries) = fs::read_dir(&subdir_path) {
                for entry in entries.flatten() {
                    let path = entry.path();
                    if path.is_file() {
                        let filename = path.file_name().unwrap().to_string_lossy();
                        let archive_path = format!("{}/{}", subdir, filename);

                        let mut file_content = Vec::new();
                        if let Ok(mut f) = fs::File::open(&path) {
                            if f.read_to_end(&mut file_content).is_ok() {
                                zip.start_file(&archive_path, options)
                                    .map_err(|e| format!("Failed to add file to ZIP: {}", e))?;
                                zip.write_all(&file_content)
                                    .map_err(|e| format!("Failed to write file content: {}", e))?;
                            }
                        }
                    }
                }
            }
        }

        zip.finish().map_err(|e| format!("Failed to finalize ZIP: {}", e))?;
    }

    // Get the ZIP data
    let zip_data = zip_buffer.into_inner();

    // Encrypt the ZIP data using our encryption module
    let zip_b64 = base64::Engine::encode(&base64::engine::general_purpose::STANDARD, &zip_data);
    let encrypted = encryption::encrypt_content(&zip_b64, &password)?;

    // Add a header to identify encrypted backups
    let backup_content = format!("NOTOMATTIC_ENCRYPTED_BACKUP_V1\n{}", encrypted);

    // Write to destination
    let backup_path = PathBuf::from(&destination);
    fs::write(&backup_path, backup_content)
        .map_err(|e| format!("Failed to write backup file: {}", e))?;

    // Set restrictive permissions
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let permissions = fs::Permissions::from_mode(0o600);
        let _ = fs::set_permissions(&backup_path, permissions);
    }

    Ok(backup_path.to_string_lossy().to_string())
}

/// Import notes and templates from an encrypted backup file
#[tauri::command]
fn import_encrypted_backup(backup_path: String, password: String, merge: bool) -> Result<ImportResult, String> {
    use std::io::Cursor;

    let notes_dir = get_notes_dir();

    // Read the backup file
    let backup_content = fs::read_to_string(&backup_path)
        .map_err(|e| format!("Failed to read backup file: {}", e))?;

    // Verify header and extract encrypted data
    let lines: Vec<&str> = backup_content.splitn(2, '\n').collect();
    if lines.len() != 2 || lines[0] != "NOTOMATTIC_ENCRYPTED_BACKUP_V1" {
        return Err("Invalid backup file format".to_string());
    }
    let encrypted = lines[1];

    // Decrypt the data
    let zip_b64 = encryption::decrypt_content(encrypted, &password)?;

    // Decode base64 to get ZIP data
    let zip_data = base64::Engine::decode(&base64::engine::general_purpose::STANDARD, &zip_b64)
        .map_err(|e| format!("Failed to decode backup data: {}", e))?;

    // Open the ZIP archive from memory
    let cursor = Cursor::new(zip_data);
    let mut archive = ZipArchive::new(cursor)
        .map_err(|e| format!("Failed to read backup archive: {}", e))?;

    let mut result = ImportResult {
        daily_notes: 0,
        standalone_notes: 0,
        templates: 0,
    };

    // If not merging, clear existing notes first (but not templates)
    if !merge {
        for subdir in ["daily", "notes", "weekly"] {
            let subdir_path = notes_dir.join(subdir);
            if subdir_path.exists() {
                if let Ok(entries) = fs::read_dir(&subdir_path) {
                    for entry in entries.flatten() {
                        let path = entry.path();
                        if path.is_file() {
                            let _ = fs::remove_file(&path);
                        }
                    }
                }
            }
        }
    }

    // Extract files from the ZIP
    for i in 0..archive.len() {
        let mut file = archive.by_index(i)
            .map_err(|e| format!("Failed to read archive entry: {}", e))?;

        let name = file.name().to_string();

        // Parse the path (subdir/filename)
        let parts: Vec<&str> = name.split('/').collect();
        if parts.len() != 2 {
            continue;
        }

        let subdir = parts[0];
        let filename = parts[1];

        // Only process valid subdirectories
        if !["daily", "notes", "templates", "weekly"].contains(&subdir) {
            continue;
        }

        // Validate filename
        if filename.is_empty() || filename.contains("..") || filename.starts_with('/') {
            continue;
        }

        // Ensure subdirectory exists
        let subdir_path = notes_dir.join(subdir);
        if !subdir_path.exists() {
            fs::create_dir_all(&subdir_path)
                .map_err(|e| format!("Failed to create directory: {}", e))?;
        }

        // Build destination path
        let dest_path = subdir_path.join(filename);

        // Skip if file exists and merging
        if merge && dest_path.exists() {
            continue;
        }

        // Read and write file content
        let mut content = Vec::new();
        file.read_to_end(&mut content)
            .map_err(|e| format!("Failed to read file from archive: {}", e))?;

        fs::write(&dest_path, content)
            .map_err(|e| format!("Failed to write file: {}", e))?;

        // Set restrictive permissions
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let permissions = fs::Permissions::from_mode(0o600);
            let _ = fs::set_permissions(&dest_path, permissions);
        }

        // Update counts
        match subdir {
            "daily" | "weekly" => result.daily_notes += 1,
            "notes" => result.standalone_notes += 1,
            "templates" => result.templates += 1,
            _ => {}
        }
    }

    Ok(result)
}

// Apple Calendar (EventKit) Commands - macOS only

#[cfg(target_os = "macos")]
#[tauri::command]
fn get_calendar_permission() -> CalendarPermission {
    calendar::get_permission_status()
}

#[cfg(target_os = "macos")]
#[tauri::command]
fn request_calendar_permission() -> bool {
    calendar::request_permission()
}

#[cfg(target_os = "macos")]
#[tauri::command]
fn is_calendar_authorized() -> bool {
    calendar::is_authorized()
}

#[cfg(target_os = "macos")]
#[tauri::command]
fn fetch_calendar_events(
    start_date: String,
    end_date: String,
    calendar_id: Option<String>,
) -> Result<Vec<CalendarEvent>, String> {
    calendar::get_events(&start_date, &end_date, calendar_id.as_deref())
}

#[cfg(target_os = "macos")]
#[tauri::command]
fn list_calendars() -> Result<Vec<CalendarInfo>, String> {
    calendar::get_calendars()
}

// Note Metadata Helper Functions

fn get_metadata_path() -> PathBuf {
    get_notes_dir().join(".note-metadata.json")
}

fn read_note_metadata() -> NoteMetadata {
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

fn write_note_metadata(metadata: &NoteMetadata) -> Result<(), String> {
    let path = get_metadata_path();
    let content = serde_json::to_string_pretty(metadata).map_err(|e| e.to_string())?;
    fs::write(&path, content).map_err(|e| e.to_string())?;
    Ok(())
}

/// Get the color ID for a specific note
#[tauri::command]
fn get_note_color(note_path: String) -> Option<String> {
    let metadata = read_note_metadata();
    metadata.colors.get(&note_path).cloned()
}

/// Set the color ID for a specific note
#[tauri::command]
fn set_note_color(note_path: String, color_id: Option<String>) -> Result<(), String> {
    let mut metadata = read_note_metadata();

    match color_id {
        Some(id) if id != "default" => {
            metadata.colors.insert(note_path, id);
        }
        _ => {
            metadata.colors.remove(&note_path);
        }
    }

    write_note_metadata(&metadata)
}

/// Get all note colors at once (for initial load)
#[tauri::command]
fn get_all_note_colors() -> std::collections::HashMap<String, String> {
    let metadata = read_note_metadata();
    metadata.colors
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            ensure_directories,
            list_notes,
            read_note,
            write_note,
            delete_note,
            create_note,
            duplicate_note,
            export_single_note,
            rename_note,
            clear_all_notes,
            // Folder system commands
            list_folders,
            create_folder,
            rename_folder,
            delete_folder,
            move_folder,
            move_note,
            // Trash system commands
            trash_note,
            trash_folder,
            list_trash,
            restore_note,
            restore_note_from_folder,
            permanently_delete_trash,
            empty_trash,
            cleanup_old_trash,
            // Template system commands
            list_templates,
            get_template,
            save_template,
            update_template,
            delete_template,
            apply_template,
            create_note_from_template,
            // Privacy commands
            fix_note_permissions,
            // Note locking commands
            lock_note,
            unlock_note,
            permanently_unlock_note,
            is_note_locked,
            // Wiki Link system commands
            scan_note_links,
            get_backlinks,
            create_note_from_link,
            // Directory management commands
            get_notes_directory,
            set_notes_directory,
            // Export/Import commands
            export_notes,
            import_notes,
            export_encrypted_backup,
            import_encrypted_backup,
            // Note metadata commands
            get_note_color,
            set_note_color,
            get_all_note_colors,
            // Apple Calendar (EventKit) commands - macOS only
            #[cfg(target_os = "macos")]
            get_calendar_permission,
            #[cfg(target_os = "macos")]
            request_calendar_permission,
            #[cfg(target_os = "macos")]
            is_calendar_authorized,
            #[cfg(target_os = "macos")]
            fetch_calendar_events,
            #[cfg(target_os = "macos")]
            list_calendars
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

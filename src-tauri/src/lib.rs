use chrono::Local;
use lazy_static::lazy_static;
use regex::Regex;
use serde::{Deserialize, Serialize};
use std::fs;
use std::io::{Read as IoRead, Write as IoWrite};
use std::path::PathBuf;
use zip::write::SimpleFileOptions;
use zip::ZipArchive;

#[cfg(target_os = "macos")]
mod calendar;
#[cfg(target_os = "macos")]
use calendar::{CalendarEvent, CalendarInfo, CalendarPermission};

mod encryption;

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NoteFile {
    name: String,
    path: String,
    is_daily: bool,
    date: Option<String>,
    is_locked: bool,
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

    for dir in [&notes_dir, &daily_dir, &standalone_dir] {
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

#[tauri::command]
fn list_notes() -> Result<Vec<NoteFile>, String> {
    let mut notes = Vec::new();

    // List daily notes
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
                        date,
                        is_locked: true,
                    });
                } else if path.extension().map_or(false, |ext| ext == "md") {
                    let date = filename.strip_suffix(".md").map(|s| s.to_string());
                    notes.push(NoteFile {
                        name: filename.clone(),
                        path: format!("daily/{}", filename),
                        is_daily: true,
                        date,
                        is_locked: false,
                    });
                }
            }
        }
    }

    // List standalone notes
    let standalone_dir = get_standalone_dir();
    if standalone_dir.exists() {
        if let Ok(entries) = fs::read_dir(&standalone_dir) {
            for entry in entries.flatten() {
                let path = entry.path();
                let filename = path.file_name().unwrap().to_string_lossy().to_string();

                // Check for locked files (.md.locked)
                if filename.ends_with(".md.locked") {
                    let base_name = filename.strip_suffix(".locked").unwrap().to_string();
                    notes.push(NoteFile {
                        name: base_name.clone(),
                        path: format!("notes/{}", base_name),
                        is_daily: false,
                        date: None,
                        is_locked: true,
                    });
                } else if path.extension().map_or(false, |ext| ext == "md") {
                    notes.push(NoteFile {
                        name: filename.clone(),
                        path: format!("notes/{}", filename),
                        is_daily: false,
                        date: None,
                        is_locked: false,
                    });
                }
            }
        }
    }

    Ok(notes)
}

#[tauri::command]
fn read_note(filename: String, is_daily: bool) -> Result<String, String> {
    let dir = if is_daily {
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
fn write_note(filename: String, content: String, is_daily: bool) -> Result<(), String> {
    let dir = if is_daily {
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
fn delete_note(filename: String, is_daily: bool) -> Result<(), String> {
    let dir = if is_daily {
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

#[tauri::command]
fn create_note(title: String) -> Result<String, String> {
    let dir = get_standalone_dir();
    let filename = format!("{}.md", title);
    let path = dir.join(&filename);

    if path.exists() {
        return Err("A note with this name already exists".to_string());
    }

    fs::write(&path, "").map_err(|e| e.to_string())?;

    // Set restrictive file permissions (600 = owner read/write only)
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let permissions = fs::Permissions::from_mode(0o600);
        fs::set_permissions(&path, permissions).map_err(|e| e.to_string())?;
    }

    Ok(filename)
}

#[tauri::command]
fn rename_note(old_filename: String, new_filename: String, is_daily: bool) -> Result<(), String> {
    let dir = if is_daily {
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
fn lock_note(filename: String, password: String, is_daily: bool) -> Result<(), String> {
    let dir = if is_daily {
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
#[tauri::command]
fn unlock_note(filename: String, password: String, is_daily: bool) -> Result<String, String> {
    let dir = if is_daily {
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

    // Decrypt and return the content
    encryption::decrypt_content(&encrypted, &password)
}

/// Permanently unlock a note (decrypt and save as regular .md file)
#[tauri::command]
fn permanently_unlock_note(filename: String, password: String, is_daily: bool) -> Result<(), String> {
    let dir = if is_daily {
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

    // Decrypt the content
    let decrypted = encryption::decrypt_content(&encrypted, &password)?;

    // Write the decrypted content to the original path
    fs::write(&original_path, decrypted)
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
fn is_note_locked(filename: String, is_daily: bool) -> bool {
    let dir = if is_daily {
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
            rename_note,
            clear_all_notes,
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

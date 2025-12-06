use chrono::Local;
use lazy_static::lazy_static;
use regex::Regex;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;

#[cfg(target_os = "macos")]
mod calendar;
#[cfg(target_os = "macos")]
use calendar::{CalendarEvent, CalendarInfo, CalendarPermission};

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NoteFile {
    name: String,
    path: String,
    is_daily: bool,
    date: Option<String>,
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

// Wiki Link Regex
lazy_static! {
    // Matches [[Note Name]] or [[Display|note-name]]
    static ref WIKI_LINK_REGEX: Regex = Regex::new(r"\[\[([^\]|]+)(?:\|([^\]]+))?\]\]").unwrap();
}

fn get_notes_dir() -> PathBuf {
    dirs::document_dir()
        .expect("Could not find Documents directory")
        .join("Notomattic")
}

fn get_daily_dir() -> PathBuf {
    get_notes_dir().join("daily")
}

fn get_standalone_dir() -> PathBuf {
    get_notes_dir().join("notes")
}

// Template System Helper Functions

fn get_templates_dir() -> Result<PathBuf, String> {
    let path = dirs::document_dir()
        .ok_or("Could not find Documents directory")?
        .join("Notomattic")
        .join("templates");
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

    Ok(filename)
}

#[tauri::command]
fn ensure_directories() -> Result<(), String> {
    let notes_dir = get_notes_dir();
    let daily_dir = get_daily_dir();
    let standalone_dir = get_standalone_dir();

    fs::create_dir_all(&notes_dir).map_err(|e| e.to_string())?;
    fs::create_dir_all(&daily_dir).map_err(|e| e.to_string())?;
    fs::create_dir_all(&standalone_dir).map_err(|e| e.to_string())?;

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
                if path.extension().map_or(false, |ext| ext == "md") {
                    let name = path.file_name().unwrap().to_string_lossy().to_string();
                    let date = name.strip_suffix(".md").map(|s| s.to_string());
                    notes.push(NoteFile {
                        name: name.clone(),
                        path: format!("daily/{}", name),
                        is_daily: true,
                        date,
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
                if path.extension().map_or(false, |ext| ext == "md") {
                    let name = path.file_name().unwrap().to_string_lossy().to_string();
                    notes.push(NoteFile {
                        name: name.clone(),
                        path: format!("notes/{}", name),
                        is_daily: false,
                        date: None,
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
    fs::write(&path, content).map_err(|e| e.to_string())
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

    Ok(())
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
            // Wiki Link system commands
            scan_note_links,
            get_backlinks,
            create_note_from_link,
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

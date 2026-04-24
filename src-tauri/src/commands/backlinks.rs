//! Wiki-link scanning, backlink lookup, create-from-link commands.

use std::fs;

use crate::paths::get_notes_dir;
use crate::types::{BacklinkInfo, WikiLink};
use crate::wiki::{get_link_context, note_exists, note_name_to_filename, parse_wiki_links};

#[tauri::command]
pub(crate) fn scan_note_links(content: String) -> Result<Vec<WikiLink>, String> {
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
pub(crate) fn get_backlinks(filename: String) -> Result<Vec<BacklinkInfo>, String> {
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
pub(crate) fn create_note_from_link(note_name: String) -> Result<String, String> {
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

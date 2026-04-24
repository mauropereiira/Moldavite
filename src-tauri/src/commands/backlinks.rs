//! Wiki-link scanning, backlink lookup, create-from-link commands.

use std::fs;
use std::sync::Arc;

use tauri::State;

use crate::backlinks_index::BacklinksIndex;
use crate::paths::get_notes_dir;
use crate::types::{BacklinkInfo, WikiLink};
use crate::wiki::{note_exists, note_name_to_filename, parse_wiki_links};

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
pub(crate) fn get_backlinks(
    filename: String,
    index: State<'_, Arc<BacklinksIndex>>,
) -> Result<Vec<BacklinkInfo>, String> {
    if !index.is_ready() {
        // Fallback: if startup rebuild hasn't finished yet (or never ran
        // because tests/CLI bypass the Tauri setup hook), rebuild now so
        // the first call still returns correct data.
        index.rebuild_from_disk();
    }

    let note_stem = filename.trim_end_matches(".md");
    Ok(index.get(&filename, note_stem))
}

#[tauri::command]
pub(crate) fn create_note_from_link(
    note_name: String,
    index: State<'_, Arc<BacklinksIndex>>,
) -> Result<String, String> {
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

    std::fs::write(&file_path, &initial_content)
        .map_err(|e| format!("Failed to create note: {}", e))?;

    // Set restrictive file permissions (600 = owner read/write only)
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let permissions = fs::Permissions::from_mode(0o600);
        fs::set_permissions(&file_path, permissions).map_err(|e| e.to_string())?;
    }

    index.update_note(&filename, &initial_content);

    Ok(filename)
}

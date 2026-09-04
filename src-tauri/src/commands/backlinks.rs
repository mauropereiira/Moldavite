//! Wiki-link scanning, indexed backlink lookup, and create-from-link commands.
//!
//! Link resolution uses the shared slug contract in `wiki`; backlink queries
//! read the shared in-memory index, while note creation validates the resolved
//! filename before touching the standalone notes directory.

use std::path::Path;
use std::sync::Arc;

use tauri::State;

use crate::backlinks_index::BacklinksIndex;
use crate::paths::get_notes_dir;
use crate::types::{BacklinkInfo, WikiLink};
use crate::validation::is_safe_filename;
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
    let notes_dir = get_notes_dir();
    let (filename, initial_content) = create_note_from_link_at(&notes_dir, &note_name)?;
    index.update_note(&filename, &initial_content);
    Ok(filename)
}

fn create_note_from_link_at(
    notes_dir: &Path,
    note_name: &str,
) -> Result<(String, String), String> {
    let filename = note_name_to_filename(note_name);
    // `note_name_to_filename` mirrors the frontend slug contract byte-for-
    // byte and must not change; validate its output instead so a Windows
    // reserved stem like `[[NUL]]` is rejected rather than written to disk.
    if !is_safe_filename(&filename) {
        return Err("Invalid filename".to_string());
    }
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

    crate::persist::write_atomic(&file_path, initial_content.as_bytes(), Some(0o600))
        .map_err(|e| format!("Failed to create note: {}", e))?;

    Ok((filename, initial_content))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp_notes_dir(tag: &str) -> std::path::PathBuf {
        let base = std::env::temp_dir().join(format!(
            "moldavite-backlinks-{tag}-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir_all(&base).unwrap();
        base
    }

    #[test]
    fn security_regression_create_note_from_link_rejects_windows_reserved_names() {
        let base = tmp_notes_dir("reserved-names");

        for name in ["NUL", "com1"] {
            let result = create_note_from_link_at(&base, name);
            assert!(result.is_err(), "{name} must be rejected");
        }
        assert!(!base.join("notes/nul.md").exists());
        assert!(!base.join("notes/com1.md").exists());

        let _ = std::fs::remove_dir_all(&base);
    }

    #[test]
    fn create_note_from_link_still_creates_ordinary_notes() {
        let base = tmp_notes_dir("ordinary-note");

        let (filename, content) = create_note_from_link_at(&base, "Meeting Notes").unwrap();
        assert_eq!(filename, "meeting-notes.md");
        assert!(content.starts_with("# Meeting Notes"));
        assert!(base.join("notes/meeting-notes.md").exists());

        let _ = std::fs::remove_dir_all(&base);
    }
}

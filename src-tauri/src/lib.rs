//! Moldavite - A local-first note-taking app for connected thinking
//!
//! The Tauri command surface is organized into per-domain modules under
//! `commands/`. Shared building blocks (types, path helpers, validation,
//! persistence, wiki/template helpers) live alongside it.
//!
//! # Security
//!
//! - All file operations validate paths to prevent traversal attacks
//! - File permissions are set to 0o600 (owner read/write only)
//! - Directory permissions are set to 0o700 (owner only)
//! - Note encryption uses AES-256-GCM with Argon2 key derivation
//! - Rate limiting prevents brute-force attacks on locked notes

// =============================================================================
// MODULE DECLARATIONS
// =============================================================================

/// macOS calendar integration (EventKit)
#[cfg(target_os = "macos")]
mod calendar;

/// Core encryption logic (AES-256-GCM)
mod encryption;

/// Security utilities (rate limiting)
mod security;

/// Shared utilities (paths, config, permissions)
mod utils;

// Refactored domain modules.
pub(crate) mod backlinks_index;
pub(crate) mod commands;
pub(crate) mod paths;
pub(crate) mod persist;
pub(crate) mod templates_data;
pub(crate) mod types;
pub(crate) mod validation;
pub(crate) mod wiki;

#[cfg(target_os = "macos")]
use calendar::{CalendarEvent, CalendarInfo, CalendarPermission};

use commands::backlinks::{create_note_from_link, get_backlinks, scan_note_links};
use commands::export_import::{
    export_encrypted_backup, export_notes, export_settings_json, import_encrypted_backup,
    import_notes, import_settings_json,
};
use commands::folders::{create_folder, delete_folder, list_folders, move_folder, rename_folder};
use commands::graph::get_note_graph;
use commands::locking::{is_note_locked, lock_note, permanently_unlock_note, unlock_note};
use commands::misc::{
    ensure_directories, get_all_note_colors, get_note_color, get_notes_directory, save_image,
    set_note_color, set_notes_directory, write_binary_file,
};
use commands::notes::{
    clear_all_notes, create_note, delete_note, duplicate_note, export_single_note,
    fix_note_permissions, list_notes, move_note, read_note, rename_note, write_note,
};
use commands::search::search_notes_content;
use commands::templates::{
    apply_template, create_note_from_template, delete_template, get_template, list_templates,
    save_template, update_template,
};
use commands::trash::{
    cleanup_old_trash, empty_trash, list_trash, permanently_delete_trash, read_trashed_note,
    restore_note, restore_note_from_folder, trash_folder, trash_note,
};

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
    use std::sync::Arc;

    use crate::backlinks_index::BacklinksIndex;

    let backlinks_index = Arc::new(BacklinksIndex::new());

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(backlinks_index.clone())
        .setup(move |app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            // Build backlinks index off the main thread so startup isn't blocked.
            let idx = backlinks_index.clone();
            tauri::async_runtime::spawn_blocking(move || {
                idx.rebuild_from_disk();
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            ensure_directories,
            list_notes,
            search_notes_content,
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
            read_trashed_note,
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
            // Graph view
            get_note_graph,
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
            // Binary file write (PDF export)
            write_binary_file,
            // Settings JSON export / import
            export_settings_json,
            import_settings_json,
            // Image handling
            save_image,
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

#[cfg(test)]
mod tests {
    use std::fs;
    use std::path::{Path, PathBuf};

    use crate::commands::search::search_notes_content_in;
    use crate::validation::{is_safe_filename, validate_path_within_base};

    // ---- is_safe_filename --------------------------------------------------

    #[test]
    fn is_safe_filename_accepts_simple_names() {
        assert!(is_safe_filename("note.md"));
        assert!(is_safe_filename("My Note 2024.md"));
        assert!(is_safe_filename("a"));
        assert!(is_safe_filename("日本語.md"));
    }

    #[test]
    fn is_safe_filename_rejects_empty() {
        assert!(!is_safe_filename(""));
    }

    #[test]
    fn is_safe_filename_rejects_path_traversal() {
        assert!(!is_safe_filename(".."));
        assert!(!is_safe_filename("../secrets.md"));
        assert!(!is_safe_filename("..\\secrets.md"));
        assert!(!is_safe_filename("foo/../bar.md"));
        assert!(!is_safe_filename("notes/..hidden"));
    }

    #[test]
    fn is_safe_filename_rejects_absolute_paths() {
        assert!(!is_safe_filename("/etc/passwd"));
        assert!(!is_safe_filename("\\Windows\\System32"));
    }

    #[test]
    fn is_safe_filename_rejects_directory_separators() {
        assert!(!is_safe_filename("sub/note.md"));
        assert!(!is_safe_filename("sub\\note.md"));
    }

    #[test]
    fn is_safe_filename_rejects_null_bytes() {
        assert!(!is_safe_filename("note\0.md"));
    }

    // ---- validate_path_within_base -----------------------------------------

    fn make_tmp_base() -> PathBuf {
        let base = std::env::temp_dir().join(format!(
            "moldavite-test-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_nanos())
                .unwrap_or(0)
        ));
        fs::create_dir_all(&base).unwrap();
        base
    }

    #[test]
    fn validate_path_within_base_accepts_child() {
        let base = make_tmp_base();
        let dest = base.join("child.md");
        // Parent (== base) must exist; dest itself does not need to
        assert!(validate_path_within_base(&dest, &base).is_ok());
        fs::remove_dir_all(&base).ok();
    }

    #[test]
    fn validate_path_within_base_accepts_nested_child() {
        let base = make_tmp_base();
        let sub = base.join("sub");
        fs::create_dir_all(&sub).unwrap();
        let dest = sub.join("note.md");
        assert!(validate_path_within_base(&dest, &base).is_ok());
        fs::remove_dir_all(&base).ok();
    }

    #[test]
    fn validate_path_within_base_rejects_sibling() {
        let base = make_tmp_base();
        let outside = base.parent().unwrap().join(format!(
            "moldavite-test-outside-{}",
            std::process::id()
        ));
        fs::create_dir_all(&outside).unwrap();
        let dest = outside.join("leak.md");
        let result = validate_path_within_base(&dest, &base);
        assert!(result.is_err(), "expected rejection, got {:?}", result);
        fs::remove_dir_all(&base).ok();
        fs::remove_dir_all(&outside).ok();
    }

    #[test]
    fn validate_path_within_base_rejects_missing_base() {
        let base = std::env::temp_dir().join(format!(
            "moldavite-does-not-exist-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_nanos())
                .unwrap_or(0)
        ));
        let dest = base.join("foo.md");
        assert!(validate_path_within_base(&dest, &base).is_err());
    }

    #[cfg(unix)]
    #[test]
    fn validate_path_within_base_rejects_symlinked_subdir() {
        use std::os::unix::fs::symlink;

        let base = make_tmp_base();
        // Create a real directory outside of base
        let outside = base.parent().unwrap().join(format!(
            "moldavite-test-symtarget-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_nanos())
                .unwrap_or(0)
        ));
        fs::create_dir_all(&outside).unwrap();

        // Create a symlink inside base pointing to the outside directory
        let link = base.join("evil");
        symlink(&outside, &link).unwrap();

        let dest = link.join("pwned.md");
        let result = validate_path_within_base(&dest, &base);
        assert!(result.is_err(), "expected symlink rejection, got {:?}", result);

        fs::remove_dir_all(&base).ok();
        fs::remove_dir_all(&outside).ok();
    }

    // ---- search_notes_content_in ------------------------------------------

    fn seed_notes(base: &Path) {
        fs::create_dir_all(base.join("notes")).unwrap();
        fs::create_dir_all(base.join("notes/Projects")).unwrap();
        fs::create_dir_all(base.join("daily")).unwrap();
        fs::create_dir_all(base.join("weekly")).unwrap();
        fs::create_dir_all(base.join(".trash")).unwrap();

        fs::write(
            base.join("notes/alpha.md"),
            "First line\nThe quick brown fox\nalpha beta gamma\n",
        )
        .unwrap();
        fs::write(
            base.join("notes/Projects/beta.md"),
            "beta appears once here\nno match on this line\nand beta again\n",
        )
        .unwrap();
        fs::write(
            base.join("daily/2026-04-24.md"),
            "Daily log\nDiscussed the fox plan\n",
        )
        .unwrap();
        fs::write(
            base.join("weekly/2026-W17.md"),
            "Weekly review\nfox sightings up\n",
        )
        .unwrap();
        // A locked note that must never be scanned
        fs::write(base.join("notes/secret.md.locked"), "fox fox fox fox").unwrap();
        // A trashed note that must never be scanned
        fs::write(base.join(".trash/old.md"), "fox fox fox").unwrap();
    }

    #[test]
    fn search_notes_content_finds_matches() {
        let base = make_tmp_base();
        seed_notes(&base);
        let results = search_notes_content_in(&base, &base.join(".trash"), "fox", 100);
        let names: Vec<_> = results.iter().map(|r| r.filename.clone()).collect();
        assert!(names.contains(&"alpha.md".to_string()));
        assert!(names.contains(&"2026-04-24.md".to_string()));
        assert!(names.contains(&"2026-W17.md".to_string()));
        fs::remove_dir_all(&base).ok();
    }

    #[test]
    fn search_notes_content_excludes_locked_files() {
        let base = make_tmp_base();
        seed_notes(&base);
        let results = search_notes_content_in(&base, &base.join(".trash"), "fox", 100);
        for r in &results {
            assert!(!r.filename.ends_with(".locked"), "locked file surfaced: {}", r.filename);
            assert!(!r.path.starts_with(".trash"), "trash file surfaced: {}", r.path);
        }
        fs::remove_dir_all(&base).ok();
    }

    #[test]
    fn search_notes_content_is_case_insensitive() {
        let base = make_tmp_base();
        seed_notes(&base);
        let lower = search_notes_content_in(&base, &base.join(".trash"), "fox", 100);
        let upper = search_notes_content_in(&base, &base.join(".trash"), "FOX", 100);
        assert_eq!(lower.len(), upper.len());
        fs::remove_dir_all(&base).ok();
    }

    #[test]
    fn search_notes_content_sorts_by_match_count() {
        let base = make_tmp_base();
        seed_notes(&base);
        let results = search_notes_content_in(&base, &base.join(".trash"), "beta", 100);
        assert!(!results.is_empty());
        // beta.md has 2 matches, alpha.md has 1. beta.md must come first.
        assert_eq!(results[0].filename, "beta.md");
        assert_eq!(results[0].match_count, 2);
        fs::remove_dir_all(&base).ok();
    }

    #[test]
    fn search_notes_content_respects_max_results() {
        let base = make_tmp_base();
        seed_notes(&base);
        let results = search_notes_content_in(&base, &base.join(".trash"), "fox", 2);
        assert!(results.len() <= 2);
        fs::remove_dir_all(&base).ok();
    }

    #[test]
    fn search_notes_content_empty_query_returns_nothing() {
        let base = make_tmp_base();
        seed_notes(&base);
        let results = search_notes_content_in(&base, &base.join(".trash"), "   ", 100);
        assert!(results.is_empty());
        fs::remove_dir_all(&base).ok();
    }

    #[test]
    fn search_notes_content_reports_folder_path() {
        let base = make_tmp_base();
        seed_notes(&base);
        let results = search_notes_content_in(&base, &base.join(".trash"), "beta", 100);
        let beta = results.iter().find(|r| r.filename == "beta.md").unwrap();
        assert_eq!(beta.folder_path.as_deref(), Some("Projects"));
        assert!(!beta.is_daily);
        assert!(!beta.is_weekly);
        fs::remove_dir_all(&base).ok();
    }
}

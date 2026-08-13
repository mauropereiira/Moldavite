//! Note locking and unlocking across daily, weekly, and standalone trees.
//!
//! Locking atomically replaces plaintext with an authenticated `.md.locked`
//! payload and never keeps both forms as the steady state. Temporary unlocks
//! return plaintext without changing disk; permanent unlock restores the
//! Markdown file. Password failures pass through per-note and global rate limits,
//! and every note address is validated before choosing a tree.

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use tauri::State;
use zeroize::Zeroizing;

use crate::backlinks_index::BacklinksIndex;
use crate::encryption;
use crate::paths::get_notes_dir;
use crate::security;
use crate::validation::{is_safe_existing_filename, is_safe_existing_note_path};

fn is_valid_note_ref(filename: &str, is_daily: bool, is_weekly: bool) -> bool {
    if is_daily || is_weekly {
        is_safe_existing_filename(filename)
    } else {
        is_safe_existing_note_path(filename)
    }
}

fn note_dir(forge_root: &Path, is_daily: bool, is_weekly: bool) -> PathBuf {
    if is_weekly {
        forge_root.join("weekly")
    } else if is_daily {
        forge_root.join("daily")
    } else {
        forge_root.join("notes")
    }
}

fn index_key(filename: &str) -> &str {
    Path::new(filename)
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or(filename)
}

fn note_id(filename: &str, is_daily: bool, is_weekly: bool) -> String {
    format!(
        "{}:{}:",
        if is_weekly {
            "weekly"
        } else if is_daily {
            "daily"
        } else {
            "standalone"
        },
        filename
    )
}

fn locked_path(dir: &Path, filename: &str) -> PathBuf {
    dir.join(format!("{filename}.locked"))
}

fn lock_note_in(
    forge_root: &Path,
    filename: String,
    password: String,
    is_daily: bool,
    is_weekly: bool,
    index: &BacklinksIndex,
) -> Result<(), String> {
    if !is_valid_note_ref(&filename, is_daily, is_weekly) {
        return Err("Invalid filename".to_string());
    }
    let password = Zeroizing::new(password);
    let dir = note_dir(forge_root, is_daily, is_weekly);
    let original_path = dir.join(&filename);
    let locked_path = locked_path(&dir, &filename);

    if !original_path.exists() {
        return Err("Note not found".to_string());
    }
    if locked_path.exists() {
        return Err("Note is already locked".to_string());
    }

    let content =
        fs::read_to_string(&original_path).map_err(|e| format!("Failed to read note: {e}"))?;
    let encrypted = encryption::encrypt_content(&content, &password)?;
    crate::persist::write_atomic(&locked_path, encrypted.as_bytes(), Some(0o600))
        .map_err(|e| format!("Failed to write locked note: {e}"))?;
    fs::remove_file(&original_path).map_err(|e| format!("Failed to remove original note: {e}"))?;

    index.remove_note(index_key(&filename));
    Ok(())
}

/// Atomically replace one plaintext note with its authenticated `.locked` form.
#[tauri::command]
pub(crate) fn lock_note(
    filename: String,
    password: String,
    is_daily: bool,
    is_weekly: bool,
    index: State<'_, Arc<BacklinksIndex>>,
) -> Result<(), String> {
    lock_note_in(
        &get_notes_dir(),
        filename.clone(),
        password,
        is_daily,
        is_weekly,
        &index,
    )?;
    crate::semantic::note_removed(&crate::semantic::note_rel_path(
        &filename, is_daily, is_weekly,
    ));
    Ok(())
}

fn unlock_note_in(
    forge_root: &Path,
    filename: String,
    password: String,
    is_daily: bool,
    is_weekly: bool,
) -> Result<String, String> {
    if !is_valid_note_ref(&filename, is_daily, is_weekly) {
        return Err("Invalid filename".to_string());
    }
    let password = Zeroizing::new(password);
    let note_id = note_id(&filename, is_daily, is_weekly);

    let rate_check = security::check_rate_limit(&note_id);
    if !rate_check.allowed {
        let secs = rate_check.retry_after_secs.unwrap_or(30);
        return Err(format!(
            "RATE_LIMITED:{secs}:Too many failed attempts. Please wait {secs} seconds before trying again."
        ));
    }

    let dir = note_dir(forge_root, is_daily, is_weekly);
    let locked_path = locked_path(&dir, &filename);
    if !locked_path.exists() {
        return Err("Locked note not found".to_string());
    }
    let encrypted =
        fs::read_to_string(&locked_path).map_err(|e| format!("Failed to read locked note: {e}"))?;

    match encryption::decrypt_content(&encrypted, &password) {
        Ok(content) => {
            security::record_successful_attempt(&note_id);
            Ok(content)
        }
        Err(_) => {
            let result = security::record_failed_attempt(&note_id);
            if !result.allowed {
                let secs = result.retry_after_secs.unwrap_or(30);
                Err(format!(
                    "RATE_LIMITED:{secs}:Too many failed attempts. Please wait {secs} seconds before trying again."
                ))
            } else {
                let remaining = result.remaining_attempts.unwrap_or(0);
                Err(format!(
                    "WRONG_PASSWORD:{remaining}:Incorrect password. {remaining} attempts remaining."
                ))
            }
        }
    }
}

/// Return authenticated plaintext without modifying the encrypted file.
/// Includes brute-force protection with rate limiting.
#[tauri::command]
pub(crate) fn unlock_note(
    filename: String,
    password: String,
    is_daily: bool,
    is_weekly: bool,
) -> Result<String, String> {
    unlock_note_in(&get_notes_dir(), filename, password, is_daily, is_weekly)
}

/// `resolver` mirrors `BacklinksIndex::update_note_with`: the default resolver
/// touches the real Forge on disk, so tests inject their own rather than
/// depending on a Documents directory existing on the machine.
fn permanently_unlock_note_in(
    forge_root: &Path,
    filename: String,
    password: String,
    is_daily: bool,
    is_weekly: bool,
    index: &BacklinksIndex,
    resolver: Option<&crate::backlinks_index::Resolver>,
) -> Result<(), String> {
    if !is_valid_note_ref(&filename, is_daily, is_weekly) {
        return Err("Invalid filename".to_string());
    }
    let password = Zeroizing::new(password);
    let note_id = note_id(&filename, is_daily, is_weekly);

    let rate_check = security::check_rate_limit(&note_id);
    if !rate_check.allowed {
        let secs = rate_check.retry_after_secs.unwrap_or(30);
        return Err(format!(
            "RATE_LIMITED:{secs}:Too many failed attempts. Please wait {secs} seconds before trying again."
        ));
    }

    let dir = note_dir(forge_root, is_daily, is_weekly);
    let locked_path = locked_path(&dir, &filename);
    let original_path = dir.join(&filename);
    if !locked_path.exists() {
        return Err("Locked note not found".to_string());
    }
    let encrypted =
        fs::read_to_string(&locked_path).map_err(|e| format!("Failed to read locked note: {e}"))?;
    let decrypted = match encryption::decrypt_content(&encrypted, &password) {
        Ok(content) => {
            security::record_successful_attempt(&note_id);
            content
        }
        Err(_) => {
            let result = security::record_failed_attempt(&note_id);
            if !result.allowed {
                let secs = result.retry_after_secs.unwrap_or(30);
                return Err(format!(
                    "RATE_LIMITED:{secs}:Too many failed attempts. Please wait {secs} seconds before trying again."
                ));
            }
            let remaining = result.remaining_attempts.unwrap_or(0);
            return Err(format!(
                "WRONG_PASSWORD:{remaining}:Incorrect password. {remaining} attempts remaining."
            ));
        }
    };

    crate::persist::write_atomic(&original_path, decrypted.as_bytes(), Some(0o600))
        .map_err(|e| format!("Failed to write unlocked note: {e}"))?;
    fs::remove_file(&locked_path).map_err(|e| format!("Failed to remove locked note: {e}"))?;

    let body = crate::frontmatter::parse_note(&decrypted).body;
    match resolver {
        Some(resolve) => index.update_note_with(index_key(&filename), &body, resolve),
        None => index.update_note(index_key(&filename), &body),
    }
    Ok(())
}

/// Atomically replace an encrypted note with authenticated plaintext Markdown.
/// Includes brute-force protection with rate limiting.
#[tauri::command]
pub(crate) fn permanently_unlock_note(
    filename: String,
    password: String,
    is_daily: bool,
    is_weekly: bool,
    index: State<'_, Arc<BacklinksIndex>>,
) -> Result<(), String> {
    permanently_unlock_note_in(
        &get_notes_dir(),
        filename.clone(),
        password,
        is_daily,
        is_weekly,
        &index,
        None,
    )?;
    crate::semantic::note_changed(&crate::semantic::note_rel_path(
        &filename, is_daily, is_weekly,
    ));
    Ok(())
}

/// Check if a note is locked.
#[tauri::command]
pub(crate) fn is_note_locked(filename: String, is_daily: bool, is_weekly: bool) -> bool {
    if !is_valid_note_ref(&filename, is_daily, is_weekly) {
        return false;
    }
    locked_path(&note_dir(&get_notes_dir(), is_daily, is_weekly), &filename).exists()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temp_forge(tag: &str) -> PathBuf {
        let root = std::env::temp_dir().join(format!(
            "moldavite-locking-{tag}-{}-{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        for folder in ["daily", "weekly", "notes/Projects"] {
            fs::create_dir_all(root.join(folder)).unwrap();
        }
        root
    }

    fn resolver(name: &str) -> String {
        format!("{}.md", name.to_lowercase())
    }

    #[test]
    fn nested_standalone_locking_targets_relative_path_and_refreshes_backlinks() {
        let root = temp_forge("nested");
        let index = BacklinksIndex::new();
        let nested_content = "# Private Q3\n\nConfidential context around [[Target]].";
        fs::write(root.join("notes/Q3 Planning.md"), "root note").unwrap();
        fs::write(root.join("notes/Projects/Q3 Planning.md"), nested_content).unwrap();
        index.update_note_with("Q3 Planning.md", nested_content, &resolver);
        assert_eq!(index.get("target.md", "Target").len(), 1);

        lock_note_in(
            &root,
            "Projects/Q3 Planning.md".into(),
            "correct horse".into(),
            false,
            false,
            &index,
        )
        .unwrap();
        assert_eq!(
            fs::read_to_string(root.join("notes/Q3 Planning.md")).unwrap(),
            "root note"
        );
        assert!(!root.join("notes/Q3 Planning.md.locked").exists());
        assert!(root.join("notes/Projects/Q3 Planning.md.locked").is_file());
        assert!(index.get("target.md", "Target").is_empty());
        assert_eq!(
            unlock_note_in(
                &root,
                "Projects/Q3 Planning.md".into(),
                "correct horse".into(),
                false,
                false,
            )
            .unwrap(),
            nested_content
        );

        permanently_unlock_note_in(
            &root,
            "Projects/Q3 Planning.md".into(),
            "correct horse".into(),
            false,
            false,
            &index,
            Some(&resolver),
        )
        .unwrap();
        assert_eq!(
            fs::read_to_string(root.join("notes/Projects/Q3 Planning.md")).unwrap(),
            nested_content
        );
        let backlinks = index.get("target.md", "Target");
        assert_eq!(backlinks.len(), 1);
        assert_eq!(backlinks[0].from_title, "Private Q3");
        assert!(backlinks[0].context.contains("Confidential context"));

        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn locking_validation_rejects_nested_daily_paths_and_accepts_bare_daily_names() {
        let root = temp_forge("validation");
        let index = BacklinksIndex::new();
        fs::write(root.join("daily/2026-07-26.md"), "daily").unwrap();

        let rejected = lock_note_in(
            &root,
            "nested/2026-07-26.md".into(),
            "password".into(),
            true,
            false,
            &index,
        );
        assert_eq!(rejected.unwrap_err(), "Invalid filename");

        lock_note_in(
            &root,
            "2026-07-26.md".into(),
            "password".into(),
            true,
            false,
            &index,
        )
        .unwrap();
        assert!(root.join("daily/2026-07-26.md.locked").is_file());

        fs::remove_dir_all(root).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn legacy_nonportable_note_can_be_locked_and_restored() {
        let root = temp_forge("legacy-name");
        let folder = root.join("notes/Q3: Roadmap.");
        fs::create_dir_all(&folder).unwrap();
        let relative = "Q3: Roadmap./Reports..md";
        let plaintext = "legacy note body";
        fs::write(folder.join("Reports..md"), plaintext).unwrap();
        let index = BacklinksIndex::new();

        lock_note_in(
            &root,
            relative.into(),
            "portable password".into(),
            false,
            false,
            &index,
        )
        .unwrap();
        assert!(!folder.join("Reports..md").exists());
        assert!(folder.join("Reports..md.locked").is_file());
        assert_eq!(
            unlock_note_in(
                &root,
                relative.into(),
                "portable password".into(),
                false,
                false,
            )
            .unwrap(),
            plaintext
        );

        permanently_unlock_note_in(
            &root,
            relative.into(),
            "portable password".into(),
            false,
            false,
            &index,
            Some(&resolver),
        )
        .unwrap();
        assert_eq!(
            fs::read_to_string(folder.join("Reports..md")).unwrap(),
            plaintext
        );
        assert!(!folder.join("Reports..md.locked").exists());

        fs::remove_dir_all(root).unwrap();
    }
}

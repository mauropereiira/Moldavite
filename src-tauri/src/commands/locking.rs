//! Note locking and unlocking across daily, weekly, and standalone trees.
//!
//! Locking atomically replaces plaintext with an authenticated `.md.locked`
//! payload and never keeps both forms as the steady state. Temporary unlocks
//! return plaintext without changing disk, except to settle a plaintext copy an
//! interrupted lock or unlock left behind; permanent unlock restores the
//! Markdown file. Password failures pass through per-note and global rate limits,
//! and every note address is validated before choosing a tree.

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use tauri::State;
use zeroize::Zeroizing;

use crate::backlinks_index::BacklinksIndex;
use crate::encryption;
use crate::note_file_access::{self, Access};
use crate::paths::get_notes_dir;
use crate::security;
use crate::validation::{
    is_safe_existing_filename, is_safe_existing_note_path, validate_path_within_base,
};

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

/// Writes `new` before `transition` removes `old`, so a crash between the two
/// leaves both forms intact and never ciphertext under the plaintext name.
fn publish_replacement<F>(
    old: &Path,
    new: &Path,
    contents: &str,
    label: &str,
    transition: F,
) -> Result<(), String>
where
    F: FnOnce(&Path, &Path) -> std::io::Result<()>,
{
    crate::persist::write_atomic_as(new, contents.as_bytes(), Some(0o600), old)
        .map_err(|e| format!("Failed to write {label} note: {e}"))?;
    if let Err(error) = transition(old, new) {
        fs::remove_file(new).map_err(|rollback| {
            format!(
                "Failed to publish {label} note: {error}; failed to remove {label} copy: {rollback}"
            )
        })?;
        return Err(format!("Failed to publish {label} note: {error}"));
    }
    Ok(())
}

/// What an unlock found beside the locked file.
#[derive(Debug, PartialEq)]
enum Twin {
    None,
    Removed,
    /// Folder-relative address of the conflict copy, and its body.
    Kept(String, String),
}

/// A crash between the two steps of `publish_replacement` leaves `<name>.md`
/// beside `<name>.md.locked`. Only the decrypted text can say whether the two
/// match, so this runs after the password is verified: a byte-identical
/// plaintext copy is removed, and a differing one is first kept as a conflict
/// copy. Either way only the locked form remains.
fn settle_twin(original: &Path, filename: &str, decrypted: &str) -> Result<Twin, String> {
    if !original.is_file() {
        return Ok(Twin::None);
    }
    let bytes = fs::read(original).map_err(|e| format!("Failed to read unlocked copy: {e}"))?;
    let twin = if bytes == decrypted.as_bytes() {
        Twin::Removed
    } else {
        let name = crate::commands::notes::preserve_conflict_bytes(original, &bytes)?;
        let rel = match filename.rsplit_once('/') {
            Some((folder, _)) => format!("{folder}/{name}"),
            None => name,
        };
        let body = crate::frontmatter::parse_note(&String::from_utf8_lossy(&bytes)).body;
        Twin::Kept(rel, body)
    };
    fs::remove_file(original).map_err(|e| format!("Failed to remove unlocked copy: {e}"))?;
    Ok(twin)
}

fn index_kept_twin(twin: &Twin, is_daily: bool, is_weekly: bool, index: &BacklinksIndex) {
    if let Twin::Kept(rel, body) = twin {
        index.update_note(
            &crate::semantic::note_rel_path(rel, is_daily, is_weekly),
            body,
        );
    }
}

fn conflict_copy_changed(conflict_copy: Option<&str>, is_daily: bool, is_weekly: bool) {
    if let Some(rel) = conflict_copy {
        crate::semantic::note_changed(&crate::semantic::note_rel_path(rel, is_daily, is_weekly));
        crate::search_index::note_changed(&crate::semantic::note_rel_path(
            rel, is_daily, is_weekly,
        ));
    }
}

/// A temporary unlock's plaintext, plus where a differing plaintext copy found
/// beside the locked file was kept.
#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct UnlockedNote {
    pub(crate) content: String,
    pub(crate) conflict_copy: Option<String>,
    #[serde(skip)]
    pub(crate) settled_twin: bool,
}

pub(crate) fn lock_note_in(
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

    validate_path_within_base(&original_path, &dir).map_err(|_| "Invalid note path".to_string())?;
    validate_path_within_base(&locked_path, &dir).map_err(|_| "Invalid note path".to_string())?;

    note_file_access::transaction(
        &[
            Access::moving(&original_path, 1),
            Access::write(&locked_path),
        ],
        || {
            if !original_path.exists() {
                return Err("Note not found".to_string());
            }
            if locked_path.exists() {
                return Err("Note is already locked".to_string());
            }

            validate_path_within_base(&original_path, &dir)
                .map_err(|_| "Invalid note path".to_string())?;
            let content = fs::read_to_string(&original_path)
                .map_err(|e| format!("Failed to read note: {e}"))?;
            let encrypted = encryption::encrypt_note_content(
                &content,
                &password,
                &note_id(&filename, is_daily, is_weekly),
            )?;
            validate_path_within_base(&original_path, &dir)
                .map_err(|_| "Invalid note path".to_string())?;
            validate_path_within_base(&locked_path, &dir)
                .map_err(|_| "Invalid note path".to_string())?;
            publish_replacement(
                &original_path,
                &locked_path,
                &encrypted,
                "locked",
                |original, _| fs::remove_file(original),
            )?;

            Ok(())
        },
    )?;

    index.remove_note(&crate::semantic::note_rel_path(
        &filename, is_daily, is_weekly,
    ));
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
        &get_notes_dir()?,
        filename.clone(),
        password,
        is_daily,
        is_weekly,
        &index,
    )?;
    crate::semantic::note_removed(&crate::semantic::note_rel_path(
        &filename, is_daily, is_weekly,
    ));
    crate::search_index::note_removed(&crate::semantic::note_rel_path(
        &filename, is_daily, is_weekly,
    ));
    crate::activity_log::record(
        crate::activity_log::Action::Locked,
        &crate::semantic::note_rel_path(&filename, is_daily, is_weekly),
    );
    Ok(())
}

pub(crate) fn unlock_note_in(
    forge_root: &Path,
    filename: String,
    password: String,
    is_daily: bool,
    is_weekly: bool,
    index: &BacklinksIndex,
) -> Result<UnlockedNote, String> {
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
    validate_path_within_base(&locked_path, &dir).map_err(|_| "Invalid note path".to_string())?;
    validate_path_within_base(&original_path, &dir).map_err(|_| "Invalid note path".to_string())?;
    let access = [Access::read(&locked_path), Access::deleting(&original_path)];
    let (content, twin) = note_file_access::transaction(&access, || {
        if !locked_path.exists() {
            return Err("Locked note not found".to_string());
        }
        validate_path_within_base(&locked_path, &dir)
            .map_err(|_| "Invalid note path".to_string())?;
        let encrypted = fs::read_to_string(&locked_path)
            .map_err(|e| format!("Failed to read locked note: {e}"))?;

        match encryption::decrypt_note_content(&encrypted, &password, &note_id) {
            Ok(content) => {
                security::record_successful_attempt(&note_id);
                validate_path_within_base(&original_path, &dir)
                    .map_err(|_| "Invalid note path".to_string())?;
                let twin = settle_twin(&original_path, &filename, &content)?;
                Ok((content, twin))
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
    })?;
    let settled_twin = twin != Twin::None;
    if settled_twin {
        index.remove_note(&crate::semantic::note_rel_path(
            &filename, is_daily, is_weekly,
        ));
    }
    index_kept_twin(&twin, is_daily, is_weekly, index);
    Ok(UnlockedNote {
        content,
        conflict_copy: match twin {
            Twin::Kept(rel, _) => Some(rel),
            _ => None,
        },
        settled_twin,
    })
}

/// Return authenticated plaintext without modifying the encrypted file.
/// Includes brute-force protection with rate limiting.
#[tauri::command]
pub(crate) fn unlock_note(
    filename: String,
    password: String,
    is_daily: bool,
    is_weekly: bool,
    index: State<'_, Arc<BacklinksIndex>>,
) -> Result<UnlockedNote, String> {
    let unlocked = unlock_note_in(
        &get_notes_dir()?,
        filename.clone(),
        password,
        is_daily,
        is_weekly,
        &index,
    )?;
    if unlocked.settled_twin {
        let source = crate::semantic::note_rel_path(&filename, is_daily, is_weekly);
        crate::semantic::note_removed(&source);
        crate::search_index::note_removed(&source);
    }
    conflict_copy_changed(unlocked.conflict_copy.as_deref(), is_daily, is_weekly);
    Ok(unlocked)
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
) -> Result<Option<String>, String> {
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
    validate_path_within_base(&locked_path, &dir).map_err(|_| "Invalid note path".to_string())?;
    validate_path_within_base(&original_path, &dir).map_err(|_| "Invalid note path".to_string())?;
    let (decrypted, twin) = note_file_access::transaction(
        &[
            Access::moving(&locked_path, 1),
            Access::write(&original_path),
        ],
        || {
            if !locked_path.exists() {
                return Err("Locked note not found".to_string());
            }
            validate_path_within_base(&locked_path, &dir)
                .map_err(|_| "Invalid note path".to_string())?;
            let encrypted = fs::read_to_string(&locked_path)
                .map_err(|e| format!("Failed to read locked note: {e}"))?;
            let decrypted = match encryption::decrypt_note_content(&encrypted, &password, &note_id)
            {
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

            validate_path_within_base(&locked_path, &dir)
                .map_err(|_| "Invalid note path".to_string())?;
            validate_path_within_base(&original_path, &dir)
                .map_err(|_| "Invalid note path".to_string())?;
            let twin = settle_twin(&original_path, &filename, &decrypted)?;
            publish_replacement(
                &locked_path,
                &original_path,
                &decrypted,
                "unlocked",
                |locked, _| fs::remove_file(locked),
            )?;

            Ok((decrypted, twin))
        },
    )?;
    index_kept_twin(&twin, is_daily, is_weekly, index);

    let body = crate::frontmatter::parse_note(&decrypted).body;
    let source = crate::semantic::note_rel_path(&filename, is_daily, is_weekly);
    match resolver {
        Some(resolve) => index.update_note_with(&source, &body, resolve),
        None => index.update_note(&source, &body),
    }
    Ok(match twin {
        Twin::Kept(rel, _) => Some(rel),
        _ => None,
    })
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
) -> Result<Option<String>, String> {
    let conflict_copy = permanently_unlock_note_in(
        &get_notes_dir()?,
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
    crate::search_index::note_changed(&crate::semantic::note_rel_path(
        &filename, is_daily, is_weekly,
    ));
    crate::activity_log::record(
        crate::activity_log::Action::Unlocked,
        &crate::semantic::note_rel_path(&filename, is_daily, is_weekly),
    );
    conflict_copy_changed(conflict_copy.as_deref(), is_daily, is_weekly);
    Ok(conflict_copy)
}

#[tauri::command]
pub(crate) fn is_note_locked(
    filename: String,
    is_daily: bool,
    is_weekly: bool,
) -> Result<bool, String> {
    if !is_valid_note_ref(&filename, is_daily, is_weekly) {
        return Ok(false);
    }
    let dir = note_dir(&get_notes_dir()?, is_daily, is_weekly);
    let path = locked_path(&dir, &filename);
    validate_path_within_base(&path, &dir)?;
    note_file_access::transaction(&[Access::read(&path)], || Ok(path.exists()))
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
        index.update_note_with("notes/Projects/Q3 Planning.md", nested_content, &resolver);
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
                &index,
            )
            .unwrap()
            .content,
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
        assert_eq!(backlinks[0].from_path, "notes/Projects/Q3 Planning.md");
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

    #[test]
    fn security_regression_lock_publish_failure_never_leaves_both_forms() {
        let root = temp_forge("transaction-failure");
        let original = root.join("notes/note.md");
        let locked = root.join("notes/note.md.locked");
        fs::write(&original, "plaintext").unwrap();

        let result = publish_replacement(
            &original,
            &locked,
            "ciphertext",
            "locked",
            |_original, _locked| Err(std::io::Error::other("injected transition failure")),
        );

        assert!(result.is_err());
        assert_eq!(fs::read_to_string(&original).unwrap(), "plaintext");
        assert!(
            !locked.exists(),
            "failed locking left a published locked copy"
        );
        fs::remove_dir_all(root).unwrap();
    }

    fn read_if_present(path: &Path) -> Option<String> {
        fs::read_to_string(path).ok()
    }

    #[test]
    fn a_crash_midway_through_locking_leaves_the_plaintext_recoverable() {
        let root = temp_forge("lock-crash-point");
        let original = root.join("notes/note.md");
        let locked = root.join("notes/note.md.locked");
        fs::write(&original, "plaintext").unwrap();
        let mut at_crash_point = None;

        publish_replacement(
            &original,
            &locked,
            "ciphertext",
            "locked",
            |original, locked| {
                at_crash_point = Some((read_if_present(original), read_if_present(locked)));
                fs::remove_file(original)
            },
        )
        .unwrap();

        assert_eq!(
            at_crash_point.unwrap(),
            (Some("plaintext".into()), Some("ciphertext".into()))
        );
        fs::remove_dir_all(root).unwrap();
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn locking_and_unlocking_keep_the_note_s_creation_time() {
        use std::os::macos::fs::FileTimesExt;
        let root = temp_forge("lock-created");
        let original = root.join("notes/note.md");
        let locked = root.join("notes/note.md.locked");
        fs::write(&original, "plaintext").unwrap();
        let created = UNIX_EPOCH + std::time::Duration::from_secs(1_600_000_000);
        fs::OpenOptions::new()
            .write(true)
            .open(&original)
            .unwrap()
            .set_times(fs::FileTimes::new().set_created(created))
            .unwrap();

        publish_replacement(&original, &locked, "ciphertext", "locked", |original, _| {
            fs::remove_file(original)
        })
        .unwrap();
        assert_eq!(fs::metadata(&locked).unwrap().created().unwrap(), created);
        publish_replacement(&locked, &original, "plaintext", "unlocked", |locked, _| {
            fs::remove_file(locked)
        })
        .unwrap();
        assert_eq!(fs::metadata(&original).unwrap().created().unwrap(), created);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn a_crash_midway_through_unlocking_leaves_the_ciphertext_where_it_was() {
        let root = temp_forge("unlock-crash-point");
        let original = root.join("notes/note.md");
        let locked = root.join("notes/note.md.locked");
        fs::write(&locked, "ciphertext").unwrap();
        let mut at_crash_point = None;

        publish_replacement(
            &locked,
            &original,
            "plaintext",
            "unlocked",
            |locked, original| {
                at_crash_point = Some((read_if_present(original), read_if_present(locked)));
                fs::remove_file(locked)
            },
        )
        .unwrap();

        assert_eq!(
            at_crash_point.unwrap(),
            (Some("plaintext".into()), Some("ciphertext".into()))
        );
        assert_eq!(read_if_present(&original).as_deref(), Some("plaintext"));
        assert!(!locked.exists());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn a_failed_unlock_publish_never_leaves_both_forms() {
        let root = temp_forge("unlock-failure");
        let original = root.join("notes/note.md");
        let locked = root.join("notes/note.md.locked");
        fs::write(&locked, "ciphertext").unwrap();

        let result = publish_replacement(&locked, &original, "plaintext", "unlocked", |_, _| {
            Err(std::io::Error::other("injected transition failure"))
        });

        assert!(result.is_err());
        assert_eq!(read_if_present(&locked).as_deref(), Some("ciphertext"));
        assert!(!original.exists());
        fs::remove_dir_all(root).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn security_regression_lock_rejects_symlinked_note_component() {
        use std::os::unix::fs::symlink;

        let root = temp_forge("symlink-component");
        let outside = root.join("outside");
        fs::create_dir_all(&outside).unwrap();
        fs::write(outside.join("secret.md"), "outside plaintext").unwrap();
        symlink(&outside, root.join("notes/Linked")).unwrap();
        let index = BacklinksIndex::new();

        let result = lock_note_in(
            &root,
            "Linked/secret.md".into(),
            "password".into(),
            false,
            false,
            &index,
        );

        assert!(result.is_err());
        assert_eq!(
            fs::read_to_string(outside.join("secret.md")).unwrap(),
            "outside plaintext"
        );
        assert!(!outside.join("secret.md.locked").exists());
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
                &index,
            )
            .unwrap()
            .content,
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

    #[test]
    fn legacy_v1_locked_note_can_still_be_opened_and_permanently_unlocked() {
        let root = temp_forge("legacy-v1-ciphertext");
        let filename = "legacy-v1.md";
        let plaintext = "legacy encrypted note";
        let encrypted = encryption::encrypt_content(plaintext, "old password").unwrap();
        fs::write(root.join("notes/legacy-v1.md.locked"), encrypted).unwrap();
        let index = BacklinksIndex::new();

        assert_eq!(
            unlock_note_in(
                &root,
                filename.into(),
                "old password".into(),
                false,
                false,
                &index,
            )
            .unwrap()
            .content,
            plaintext
        );
        permanently_unlock_note_in(
            &root,
            filename.into(),
            "old password".into(),
            false,
            false,
            &index,
            Some(&resolver),
        )
        .unwrap();

        assert_eq!(
            fs::read_to_string(root.join("notes/legacy-v1.md")).unwrap(),
            plaintext
        );
        assert!(!root.join("notes/legacy-v1.md.locked").exists());
        fs::remove_dir_all(root).unwrap();
    }
    const PAIR_PASSWORD: &str = "pair password";

    /// Every tree a note can live in: daily, weekly, standalone, and a folder.
    const PAIR_NOTES: [(&str, bool, bool); 4] = [
        ("2026-10-05.md", true, false),
        ("2026-W40.md", false, true),
        ("Plan.md", false, false),
        ("Projects/Plan.md", false, false),
    ];

    /// The state a crash between the two steps of `publish_replacement` leaves:
    /// `filename` locked over `locked_body`, with `plain` beside it.
    fn interrupted_pair(
        root: &Path,
        filename: &str,
        is_daily: bool,
        is_weekly: bool,
        locked_body: &str,
        plain: &[u8],
    ) -> (PathBuf, PathBuf) {
        let dir = note_dir(root, is_daily, is_weekly);
        let original = dir.join(filename);
        fs::write(&original, locked_body).unwrap();
        lock_note_in(
            root,
            filename.into(),
            PAIR_PASSWORD.into(),
            is_daily,
            is_weekly,
            &BacklinksIndex::new(),
        )
        .unwrap();
        fs::write(&original, plain).unwrap();
        (original, locked_path(&dir, filename))
    }

    /// Every file under `root`, by Forge-relative path, with its bytes.
    fn snapshot(root: &Path) -> std::collections::BTreeMap<String, Vec<u8>> {
        walkdir::WalkDir::new(root)
            .into_iter()
            .flatten()
            .filter(|entry| entry.file_type().is_file())
            .map(|entry| {
                let rel = entry.path().strip_prefix(root).unwrap();
                (
                    rel.to_string_lossy().replace('\\', "/"),
                    fs::read(entry.path()).unwrap(),
                )
            })
            .collect()
    }

    fn unlock_pair(root: &Path, filename: &str, is_daily: bool, is_weekly: bool) -> UnlockedNote {
        unlock_note_in(
            root,
            filename.into(),
            PAIR_PASSWORD.into(),
            is_daily,
            is_weekly,
            &BacklinksIndex::new(),
        )
        .unwrap()
    }

    fn permanently_unlock_pair(
        root: &Path,
        filename: &str,
        is_daily: bool,
        is_weekly: bool,
    ) -> Result<Option<String>, String> {
        permanently_unlock_note_in(
            root,
            filename.into(),
            PAIR_PASSWORD.into(),
            is_daily,
            is_weekly,
            &BacklinksIndex::new(),
            Some(&resolver),
        )
    }

    #[test]
    fn regression_173_temporary_unlock_finishes_an_interrupted_lock_in_every_tree() {
        let root = temp_forge("pair-same-temporary");
        for (filename, is_daily, is_weekly) in PAIR_NOTES {
            let body = format!("# {filename}\n\nsame body");
            let (original, locked) =
                interrupted_pair(&root, filename, is_daily, is_weekly, &body, body.as_bytes());
            let ciphertext = fs::read(&locked).unwrap();
            let before = snapshot(&root);

            let unlocked = unlock_pair(&root, filename, is_daily, is_weekly);

            assert_eq!(unlocked.content, body, "{filename}");
            assert_eq!(unlocked.conflict_copy, None, "{filename}");
            assert!(unlocked.settled_twin, "{filename}");
            assert!(!original.exists(), "{filename}: plaintext twin kept");
            assert_eq!(fs::read(&locked).unwrap(), ciphertext, "{filename}");
            assert_eq!(snapshot(&root).len(), before.len() - 1, "{filename}");
        }
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn regression_173_permanent_unlock_of_an_interrupted_pair_is_not_already_unlocked() {
        let root = temp_forge("pair-same-permanent");
        for (filename, is_daily, is_weekly) in PAIR_NOTES {
            let body = format!("# {filename}\n\nsame body");
            let (original, locked) =
                interrupted_pair(&root, filename, is_daily, is_weekly, &body, body.as_bytes());
            let before = snapshot(&root);

            let copy = permanently_unlock_pair(&root, filename, is_daily, is_weekly).unwrap();

            assert_eq!(copy, None, "{filename}");
            assert_eq!(fs::read_to_string(&original).unwrap(), body, "{filename}");
            assert!(!locked.exists(), "{filename}: ciphertext kept");
            assert_eq!(snapshot(&root).len(), before.len() - 1, "{filename}");
        }
        fs::remove_dir_all(root).unwrap();
    }

    fn assert_conflict_copy_holds(root: &Path, kind: (bool, bool), copy: &str, plain: &[u8]) {
        let dir = note_dir(root, kind.0, kind.1);
        assert!(copy.contains(" (conflict "), "{copy}");
        assert_eq!(fs::read(dir.join(copy)).unwrap(), plain, "{copy}");
    }

    #[test]
    fn regression_173_temporary_unlock_keeps_a_differing_plaintext_as_a_conflict_copy() {
        let root = temp_forge("pair-differ-temporary");
        for (filename, is_daily, is_weekly) in PAIR_NOTES {
            let plain = format!("---\ncolor: blue\n---\n# {filename}\n\nedited after the crash");
            let (original, locked) = interrupted_pair(
                &root,
                filename,
                is_daily,
                is_weekly,
                "locked body",
                plain.as_bytes(),
            );
            let ciphertext = fs::read(&locked).unwrap();
            let before = snapshot(&root);

            let unlocked = unlock_pair(&root, filename, is_daily, is_weekly);

            assert_eq!(unlocked.content, "locked body", "{filename}");
            let copy = unlocked.conflict_copy.expect("a conflict copy");
            if let Some((folder, _)) = filename.rsplit_once('/') {
                assert!(copy.starts_with(&format!("{folder}/")), "{copy}");
            }
            assert_conflict_copy_holds(&root, (is_daily, is_weekly), &copy, plain.as_bytes());
            assert!(!original.exists(), "{filename}: plaintext twin kept");
            assert_eq!(fs::read(&locked).unwrap(), ciphertext, "{filename}");
            assert_eq!(snapshot(&root).len(), before.len(), "{filename}");
        }
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn regression_173_permanent_unlock_keeps_a_differing_plaintext_as_a_conflict_copy() {
        let root = temp_forge("pair-differ-permanent");
        for (filename, is_daily, is_weekly) in PAIR_NOTES {
            let plain = format!("# {filename}\n\nedited after the crash");
            let (original, locked) = interrupted_pair(
                &root,
                filename,
                is_daily,
                is_weekly,
                "locked body",
                plain.as_bytes(),
            );
            let before = snapshot(&root);

            let copy = permanently_unlock_pair(&root, filename, is_daily, is_weekly)
                .unwrap()
                .expect("a conflict copy");

            assert_conflict_copy_holds(&root, (is_daily, is_weekly), &copy, plain.as_bytes());
            assert_eq!(
                fs::read_to_string(&original).unwrap(),
                "locked body",
                "{filename}"
            );
            assert!(!locked.exists(), "{filename}: ciphertext kept");
            assert_eq!(snapshot(&root).len(), before.len(), "{filename}");
        }
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn regression_173_an_empty_plaintext_twin_is_kept_unless_the_note_is_empty_too() {
        let root = temp_forge("pair-empty");
        let (original, _) = interrupted_pair(&root, "Empty.md", false, false, "body", b"");
        let unlocked = unlock_pair(&root, "Empty.md", false, false);
        assert_eq!(unlocked.content, "body");
        assert_conflict_copy_holds(&root, (false, false), &unlocked.conflict_copy.unwrap(), b"");
        assert!(!original.exists());

        let (original, locked) = interrupted_pair(&root, "Blank.md", false, false, "", b"");
        let unlocked = unlock_pair(&root, "Blank.md", false, false);
        assert_eq!(unlocked.content, "");
        assert_eq!(unlocked.conflict_copy, None);
        assert!(!original.exists());
        assert!(locked.is_file());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn regression_173_a_wrong_password_leaves_the_pair_untouched() {
        let root = temp_forge("pair-wrong-password");
        interrupted_pair(&root, "Pair.md", false, false, "locked", b"plain");
        let before = snapshot(&root);
        let index = BacklinksIndex::new();

        let temporary = unlock_note_in(
            &root,
            "Pair.md".into(),
            "wrong".into(),
            false,
            false,
            &index,
        );
        assert!(temporary.unwrap_err().contains("password"));
        assert_eq!(snapshot(&root), before);

        let permanent = permanently_unlock_note_in(
            &root,
            "Pair.md".into(),
            "wrong".into(),
            false,
            false,
            &index,
            Some(&resolver),
        );
        assert!(permanent.unwrap_err().contains("password"));
        assert_eq!(snapshot(&root), before);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn regression_173_a_corrupt_or_truncated_locked_twin_never_costs_the_plaintext() {
        let root = temp_forge("pair-corrupt");
        let (_, locked) = interrupted_pair(&root, "Cut.md", false, false, "locked", b"plain");
        let ciphertext = fs::read(&locked).unwrap();
        fs::write(&locked, &ciphertext[..ciphertext.len() / 2]).unwrap();
        let (_, garbled) = interrupted_pair(&root, "Garbled.md", true, false, "x", b"plain");
        fs::write(&garbled, "v3$not a ciphertext").unwrap();
        let before = snapshot(&root);

        assert!(unlock_note_in(
            &root,
            "Garbled.md".into(),
            PAIR_PASSWORD.into(),
            true,
            false,
            &BacklinksIndex::new(),
        )
        .is_err());
        assert!(permanently_unlock_pair(&root, "Cut.md", false, false).is_err());
        assert_eq!(snapshot(&root), before);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn regression_173_a_settled_note_locks_and_unlocks_again() {
        let root = temp_forge("pair-relock");
        let (original, locked) =
            interrupted_pair(&root, "Projects/Again.md", false, false, "body", b"body");
        assert!(unlock_pair(&root, "Projects/Again.md", false, false).settled_twin);
        assert_eq!(
            permanently_unlock_pair(&root, "Projects/Again.md", false, false),
            Ok(None)
        );
        assert_eq!(fs::read_to_string(&original).unwrap(), "body");
        lock_note_in(
            &root,
            "Projects/Again.md".into(),
            PAIR_PASSWORD.into(),
            false,
            false,
            &BacklinksIndex::new(),
        )
        .unwrap();
        assert!(!original.exists());
        let unlocked = unlock_pair(&root, "Projects/Again.md", false, false);
        assert_eq!(unlocked.content, "body");
        assert!(!unlocked.settled_twin);
        assert!(locked.is_file());
        fs::remove_dir_all(root).unwrap();
    }

    #[cfg(any(target_os = "macos", target_os = "ios"))]
    #[test]
    fn pending_lock_source_is_never_treated_as_missing_plaintext() {
        let root = temp_forge("pending-lock");
        let marker = root.join("notes/.pending.md.icloud");
        fs::write(&marker, "remote metadata").unwrap();
        let result = lock_note_in(
            &root,
            "pending.md".into(),
            "password".into(),
            false,
            false,
            &BacklinksIndex::new(),
        );
        assert!(result.unwrap_err().contains("download"));
        assert!(marker.exists());
        assert!(!root.join("notes/pending.md.locked").exists());
        fs::remove_dir_all(root).unwrap();
    }
}

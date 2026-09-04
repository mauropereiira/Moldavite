//! Archive, encrypted-backup, and settings import/export commands.
//!
//! Archive entries and user-selected destinations are untrusted: imports reject
//! traversal and symlinks before extraction, exports exclude internal state,
//! and all restored user files receive restrictive permissions. Encrypted
//! backups wrap the archive as one authenticated payload and keep passwords and
//! plaintext buffers in zeroizing containers where possible.

use std::fs;
use std::io::{Read as IoRead, Seek, Write as IoWrite};
use std::path::Path;
use std::path::PathBuf;
use walkdir::WalkDir;
use zeroize::Zeroizing;
use zip::write::SimpleFileOptions;
use zip::ZipArchive;

use crate::encryption;
use crate::paths::get_notes_dir;
use crate::types::ImportResult;
use crate::validation::{
    has_safe_relative_path_syntax, validate_path_within_base, validate_user_export_path,
};

// Zip-bomb / malicious archive guardrails. Chosen to comfortably cover a
// very large real vault (tens of thousands of notes + images) while still
// rejecting pathological archives that would exhaust disk or memory.
const MAX_ARCHIVE_ENTRIES: usize = 50_000;
const MAX_ENTRY_UNCOMPRESSED_SIZE: u64 = 100 * 1024 * 1024; // 100 MB per file
const MAX_TOTAL_UNCOMPRESSED_SIZE: u64 = 2 * 1024 * 1024 * 1024; // 2 GB total

/// Basic structure validation for a single ZIP entry name — rejects empty
/// names, absolute paths, drive letters, NUL bytes, and backslash separators
/// (which some Windows-created ZIPs use and that our `parts.len() != 2` split
/// on `/` would silently accept).
fn is_acceptable_entry_name(name: &str) -> bool {
    has_safe_relative_path_syntax(name)
}

fn validated_archive_destination(notes_dir: &Path, name: &str) -> Option<(String, PathBuf)> {
    if !is_acceptable_entry_name(name) || name.ends_with('/') {
        return None;
    }
    let (subdir, rest) = name.split_once('/')?;
    if !["daily", "notes", "templates", "weekly", "images"].contains(&subdir)
        || !crate::validation::is_safe_note_path(rest)
    {
        return None;
    }
    let destination = notes_dir.join(subdir).join(rest);
    Some((subdir.to_string(), destination))
}

fn ensure_import_parent(notes_dir: &Path, destination: &Path) -> Result<(), String> {
    let parent = destination
        .parent()
        .ok_or_else(|| "Invalid archive destination".to_string())?;
    let relative = parent
        .strip_prefix(notes_dir)
        .map_err(|_| "Archive destination escapes the Forge".to_string())?;
    let mut current = notes_dir.to_path_buf();
    for component in relative.components() {
        current.push(component);
        if current.exists() {
            let metadata = fs::symlink_metadata(&current)
                .map_err(|e| format!("Failed to inspect import directory: {e}"))?;
            if metadata.file_type().is_symlink() || !metadata.is_dir() {
                return Err("Archive destination contains an unsafe directory".to_string());
            }
        } else {
            fs::create_dir(&current)
                .map_err(|e| format!("Failed to create import directory: {e}"))?;
        }
    }
    validate_path_within_base(destination, notes_dir)
}

fn add_archive_tree<W: IoWrite + Seek>(
    zip: &mut zip::ZipWriter<W>,
    notes_dir: &Path,
    subdir: &str,
    options: SimpleFileOptions,
) -> Result<(), String> {
    let root = notes_dir.join(subdir);
    if !root.is_dir() {
        return Ok(());
    }
    for entry in WalkDir::new(&root)
        .follow_links(false)
        .into_iter()
        .filter_entry(|entry| {
            entry.depth() == 0 || !entry.file_name().to_string_lossy().starts_with('.')
        })
        .flatten()
    {
        if !entry.file_type().is_file() {
            continue;
        }
        let relative = entry
            .path()
            .strip_prefix(notes_dir)
            .map_err(|_| "Failed to compute archive path".to_string())?;
        let archive_path = relative.to_string_lossy().replace('\\', "/");
        zip.start_file(&archive_path, options)
            .map_err(|e| format!("Failed to add file to ZIP: {e}"))?;
        let mut source = fs::File::open(entry.path())
            .map_err(|e| format!("Failed to read archive source: {e}"))?;
        std::io::copy(&mut source, zip)
            .map_err(|e| format!("Failed to write file content: {e}"))?;
    }
    Ok(())
}

fn preflight_archive<R: IoRead + Seek>(
    archive: &mut ZipArchive<R>,
    notes_dir: &Path,
    label: &str,
) -> Result<(), String> {
    if archive.len() > MAX_ARCHIVE_ENTRIES {
        return Err(format!(
            "{label} has too many entries ({}); maximum is {}",
            archive.len(),
            MAX_ARCHIVE_ENTRIES
        ));
    }
    let mut total_uncompressed = 0_u64;
    for index in 0..archive.len() {
        let file = archive
            .by_index(index)
            .map_err(|e| format!("Failed to inspect {label} entry: {e}"))?;
        let name = file.name();
        if name.ends_with('/') {
            continue;
        }
        if validated_archive_destination(notes_dir, name).is_none() {
            return Err(format!("{label} contains unsafe entry path '{name}'"));
        }
        if file.size() > MAX_ENTRY_UNCOMPRESSED_SIZE {
            return Err(format!(
                "{label} entry '{name}' exceeds per-file size limit"
            ));
        }
        total_uncompressed = total_uncompressed.saturating_add(file.size());
        if total_uncompressed > MAX_TOTAL_UNCOMPRESSED_SIZE {
            return Err(format!("{label} total uncompressed size exceeds limit"));
        }
    }
    Ok(())
}

fn empty_import_result() -> ImportResult {
    ImportResult {
        daily_notes: 0,
        standalone_notes: 0,
        templates: 0,
        images: 0,
    }
}

fn extract_archive<R: IoRead + Seek>(
    archive: &mut ZipArchive<R>,
    destination_root: &Path,
    label: &str,
    merge: bool,
) -> Result<ImportResult, String> {
    let mut result = empty_import_result();
    let mut total_uncompressed = 0_u64;

    for index in 0..archive.len() {
        let mut file = archive
            .by_index(index)
            .map_err(|e| format!("Failed to read {label} entry: {e}"))?;
        let name = file.name().to_string();
        if name.ends_with('/') {
            continue;
        }

        let Some((subdir, destination)) = validated_archive_destination(destination_root, &name)
        else {
            return Err(format!("{label} contains unsafe entry path '{name}'"));
        };
        if file.size() > MAX_ENTRY_UNCOMPRESSED_SIZE {
            return Err(format!(
                "{label} entry '{name}' exceeds per-file size limit"
            ));
        }
        total_uncompressed = total_uncompressed.saturating_add(file.size());
        if total_uncompressed > MAX_TOTAL_UNCOMPRESSED_SIZE {
            return Err(format!("{label} total uncompressed size exceeds limit"));
        }

        ensure_import_parent(destination_root, &destination)?;
        if merge && destination.exists() {
            continue;
        }

        let mut content = Vec::new();
        (&mut file)
            .take(MAX_ENTRY_UNCOMPRESSED_SIZE + 1)
            .read_to_end(&mut content)
            .map_err(|e| format!("Failed to read file from {label}: {e}"))?;
        if content.len() as u64 > MAX_ENTRY_UNCOMPRESSED_SIZE {
            return Err(format!(
                "{label} entry '{name}' exceeds per-file size limit"
            ));
        }
        crate::persist::write_atomic(&destination, &content, Some(0o600))
            .map_err(|e| format!("Failed to write imported file: {e}"))?;

        match subdir.as_str() {
            "daily" | "weekly" => result.daily_notes += 1,
            "notes" => result.standalone_notes += 1,
            "templates" => result.templates += 1,
            "images" => result.images += 1,
            _ => {}
        }
    }

    Ok(result)
}

fn create_import_staging_dir(notes_dir: &Path) -> Result<PathBuf, String> {
    let parent = notes_dir
        .parent()
        .ok_or_else(|| "Forge has no parent directory".to_string())?;
    let forge_name = notes_dir
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("forge");

    for _ in 0..32 {
        let suffix = rand::RngCore::next_u64(&mut rand::rngs::OsRng);
        let path = parent.join(format!(".{forge_name}.moldavite-import-{suffix:016x}.tmp"));
        // Only the Unix branch mutates this, so on Windows `mut` is unused and
        // `-D warnings` fails the build there. Windows inherits the parent
        // directory's ACL, which is the equivalent protection.
        #[cfg_attr(not(unix), allow(unused_mut))]
        let mut builder = fs::DirBuilder::new();
        #[cfg(unix)]
        {
            use std::os::unix::fs::DirBuilderExt;
            builder.mode(0o700);
        }
        match builder.create(&path) {
            Ok(()) => return Ok(path),
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(error) => {
                return Err(format!(
                    "Failed to create import staging directory: {error}"
                ))
            }
        }
    }

    Err("Failed to reserve an import staging directory".to_string())
}

fn apply_staged_templates(staging_root: &Path, notes_dir: &Path) -> Result<(), String> {
    let source = staging_root.join("templates");
    if !source.is_dir() {
        return Ok(());
    }

    for entry in WalkDir::new(&source).follow_links(false).into_iter() {
        let entry = entry.map_err(|e| format!("Failed to inspect staged template: {e}"))?;
        if entry.file_type().is_symlink() {
            return Err("Staged template contains a symlink".to_string());
        }
        if !entry.file_type().is_file() {
            continue;
        }
        let relative = entry
            .path()
            .strip_prefix(&source)
            .map_err(|_| "Failed to resolve staged template path".to_string())?;
        let destination = notes_dir.join("templates").join(relative);
        ensure_import_parent(notes_dir, &destination)?;
        let content =
            fs::read(entry.path()).map_err(|e| format!("Failed to read staged template: {e}"))?;
        crate::persist::write_atomic(&destination, &content, Some(0o600))
            .map_err(|e| format!("Failed to install staged template: {e}"))?;
    }
    Ok(())
}

fn rollback_swapped_subdirs(notes_dir: &Path, staging_root: &Path, swapped: &[&str]) {
    let rollback_root = staging_root.join(".rollback");
    for subdir in swapped.iter().rev() {
        let live = notes_dir.join(subdir);
        let staged = staging_root.join(subdir);
        let backup = rollback_root.join(subdir);
        if fs::rename(&live, &staged).is_err() {
            let _ = fs::remove_dir_all(&live);
        }
        let _ = fs::rename(&backup, &live);
    }
}

fn swap_import_subdirs(notes_dir: &Path, staging_root: &Path) -> Result<(), String> {
    const REPLACED_SUBDIRS: [&str; 4] = ["daily", "weekly", "notes", "images"];
    let rollback_root = staging_root.join(".rollback");
    fs::create_dir(&rollback_root)
        .map_err(|e| format!("Failed to prepare import rollback directory: {e}"))?;

    for subdir in REPLACED_SUBDIRS {
        let live = notes_dir.join(subdir);
        let staged = staging_root.join(subdir);
        fs::create_dir_all(&staged)
            .map_err(|e| format!("Failed to prepare staged {subdir}: {e}"))?;
        if !live.exists() {
            fs::create_dir_all(&live)
                .map_err(|e| format!("Failed to prepare live {subdir}: {e}"))?;
        }
        validate_path_within_base(&live, notes_dir)
            .map_err(|_| format!("Live {subdir} directory is unsafe"))?;
        validate_path_within_base(&staged, staging_root)
            .map_err(|_| format!("Staged {subdir} directory is unsafe"))?;
        if !live.is_dir() || !staged.is_dir() {
            return Err(format!("Import {subdir} path is not a directory"));
        }
    }

    let mut swapped = Vec::new();
    for subdir in REPLACED_SUBDIRS {
        let live = notes_dir.join(subdir);
        let staged = staging_root.join(subdir);
        let backup = rollback_root.join(subdir);
        if let Err(error) = fs::rename(&live, &backup) {
            rollback_swapped_subdirs(notes_dir, staging_root, &swapped);
            return Err(format!(
                "Failed to stage existing {subdir} for replacement: {error}"
            ));
        }
        if let Err(error) = fs::rename(&staged, &live) {
            let _ = fs::rename(&backup, &live);
            rollback_swapped_subdirs(notes_dir, staging_root, &swapped);
            return Err(format!("Failed to publish imported {subdir}: {error}"));
        }
        swapped.push(subdir);
    }
    Ok(())
}

fn replace_from_archive<R: IoRead + Seek>(
    archive: &mut ZipArchive<R>,
    notes_dir: &Path,
    label: &str,
) -> Result<ImportResult, String> {
    let staging_root = create_import_staging_dir(notes_dir)?;
    let imported = match (|| {
        let imported = extract_archive(archive, &staging_root, label, false)?;
        apply_staged_templates(&staging_root, notes_dir)?;
        Ok(imported)
    })() {
        Ok(imported) => imported,
        Err(error) => {
            let _ = fs::remove_dir_all(&staging_root);
            return Err(error);
        }
    };

    if let Err(error) = swap_import_subdirs(notes_dir, &staging_root) {
        return Err(format!(
            "{error}; staged recovery data was retained for safety"
        ));
    }
    fs::remove_dir_all(&staging_root)
        .map_err(|e| format!("Import completed but failed to remove staged old data: {e}"))?;
    Ok(imported)
}

/// Export all notes and templates to a ZIP file
#[tauri::command]
pub(crate) fn export_notes(destination: String) -> Result<String, String> {
    let notes_dir = get_notes_dir();
    let zip_path = PathBuf::from(&destination);

    export_notes_to(&notes_dir, &zip_path)?;
    Ok(zip_path.to_string_lossy().to_string())
}

fn export_notes_to(notes_dir: &Path, zip_path: &Path) -> Result<(), String> {
    validate_user_export_path(zip_path, "zip")?;
    export_notes_from(notes_dir, zip_path)
}

fn export_notes_from(notes_dir: &Path, zip_path: &Path) -> Result<(), String> {
    crate::persist::write_atomic_with(zip_path, Some(0o600), |file| {
        let mut zip = zip::ZipWriter::new(file);
        let options = SimpleFileOptions::default()
            .compression_method(zip::CompressionMethod::Deflated)
            .unix_permissions(0o600);

        for subdir in ["daily", "weekly", "notes", "templates", "images"] {
            add_archive_tree(&mut zip, notes_dir, subdir, options)?;
        }
        zip.finish()
            .map_err(|e| format!("Failed to finalize ZIP: {e}"))?;
        Ok(())
    })
    .map_err(|e| format!("Failed to create ZIP file: {e}"))
}

/// Import notes and templates from a ZIP file
#[tauri::command]
pub(crate) fn import_notes(zip_path: String, merge: bool) -> Result<ImportResult, String> {
    let notes_dir = get_notes_dir();
    import_notes_into(&notes_dir, Path::new(&zip_path), merge)
}

fn import_notes_into(
    notes_dir: &Path,
    zip_path: &Path,
    merge: bool,
) -> Result<ImportResult, String> {
    let zip_file =
        fs::File::open(zip_path).map_err(|e| format!("Failed to open ZIP file: {}", e))?;
    let mut archive =
        ZipArchive::new(zip_file).map_err(|e| format!("Failed to read ZIP archive: {}", e))?;

    preflight_archive(&mut archive, notes_dir, "Archive")?;
    if merge {
        extract_archive(&mut archive, notes_dir, "Archive", true)
    } else {
        replace_from_archive(&mut archive, notes_dir, "Archive")
    }
}

/// Export all notes and templates to an encrypted backup file
#[tauri::command]
pub(crate) fn export_encrypted_backup(
    destination: String,
    password: String,
) -> Result<String, String> {
    let password = Zeroizing::new(password);
    let notes_dir = get_notes_dir();
    let backup_path = PathBuf::from(&destination);
    export_encrypted_backup_to(&notes_dir, &backup_path, &password)?;
    Ok(backup_path.to_string_lossy().to_string())
}

fn export_encrypted_backup_to(
    notes_dir: &Path,
    backup_path: &Path,
    password: &str,
) -> Result<(), String> {
    validate_user_export_path(backup_path, "moldavite-backup")?;
    export_encrypted_backup_from(notes_dir, backup_path, password)
}

fn export_encrypted_backup_from(
    notes_dir: &Path,
    backup_path: &Path,
    password: &str,
) -> Result<(), String> {
    use std::io::Cursor;

    // Create ZIP in memory
    let mut zip_buffer = Cursor::new(Vec::new());
    {
        let mut zip = zip::ZipWriter::new(&mut zip_buffer);
        let options = SimpleFileOptions::default()
            .compression_method(zip::CompressionMethod::Deflated)
            .unix_permissions(0o600);

        for subdir in ["daily", "notes", "templates", "weekly", "images"] {
            add_archive_tree(&mut zip, notes_dir, subdir, options)?;
        }

        zip.finish()
            .map_err(|e| format!("Failed to finalize ZIP: {}", e))?;
    }

    // Get the ZIP data
    let zip_data = zip_buffer.into_inner();

    // Encrypt the ZIP data using our encryption module
    let zip_b64 = base64::Engine::encode(&base64::engine::general_purpose::STANDARD, &zip_data);
    let encrypted = encryption::encrypt_content(&zip_b64, password)?;

    // Add a header to identify encrypted backups
    let backup_content = format!("MOLDAVITE_ENCRYPTED_BACKUP_V1\n{}", encrypted);

    // Write to destination
    crate::persist::write_atomic(backup_path, backup_content.as_bytes(), Some(0o600))
        .map_err(|e| format!("Failed to write backup file: {}", e))?;
    Ok(())
}

/// Import notes and templates from an encrypted backup file
#[tauri::command]
pub(crate) fn import_encrypted_backup(
    backup_path: String,
    password: String,
    merge: bool,
) -> Result<ImportResult, String> {
    let password = Zeroizing::new(password);
    let notes_dir = get_notes_dir();
    import_encrypted_backup_into(&notes_dir, Path::new(&backup_path), &password, merge)
}

fn import_encrypted_backup_into(
    notes_dir: &Path,
    backup_path: &Path,
    password: &str,
    merge: bool,
) -> Result<ImportResult, String> {
    use std::io::Cursor;

    // Read the backup file
    let backup_content = fs::read_to_string(backup_path)
        .map_err(|e| format!("Failed to read backup file: {}", e))?;

    // Verify header and extract encrypted data
    let lines: Vec<&str> = backup_content.splitn(2, '\n').collect();
    if lines.len() != 2 || lines[0] != "MOLDAVITE_ENCRYPTED_BACKUP_V1" {
        return Err("Invalid backup file format".to_string());
    }
    let encrypted = lines[1];

    // Decrypt the data
    let zip_b64 = encryption::decrypt_content(encrypted, password)?;

    // Decode base64 to get ZIP data
    let zip_data = base64::Engine::decode(&base64::engine::general_purpose::STANDARD, &zip_b64)
        .map_err(|e| format!("Failed to decode backup data: {}", e))?;

    // Open the ZIP archive from memory
    let cursor = Cursor::new(zip_data);
    let mut archive =
        ZipArchive::new(cursor).map_err(|e| format!("Failed to read backup archive: {}", e))?;

    preflight_archive(&mut archive, notes_dir, "Backup")?;
    if merge {
        extract_archive(&mut archive, notes_dir, "Backup", true)
    } else {
        replace_from_archive(&mut archive, notes_dir, "Backup")
    }
}

/// Write a settings JSON file to a user-chosen path.
#[tauri::command]
pub(crate) fn export_settings_json(path: String, json: String) -> Result<(), String> {
    let file_path = Path::new(&path);
    validate_user_export_path(file_path, "json")?;

    // Reject oversized payloads (settings JSON should be tiny).
    if json.len() > 2 * 1024 * 1024 {
        return Err("Settings JSON too large".to_string());
    }

    crate::persist::write_atomic(file_path, json.as_bytes(), Some(0o600))
}

/// Read a settings JSON file from a user-chosen path.
#[tauri::command]
pub(crate) fn import_settings_json(path: String) -> Result<String, String> {
    let file_path = Path::new(&path);
    if !file_path.is_absolute() {
        return Err("Path must be absolute".to_string());
    }
    let ext_ok = file_path
        .extension()
        .and_then(|s| s.to_str())
        .is_some_and(|e| e.eq_ignore_ascii_case("json"));
    if !ext_ok {
        return Err("Only .json files may be read via this command".to_string());
    }
    // Reject symlinks.
    let meta = fs::symlink_metadata(file_path).map_err(|e| e.to_string())?;
    if meta.file_type().is_symlink() {
        return Err("Refusing to read a symlinked file".to_string());
    }
    if meta.len() > 2 * 1024 * 1024 {
        return Err("Settings JSON too large".to_string());
    }
    fs::read_to_string(file_path).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    use std::time::Instant;

    struct TempDir(PathBuf);

    impl TempDir {
        fn new(tag: &str) -> Self {
            let path = std::env::temp_dir().join(format!(
                "moldavite-archive-{tag}-{}-{}",
                std::process::id(),
                std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .unwrap()
                    .as_nanos()
            ));
            fs::create_dir_all(&path).unwrap();
            Self(path)
        }
    }

    impl Drop for TempDir {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    struct ExportTempDir(PathBuf);

    impl ExportTempDir {
        fn new(tag: &str) -> Self {
            let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                .join("target")
                .join(format!(
                    "moldavite-export-{tag}-{}-{}",
                    std::process::id(),
                    std::time::SystemTime::now()
                        .duration_since(std::time::UNIX_EPOCH)
                        .unwrap()
                        .as_nanos()
                ));
            fs::create_dir_all(&path).unwrap();
            Self(path)
        }
    }

    impl Drop for ExportTempDir {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    fn scaffold(path: &Path) {
        for subdir in ["daily", "weekly", "notes", "templates", "images"] {
            fs::create_dir_all(path.join(subdir)).unwrap();
        }
    }

    #[test]
    fn export_notes_rejects_unsafe_destination_and_creates_private_archive() {
        let tmp = ExportTempDir::new("zip-validation");
        let source = tmp.0.join("source");
        scaffold(&source);
        fs::write(source.join("notes/note.md"), "private note").unwrap();

        assert!(export_notes_to(&source, Path::new("relative.zip")).is_err());
        assert!(!Path::new("relative.zip").exists());

        let archive = tmp.0.join("vault.zip");
        export_notes_to(&source, &archive).unwrap();
        assert!(archive.is_file());
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(
                fs::metadata(&archive).unwrap().permissions().mode() & 0o777,
                0o600
            );
        }
    }

    #[test]
    fn encrypted_backup_rejects_unsafe_destination_and_accepts_valid_backup_path() {
        let tmp = ExportTempDir::new("encrypted-validation");
        let source = tmp.0.join("source");
        scaffold(&source);
        fs::write(source.join("notes/note.md"), "private note").unwrap();

        assert!(export_encrypted_backup_to(
            &source,
            Path::new("relative.moldavite-backup"),
            "password"
        )
        .is_err());

        let backup = tmp.0.join("vault.moldavite-backup");
        export_encrypted_backup_to(&source, &backup, "password").unwrap();
        assert!(backup.is_file());
    }

    #[test]
    fn stress_zip_round_trip_preserves_500_notes_nested_weekly_and_assets() {
        let tmp = TempDir::new("roundtrip-500");
        let source = tmp.0.join("source");
        let restored = tmp.0.join("restored");
        scaffold(&source);
        scaffold(&restored);
        for i in 0..500 {
            let folder = source.join("notes").join(format!("group-{}", i % 10));
            fs::create_dir_all(&folder).unwrap();
            fs::write(
                folder.join(format!("note-{i}.md")),
                format!("body {i} 日本語"),
            )
            .unwrap();
        }
        fs::write(source.join("weekly/2020-W53.md"), "week 53").unwrap();
        fs::write(source.join("templates/large.json"), "template").unwrap();
        fs::write(source.join("images/pixel.bin"), [0_u8, 1, 2, 3]).unwrap();
        let archive = tmp.0.join("vault.zip");

        let started = Instant::now();
        export_notes_from(&source, &archive).unwrap();
        let result = import_notes_into(&restored, &archive, false).unwrap();
        let elapsed = started.elapsed();
        assert_eq!(result.standalone_notes, 500);
        assert_eq!(result.daily_notes, 1);
        assert_eq!(result.templates, 1);
        assert_eq!(result.images, 1);
        for i in 0..500 {
            assert_eq!(
                fs::read_to_string(
                    restored
                        .join("notes")
                        .join(format!("group-{}", i % 10))
                        .join(format!("note-{i}.md"))
                )
                .unwrap(),
                format!("body {i} 日本語")
            );
        }
        assert_eq!(
            fs::read_to_string(restored.join("weekly/2020-W53.md")).unwrap(),
            "week 53"
        );
        eprintln!("[stress] 500-note ZIP round trip took {elapsed:?}");
        assert!(
            elapsed.as_secs() < crate::stress_test::REGRESSION_BUDGET_SECS,
            "ZIP round trip took {elapsed:?}"
        );
    }

    #[test]
    fn encrypted_backup_round_trip_rejects_wrong_password() {
        let tmp = TempDir::new("encrypted");
        let source = tmp.0.join("source");
        let restored = tmp.0.join("restored");
        scaffold(&source);
        scaffold(&restored);
        fs::create_dir_all(source.join("notes/Nested")).unwrap();
        fs::write(source.join("notes/Nested/secret.md"), "private body").unwrap();
        let backup = tmp.0.join("vault.moldavite-backup");
        export_encrypted_backup_from(&source, &backup, "correct horse battery staple").unwrap();
        let wrong =
            import_encrypted_backup_into(&restored, &backup, "wrong password", false).unwrap_err();
        assert!(wrong.contains("wrong password or corrupted data"));
        let result =
            import_encrypted_backup_into(&restored, &backup, "correct horse battery staple", false)
                .unwrap();
        assert_eq!(result.standalone_notes, 1);
        assert_eq!(
            fs::read_to_string(restored.join("notes/Nested/secret.md")).unwrap(),
            "private body"
        );
    }

    fn write_zip(path: &Path, names: impl IntoIterator<Item = String>) {
        let file = fs::File::create(path).unwrap();
        let mut zip = zip::ZipWriter::new(file);
        let options =
            SimpleFileOptions::default().compression_method(zip::CompressionMethod::Stored);
        for name in names {
            zip.start_file(name, options).unwrap();
            zip.write_all(b"x").unwrap();
        }
        zip.finish().unwrap();
    }

    #[test]
    fn malicious_zip_traversal_is_rejected_with_actionable_error() {
        let tmp = TempDir::new("traversal");
        let destination = tmp.0.join("destination");
        scaffold(&destination);
        fs::write(
            destination.join("notes/keep.md"),
            "must survive failed import",
        )
        .unwrap();
        let archive = tmp.0.join("malicious.zip");
        write_zip(&archive, ["notes/../../escaped.md".to_string()]);
        let error = import_notes_into(&destination, &archive, false).unwrap_err();
        assert!(error.contains("unsafe entry path"));
        assert!(error.contains("../../escaped.md"));
        assert!(!tmp.0.join("escaped.md").exists());
        assert_eq!(
            fs::read_to_string(destination.join("notes/keep.md")).unwrap(),
            "must survive failed import"
        );
    }

    #[test]
    fn security_regression_replace_import_keeps_live_notes_when_late_entry_is_corrupt() {
        const CORRUPT_PAYLOAD: &[u8] = b"uniquely-corrupt-late-entry-payload";

        let tmp = TempDir::new("late-corruption");
        let destination = tmp.0.join("destination");
        scaffold(&destination);
        fs::write(destination.join("notes/keep.md"), "must survive").unwrap();
        let archive_path = tmp.0.join("corrupt-late-entry.zip");
        {
            let file = fs::File::create(&archive_path).unwrap();
            let mut zip = zip::ZipWriter::new(file);
            let options =
                SimpleFileOptions::default().compression_method(zip::CompressionMethod::Stored);
            zip.start_file("notes/valid-first.md", options).unwrap();
            zip.write_all(b"valid first entry").unwrap();
            zip.start_file("notes/corrupt-late.md", options).unwrap();
            zip.write_all(CORRUPT_PAYLOAD).unwrap();
            zip.finish().unwrap();
        }
        let mut bytes = fs::read(&archive_path).unwrap();
        let payload_start = bytes
            .windows(CORRUPT_PAYLOAD.len())
            .position(|window| window == CORRUPT_PAYLOAD)
            .unwrap();
        bytes[payload_start] ^= 0xff;
        fs::write(&archive_path, bytes).unwrap();

        assert!(import_notes_into(&destination, &archive_path, false).is_err());
        assert_eq!(
            fs::read_to_string(destination.join("notes/keep.md")).unwrap(),
            "must survive"
        );
        assert!(!destination.join("notes/valid-first.md").exists());
    }

    #[test]
    fn replace_import_swaps_note_trees_but_preserves_unmentioned_templates() {
        let tmp = TempDir::new("replace-compatibility");
        let destination = tmp.0.join("destination");
        scaffold(&destination);
        fs::write(destination.join("notes/old.md"), "old note").unwrap();
        fs::write(
            destination.join("templates/existing.json"),
            "existing template",
        )
        .unwrap();
        let archive_path = tmp.0.join("replacement.zip");
        {
            let file = fs::File::create(&archive_path).unwrap();
            let mut zip = zip::ZipWriter::new(file);
            let options =
                SimpleFileOptions::default().compression_method(zip::CompressionMethod::Stored);
            zip.start_file("notes/new.md", options).unwrap();
            zip.write_all(b"new note").unwrap();
            zip.start_file("templates/imported.json", options).unwrap();
            zip.write_all(b"imported template").unwrap();
            zip.finish().unwrap();
        }

        let result = import_notes_into(&destination, &archive_path, false).unwrap();

        assert_eq!(result.standalone_notes, 1);
        assert_eq!(result.templates, 1);
        assert!(!destination.join("notes/old.md").exists());
        assert_eq!(
            fs::read_to_string(destination.join("notes/new.md")).unwrap(),
            "new note"
        );
        assert_eq!(
            fs::read_to_string(destination.join("templates/existing.json")).unwrap(),
            "existing template"
        );
        assert_eq!(
            fs::read_to_string(destination.join("templates/imported.json")).unwrap(),
            "imported template"
        );
    }

    #[test]
    fn malicious_zip_entry_count_limit_fails_before_extraction() {
        let tmp = TempDir::new("entry-limit");
        let destination = tmp.0.join("destination");
        scaffold(&destination);
        let archive = tmp.0.join("too-many.zip");
        write_zip(
            &archive,
            (0..=MAX_ARCHIVE_ENTRIES).map(|i| format!("notes/entry-{i}.md")),
        );
        let error = import_notes_into(&destination, &archive, true).unwrap_err();
        assert!(error.contains("too many entries"));
        assert!(error.contains(&MAX_ARCHIVE_ENTRIES.to_string()));
        assert_eq!(fs::read_dir(destination.join("notes")).unwrap().count(), 0);
    }
}

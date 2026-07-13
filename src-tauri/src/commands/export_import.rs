//! Export / import commands (ZIP, encrypted backup, settings JSON).

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
use crate::validation::{validate_path_within_base, validate_user_export_path};

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
    if name.is_empty() || name.contains('\0') || name.contains('\\') {
        return false;
    }
    if name.starts_with('/') {
        return false;
    }
    // Reject Windows drive letters like "C:" at the start.
    let bytes = name.as_bytes();
    if bytes.len() >= 2 && bytes[1] == b':' && bytes[0].is_ascii_alphabetic() {
        return false;
    }
    true
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

fn clear_import_subdirs(notes_dir: &Path, subdirs: &[&str]) -> Result<(), String> {
    for subdir in subdirs {
        let path = notes_dir.join(subdir);
        if path.exists() {
            fs::remove_dir_all(&path)
                .map_err(|e| format!("Failed to clear {subdir} before import: {e}"))?;
        }
        fs::create_dir_all(&path)
            .map_err(|e| format!("Failed to recreate {subdir} before import: {e}"))?;
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

/// Export all notes and templates to a ZIP file
#[tauri::command]
pub(crate) fn export_notes(destination: String) -> Result<String, String> {
    let notes_dir = get_notes_dir();
    let zip_path = PathBuf::from(&destination);

    export_notes_from(&notes_dir, &zip_path)?;
    Ok(zip_path.to_string_lossy().to_string())
}

fn export_notes_from(notes_dir: &Path, zip_path: &Path) -> Result<(), String> {
    let file =
        fs::File::create(zip_path).map_err(|e| format!("Failed to create ZIP file: {}", e))?;
    let mut zip = zip::ZipWriter::new(file);

    let options = SimpleFileOptions::default()
        .compression_method(zip::CompressionMethod::Deflated)
        .unix_permissions(0o600);

    for subdir in ["daily", "weekly", "notes", "templates", "images"] {
        add_archive_tree(&mut zip, notes_dir, subdir, options)?;
    }

    zip.finish()
        .map_err(|e| format!("Failed to finalize ZIP: {}", e))?;

    Ok(())
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

    let mut result = ImportResult {
        daily_notes: 0,
        standalone_notes: 0,
        templates: 0,
        images: 0,
    };
    let mut total_uncompressed: u64 = 0;

    // If not merging, clear existing notes first (but not templates)
    if !merge {
        clear_import_subdirs(notes_dir, &["daily", "weekly", "notes", "images"])?;
    }

    // Extract files from the ZIP
    for i in 0..archive.len() {
        let mut file = archive
            .by_index(i)
            .map_err(|e| format!("Failed to read ZIP entry: {}", e))?;

        let name = file.name().to_string();

        if name.ends_with('/') {
            continue;
        }

        let Some((subdir, dest_path)) = validated_archive_destination(notes_dir, &name) else {
            return Err(format!("Archive contains unsafe entry path '{name}'"));
        };

        // Reject entries whose reported uncompressed size is above the per-file
        // cap before we ever allocate for them.
        if file.size() > MAX_ENTRY_UNCOMPRESSED_SIZE {
            return Err(format!(
                "Archive entry '{}' exceeds per-file size limit",
                name
            ));
        }
        total_uncompressed = total_uncompressed.saturating_add(file.size());
        if total_uncompressed > MAX_TOTAL_UNCOMPRESSED_SIZE {
            return Err("Archive total uncompressed size exceeds limit".to_string());
        }

        ensure_import_parent(notes_dir, &dest_path)?;

        // If merging, skip existing files
        if merge && dest_path.exists() {
            continue;
        }

        // Extract the file, bounded by the per-entry size limit as defence in
        // depth against mismatched `file.size()` metadata.
        let mut content = Vec::new();
        (&mut file)
            .take(MAX_ENTRY_UNCOMPRESSED_SIZE + 1)
            .read_to_end(&mut content)
            .map_err(|e| format!("Failed to read file from ZIP: {}", e))?;
        if content.len() as u64 > MAX_ENTRY_UNCOMPRESSED_SIZE {
            return Err(format!(
                "Archive entry '{}' exceeds per-file size limit",
                name
            ));
        }

        crate::persist::write_atomic(&dest_path, &content, Some(0o600))
            .map_err(|e| format!("Failed to write file: {}", e))?;

        // Update counts
        match subdir.as_str() {
            "daily" => result.daily_notes += 1,
            "weekly" => result.daily_notes += 1,
            "notes" => result.standalone_notes += 1,
            "templates" => result.templates += 1,
            "images" => result.images += 1,
            _ => {}
        }
    }

    Ok(result)
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
    export_encrypted_backup_from(&notes_dir, &backup_path, &password)?;
    Ok(backup_path.to_string_lossy().to_string())
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

    let mut result = ImportResult {
        daily_notes: 0,
        standalone_notes: 0,
        templates: 0,
        images: 0,
    };
    let mut total_uncompressed: u64 = 0;

    // If not merging, clear existing notes first (but not templates)
    if !merge {
        clear_import_subdirs(notes_dir, &["daily", "weekly", "notes", "images"])?;
    }

    // Extract files from the ZIP
    for i in 0..archive.len() {
        let mut file = archive
            .by_index(i)
            .map_err(|e| format!("Failed to read archive entry: {}", e))?;

        let name = file.name().to_string();

        if name.ends_with('/') {
            continue;
        }

        let Some((subdir, dest_path)) = validated_archive_destination(notes_dir, &name) else {
            return Err(format!("Backup contains unsafe entry path '{name}'"));
        };

        if file.size() > MAX_ENTRY_UNCOMPRESSED_SIZE {
            return Err(format!(
                "Backup entry '{}' exceeds per-file size limit",
                name
            ));
        }
        total_uncompressed = total_uncompressed.saturating_add(file.size());
        if total_uncompressed > MAX_TOTAL_UNCOMPRESSED_SIZE {
            return Err("Backup total uncompressed size exceeds limit".to_string());
        }

        ensure_import_parent(notes_dir, &dest_path)?;

        // Skip if file exists and merging
        if merge && dest_path.exists() {
            continue;
        }

        // Read and write file content, bounded by per-entry limit.
        let mut content = Vec::new();
        (&mut file)
            .take(MAX_ENTRY_UNCOMPRESSED_SIZE + 1)
            .read_to_end(&mut content)
            .map_err(|e| format!("Failed to read file from archive: {}", e))?;
        if content.len() as u64 > MAX_ENTRY_UNCOMPRESSED_SIZE {
            return Err(format!(
                "Backup entry '{}' exceeds per-file size limit",
                name
            ));
        }

        crate::persist::write_atomic(&dest_path, &content, Some(0o600))
            .map_err(|e| format!("Failed to write file: {}", e))?;

        // Update counts
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

/// Write a settings JSON file to a user-chosen path.
#[tauri::command]
pub(crate) fn export_settings_json(path: String, json: String) -> Result<(), String> {
    let file_path = Path::new(&path);
    validate_user_export_path(file_path, "json")?;

    // Reject oversized payloads (settings JSON should be tiny).
    if json.len() > 2 * 1024 * 1024 {
        return Err("Settings JSON too large".to_string());
    }

    let mut file = fs::File::create(file_path).map_err(|e| e.to_string())?;
    file.write_all(json.as_bytes()).map_err(|e| e.to_string())?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = fs::set_permissions(file_path, fs::Permissions::from_mode(0o644));
    }
    Ok(())
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

    fn scaffold(path: &Path) {
        for subdir in ["daily", "weekly", "notes", "templates", "images"] {
            fs::create_dir_all(path.join(subdir)).unwrap();
        }
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
        assert!(elapsed.as_secs() < 15, "ZIP round trip took {elapsed:?}");
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

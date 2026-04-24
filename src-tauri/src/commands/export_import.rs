//! Export / import commands (ZIP, encrypted backup, settings JSON).

use std::fs;
use std::io::{Read as IoRead, Write as IoWrite};
use std::path::Path;
use std::path::PathBuf;
use zeroize::Zeroizing;
use zip::write::SimpleFileOptions;
use zip::ZipArchive;

use crate::encryption;
use crate::paths::get_notes_dir;
use crate::types::ImportResult;
use crate::validation::{is_safe_filename, validate_path_within_base, validate_user_export_path};

/// Export all notes and templates to a ZIP file
#[tauri::command]
pub(crate) fn export_notes(destination: String) -> Result<String, String> {
    let notes_dir = get_notes_dir();
    let zip_path = PathBuf::from(&destination);

    let file = fs::File::create(&zip_path)
        .map_err(|e| format!("Failed to create ZIP file: {}", e))?;
    let mut zip = zip::ZipWriter::new(file);

    let options = SimpleFileOptions::default()
        .compression_method(zip::CompressionMethod::Deflated)
        .unix_permissions(0o600);

    // Add files from each subdirectory
    for subdir in ["daily", "notes", "templates", "images"] {
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
pub(crate) fn import_notes(zip_path: String, merge: bool) -> Result<ImportResult, String> {
    let notes_dir = get_notes_dir();
    let zip_file = fs::File::open(&zip_path)
        .map_err(|e| format!("Failed to open ZIP file: {}", e))?;
    let mut archive = ZipArchive::new(zip_file)
        .map_err(|e| format!("Failed to read ZIP archive: {}", e))?;

    let mut result = ImportResult {
        daily_notes: 0,
        standalone_notes: 0,
        templates: 0,
        images: 0,
    };

    // If not merging, clear existing notes first (but not templates)
    if !merge {
        for subdir in ["daily", "notes", "images"] {
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
        if !["daily", "notes", "templates", "images"].contains(&subdir) {
            continue;
        }

        // Validate filename is safe (no path traversal)
        if !is_safe_filename(filename) {
            continue; // Skip unsafe filenames
        }

        let dest_dir = notes_dir.join(subdir);
        fs::create_dir_all(&dest_dir)
            .map_err(|e| format!("Failed to create directory: {}", e))?;

        let dest_path = dest_dir.join(filename);

        // Validate the final path is within the notes directory
        if validate_path_within_base(&dest_path, &notes_dir).is_err() {
            continue; // Skip paths that escape the notes directory
        }

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
            "images" => result.images += 1,
            _ => {}
        }
    }

    Ok(result)
}

/// Export all notes and templates to an encrypted backup file
#[tauri::command]
pub(crate) fn export_encrypted_backup(destination: String, password: String) -> Result<String, String> {
    let password = Zeroizing::new(password);
    use std::io::Cursor;

    let notes_dir = get_notes_dir();

    // Create ZIP in memory
    let mut zip_buffer = Cursor::new(Vec::new());
    {
        let mut zip = zip::ZipWriter::new(&mut zip_buffer);
        let options = SimpleFileOptions::default()
            .compression_method(zip::CompressionMethod::Deflated)
            .unix_permissions(0o600);

        // Add files from each subdirectory
        for subdir in ["daily", "notes", "templates", "weekly", "images"] {
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
    }

    // Get the ZIP data
    let zip_data = zip_buffer.into_inner();

    // Encrypt the ZIP data using our encryption module
    let zip_b64 = base64::Engine::encode(&base64::engine::general_purpose::STANDARD, &zip_data);
    let encrypted = encryption::encrypt_content(&zip_b64, &password)?;

    // Add a header to identify encrypted backups
    let backup_content = format!("MOLDAVITE_ENCRYPTED_BACKUP_V1\n{}", encrypted);

    // Write to destination
    let backup_path = PathBuf::from(&destination);
    fs::write(&backup_path, backup_content)
        .map_err(|e| format!("Failed to write backup file: {}", e))?;

    // Set restrictive permissions
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let permissions = fs::Permissions::from_mode(0o600);
        let _ = fs::set_permissions(&backup_path, permissions);
    }

    Ok(backup_path.to_string_lossy().to_string())
}

/// Import notes and templates from an encrypted backup file
#[tauri::command]
pub(crate) fn import_encrypted_backup(backup_path: String, password: String, merge: bool) -> Result<ImportResult, String> {
    let password = Zeroizing::new(password);
    use std::io::Cursor;

    let notes_dir = get_notes_dir();

    // Read the backup file
    let backup_content = fs::read_to_string(&backup_path)
        .map_err(|e| format!("Failed to read backup file: {}", e))?;

    // Verify header and extract encrypted data
    let lines: Vec<&str> = backup_content.splitn(2, '\n').collect();
    if lines.len() != 2 || lines[0] != "MOLDAVITE_ENCRYPTED_BACKUP_V1" {
        return Err("Invalid backup file format".to_string());
    }
    let encrypted = lines[1];

    // Decrypt the data
    let zip_b64 = encryption::decrypt_content(encrypted, &password)?;

    // Decode base64 to get ZIP data
    let zip_data = base64::Engine::decode(&base64::engine::general_purpose::STANDARD, &zip_b64)
        .map_err(|e| format!("Failed to decode backup data: {}", e))?;

    // Open the ZIP archive from memory
    let cursor = Cursor::new(zip_data);
    let mut archive = ZipArchive::new(cursor)
        .map_err(|e| format!("Failed to read backup archive: {}", e))?;

    let mut result = ImportResult {
        daily_notes: 0,
        standalone_notes: 0,
        templates: 0,
        images: 0,
    };

    // If not merging, clear existing notes first (but not templates)
    if !merge {
        for subdir in ["daily", "notes", "weekly", "images"] {
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
            .map_err(|e| format!("Failed to read archive entry: {}", e))?;

        let name = file.name().to_string();

        // Parse the path (subdir/filename)
        let parts: Vec<&str> = name.split('/').collect();
        if parts.len() != 2 {
            continue;
        }

        let subdir = parts[0];
        let filename = parts[1];

        // Only process valid subdirectories
        if !["daily", "notes", "templates", "weekly", "images"].contains(&subdir) {
            continue;
        }

        // Validate filename is safe (no path traversal)
        if !is_safe_filename(filename) {
            continue; // Skip unsafe filenames
        }

        // Ensure subdirectory exists
        let subdir_path = notes_dir.join(subdir);
        if !subdir_path.exists() {
            fs::create_dir_all(&subdir_path)
                .map_err(|e| format!("Failed to create directory: {}", e))?;
        }

        // Build destination path
        let dest_path = subdir_path.join(filename);

        // Validate the final path is within the notes directory
        if validate_path_within_base(&dest_path, &notes_dir).is_err() {
            continue; // Skip paths that escape the notes directory
        }

        // Skip if file exists and merging
        if merge && dest_path.exists() {
            continue;
        }

        // Read and write file content
        let mut content = Vec::new();
        file.read_to_end(&mut content)
            .map_err(|e| format!("Failed to read file from archive: {}", e))?;

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

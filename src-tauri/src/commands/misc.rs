//! Miscellaneous commands: directory setup, note colors, binary write, image save.

use chrono::Local;
use std::fs;
use std::io::Write as IoWrite;
use std::path::{Path, PathBuf};

use crate::paths::{
    get_daily_dir, get_images_dir, get_notes_dir, get_standalone_dir, get_weekly_dir,
};
use crate::persist::{read_config, read_note_metadata, write_config, write_note_metadata};
use crate::validation::is_safe_filename;

#[tauri::command]
pub(crate) fn ensure_directories() -> Result<(), String> {
    let notes_dir = get_notes_dir();
    let daily_dir = get_daily_dir();
    let standalone_dir = get_standalone_dir();
    let weekly_dir = get_weekly_dir();

    for dir in [&notes_dir, &daily_dir, &standalone_dir, &weekly_dir] {
        fs::create_dir_all(dir).map_err(|e| e.to_string())?;

        // Set restrictive directory permissions (700 = owner only)
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let permissions = fs::Permissions::from_mode(0o700);
            fs::set_permissions(dir, permissions).map_err(|e| e.to_string())?;
        }
    }

    Ok(())
}

/// Get the current notes directory path
#[tauri::command]
pub(crate) fn get_notes_directory() -> String {
    get_notes_dir().to_string_lossy().to_string()
}

/// Set a new notes directory and move all existing notes
#[tauri::command]
pub(crate) fn set_notes_directory(new_path: String) -> Result<(), String> {
    let new_dir = PathBuf::from(&new_path);
    let old_dir = get_notes_dir();

    // Don't do anything if it's the same directory
    if new_dir == old_dir {
        return Ok(());
    }

    // Validate the path is absolute
    if !new_dir.is_absolute() {
        return Err("Path must be absolute".to_string());
    }

    // Canonicalize before any prefix check so `.` / `..` / symlinks can't bypass
    // the policy. The target dir may not exist yet, so fall back to the parent.
    let canonical_candidate = match new_dir.canonicalize() {
        Ok(p) => p,
        Err(_) => new_dir
            .parent()
            .and_then(|p| p.canonicalize().ok())
            .unwrap_or_else(|| new_dir.clone()),
    };
    let path_str = canonical_candidate.to_string_lossy().to_lowercase();
    let forbidden_prefixes = [
        "/system",
        "/usr",
        "/bin",
        "/sbin",
        "/etc",
        "/var",
        "/private/var",
        "/private/etc",
        "/library",
        "/applications",
        "/cores",
        "/dev",
        "/tmp",
        "/private/tmp",
    ];

    for prefix in &forbidden_prefixes {
        if path_str.starts_with(prefix) {
            return Err("Cannot use system directories for notes storage".to_string());
        }
    }

    // Must be under the current user's home directory or /Volumes. The old
    // policy allowed `/Users/` (any user's home) — tighten to this user's home.
    let home_dir = dirs::home_dir().ok_or("Could not determine home directory")?;
    let canonical_home = home_dir.canonicalize().unwrap_or(home_dir.clone());
    let is_valid_location = canonical_candidate.starts_with(&canonical_home)
        || canonical_candidate.starts_with("/Volumes/");

    if !is_valid_location {
        return Err("Notes directory must be in your home folder or on an external volume".to_string());
    }

    // Create the new directory structure
    fs::create_dir_all(&new_dir).map_err(|e| format!("Failed to create new directory: {}", e))?;

    // Move/copy all subdirectories (daily, notes, templates)
    for subdir in ["daily", "notes", "templates"] {
        let old_subdir = old_dir.join(subdir);
        let new_subdir = new_dir.join(subdir);

        if old_subdir.exists() {
            fs::create_dir_all(&new_subdir)
                .map_err(|e| format!("Failed to create {}: {}", subdir, e))?;

            // Copy all files from old to new
            if let Ok(entries) = fs::read_dir(&old_subdir) {
                for entry in entries.flatten() {
                    let path = entry.path();
                    if path.is_file() {
                        let filename = path.file_name().unwrap();
                        let dest = new_subdir.join(filename);
                        fs::copy(&path, &dest)
                            .map_err(|e| format!("Failed to copy file: {}", e))?;
                    }
                }
            }
        }
    }

    // Update the config
    let mut config = read_config();
    config.notes_directory = Some(new_path);
    write_config(&config)?;

    // After successful copy, remove old files
    for subdir in ["daily", "notes", "templates"] {
        let old_subdir = old_dir.join(subdir);
        if old_subdir.exists() {
            if let Ok(entries) = fs::read_dir(&old_subdir) {
                for entry in entries.flatten() {
                    let path = entry.path();
                    if path.is_file() {
                        let _ = fs::remove_file(&path);
                    }
                }
            }
        }
    }

    Ok(())
}

/// Get the color ID for a specific note
#[tauri::command]
pub(crate) fn get_note_color(note_path: String) -> Option<String> {
    let metadata = read_note_metadata();
    metadata.colors.get(&note_path).cloned()
}

/// Set the color ID for a specific note
#[tauri::command]
pub(crate) fn set_note_color(note_path: String, color_id: Option<String>) -> Result<(), String> {
    let mut metadata = read_note_metadata();

    match color_id {
        Some(id) if id != "default" => {
            metadata.colors.insert(note_path, id);
        }
        _ => {
            metadata.colors.remove(&note_path);
        }
    }

    write_note_metadata(&metadata)
}

/// Get all note colors at once (for initial load)
#[tauri::command]
pub(crate) fn get_all_note_colors() -> std::collections::HashMap<String, String> {
    let metadata = read_note_metadata();
    metadata.colors
}

/// Write binary data to a file (used for PDF export).
///
/// Hardened: the target must be a PDF, its parent directory must already exist
/// (so we can canonicalize it), and that canonical parent must not live inside
/// a sensitive dotfile directory like ~/.ssh, ~/.config, or ~/Library. This
/// command is callable from any JS context, so the policy can't rely on the
/// file-save dialog to pick a "sane" path.
#[tauri::command]
pub(crate) fn write_binary_file(path: String, contents: Vec<u8>) -> Result<(), String> {
    let file_path = Path::new(&path);

    if !file_path.is_absolute() {
        return Err("Path must be absolute".to_string());
    }

    // Only allow PDF export via this command (filename extension check).
    let ext_ok = file_path
        .extension()
        .and_then(|s| s.to_str())
        .is_some_and(|e| e.eq_ignore_ascii_case("pdf"));
    if !ext_ok {
        return Err("Only .pdf files may be written via this command".to_string());
    }

    // Parent must exist and be canonicalizable (prevents symlink traversal tricks
    // since canonicalize resolves symlinks).
    let parent = file_path
        .parent()
        .ok_or_else(|| "Invalid destination path".to_string())?;
    let canonical_parent = parent
        .canonicalize()
        .map_err(|_| "Destination directory does not exist".to_string())?;
    let canonical_str = canonical_parent.to_string_lossy().to_lowercase();

    // Deny system directories (same list as before, but applied after canonicalization).
    let forbidden_prefixes = [
        "/system",
        "/usr",
        "/bin",
        "/sbin",
        "/etc",
        "/var",
        "/private/var",
        "/library",
    ];
    for prefix in &forbidden_prefixes {
        if canonical_str.starts_with(prefix) {
            return Err("Cannot write to system directories".to_string());
        }
    }

    // Deny writes into sensitive dotfile dirs that provide code-execution
    // persistence (shell rc, ssh, launch agents, cron, etc.).
    if let Some(home) = dirs::home_dir() {
        if let Ok(home_canon) = home.canonicalize() {
            let forbidden_subpaths = [
                ".ssh",
                ".gnupg",
                ".aws",
                ".config",
                ".docker",
                ".kube",
                "Library/LaunchAgents",
                "Library/LaunchDaemons",
                "Library/Preferences",
                "Library/Application Support",
                "Library/Keychains",
            ];
            for sub in &forbidden_subpaths {
                let denied = home_canon.join(sub);
                if canonical_parent.starts_with(&denied) {
                    return Err("Cannot write into a protected directory".to_string());
                }
            }
        }
    }

    // Any dotfile-prefixed final component is suspicious for PDF export.
    if let Some(name) = file_path.file_name().and_then(|s| s.to_str()) {
        if name.starts_with('.') {
            return Err("Refusing to write a dotfile".to_string());
        }
    }

    // Write the binary contents.
    let mut file = fs::File::create(file_path).map_err(|e| e.to_string())?;
    file.write_all(&contents).map_err(|e| e.to_string())?;

    // Set file permissions (644 = owner read/write, group/others read)
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let permissions = fs::Permissions::from_mode(0o644);
        fs::set_permissions(file_path, permissions).map_err(|e| e.to_string())?;
    }

    Ok(())
}

/// Save an image to the images directory
/// Takes base64-encoded image data and returns the saved file path
#[tauri::command]
pub(crate) fn save_image(data: String, filename: String) -> Result<String, String> {
    // Validate filename - only allow safe characters
    if !is_safe_filename(&filename) {
        return Err("Invalid filename".to_string());
    }

    // Ensure it has a valid image extension
    let lower_filename = filename.to_lowercase();
    let valid_extensions = [".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg"];
    if !valid_extensions.iter().any(|ext| lower_filename.ends_with(ext)) {
        return Err("Invalid image format".to_string());
    }

    // Get or create images directory
    let images_dir = get_images_dir();
    fs::create_dir_all(&images_dir).map_err(|e| format!("Failed to create images directory: {}", e))?;

    // Set directory permissions
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let permissions = fs::Permissions::from_mode(0o700);
        let _ = fs::set_permissions(&images_dir, permissions);
    }

    // Generate unique filename with timestamp to avoid collisions
    let timestamp = Local::now().format("%Y%m%d_%H%M%S_%3f").to_string();
    let extension = filename.rsplit('.').next().unwrap_or("png");
    let unique_filename = format!("{}_{}.{}",
        filename.rsplit('.').next_back().map(|_| filename.trim_end_matches(&format!(".{}", extension))).unwrap_or("image"),
        timestamp,
        extension
    );

    let file_path = images_dir.join(&unique_filename);

    // Decode base64 data
    // Handle data URLs (e.g., "data:image/png;base64,...")
    let base64_data = if data.contains(",") {
        data.split(',').nth(1).unwrap_or(&data)
    } else {
        &data
    };

    use base64::{engine::general_purpose::STANDARD, Engine};
    let image_bytes = STANDARD.decode(base64_data)
        .map_err(|e| format!("Failed to decode image data: {}", e))?;

    // Write the image file
    let mut file = fs::File::create(&file_path)
        .map_err(|e| format!("Failed to create image file: {}", e))?;
    file.write_all(&image_bytes)
        .map_err(|e| format!("Failed to write image data: {}", e))?;

    // Set file permissions
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let permissions = fs::Permissions::from_mode(0o600);
        let _ = fs::set_permissions(&file_path, permissions);
    }

    // Return the absolute path
    Ok(file_path.to_string_lossy().to_string())
}

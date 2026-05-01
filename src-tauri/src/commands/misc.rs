//! Miscellaneous commands: directory setup, note colors, binary write, image save.

use chrono::Local;
use std::fs;
use std::io::Write as IoWrite;
use std::path::{Path, PathBuf};

use crate::forge_watcher::RecentWrites;
use crate::frontmatter;
use crate::paths::{
    get_daily_dir, get_images_dir, get_notes_dir, get_standalone_dir, get_weekly_dir,
};
use crate::persist::{read_config, write_config};
use crate::validation::is_safe_filename;
use std::sync::Arc;
use tauri::State;
use walkdir::WalkDir;

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

/// Force a re-scan of the Forge directory: rebuilds the in-memory backlinks
/// index from disk so any externally-added notes show up. The frontend is
/// expected to call `list_notes` afterward to refresh its own state.
#[tauri::command]
pub(crate) fn rescan_forge(
    index: State<'_, std::sync::Arc<crate::backlinks_index::BacklinksIndex>>,
) -> Result<(), String> {
    index.rebuild_from_disk();
    Ok(())
}

/// Open the Forge directory in the system file browser. macOS: Finder.
/// Other platforms: best-effort no-op (returns Ok with a log warning).
#[tauri::command]
pub(crate) fn open_forge_in_finder() -> Result<(), String> {
    let dir = get_notes_dir();
    if !dir.exists() {
        return Err("Forge directory does not exist".to_string());
    }

    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(&dir)
            .spawn()
            .map_err(|e| format!("failed to open Finder: {}", e))?;
        Ok(())
    }

    #[cfg(not(target_os = "macos"))]
    {
        log::info!("[forge] open_forge_in_finder is a no-op on this platform");
        Ok(())
    }
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

/// Resolve a `note_path` (relative, like `daily/foo.md` or `notes/sub/x.md`)
/// to an absolute path under the notes dir. Refuses traversal attempts.
fn resolve_note_path(note_path: &str) -> Option<PathBuf> {
    if note_path.is_empty()
        || note_path.contains("..")
        || note_path.contains('\0')
        || note_path.starts_with('/')
        || note_path.starts_with('\\')
    {
        return None;
    }
    Some(get_notes_dir().join(note_path))
}

/// Get the color ID for a specific note (reads from YAML frontmatter).
#[tauri::command]
pub(crate) fn get_note_color(note_path: String) -> Option<String> {
    let abs = resolve_note_path(&note_path)?;
    if !abs.exists() {
        return None;
    }
    let raw = fs::read_to_string(&abs).ok()?;
    frontmatter::parse_note(&raw).color
}

/// Set the color ID for a specific note by updating its YAML frontmatter.
#[tauri::command]
pub(crate) fn set_note_color(
    note_path: String,
    color_id: Option<String>,
    recent: State<'_, Arc<RecentWrites>>,
) -> Result<(), String> {
    let abs = resolve_note_path(&note_path).ok_or_else(|| "Invalid note path".to_string())?;

    // Locked notes can't carry frontmatter (they're encrypted blobs).
    if abs
        .file_name()
        .and_then(|f| f.to_str())
        .is_some_and(|n| n.ends_with(".md.locked"))
    {
        return Err("Cannot set color on locked note".to_string());
    }

    let existing = fs::read_to_string(&abs).unwrap_or_default();
    let parsed = frontmatter::parse_note(&existing);
    let new_color = color_id.filter(|c| !c.is_empty() && c != "default");
    let new_content = frontmatter::serialize_note(
        new_color.as_deref(),
        &parsed.extra,
        &parsed.body,
    );

    // Make sure the directory exists before we write.
    if let Some(parent) = abs.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    fs::write(&abs, new_content).map_err(|e| e.to_string())?;
    recent.record(&abs);

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = fs::set_permissions(&abs, fs::Permissions::from_mode(0o600));
    }

    Ok(())
}

/// Walk the Forge tree and harvest every note color. Used for the initial
/// load on app start.
#[tauri::command]
pub(crate) fn get_all_note_colors() -> std::collections::HashMap<String, String> {
    let mut out: std::collections::HashMap<String, String> = std::collections::HashMap::new();
    let root = get_notes_dir();
    if !root.exists() {
        return out;
    }
    for sub in ["daily", "notes", "weekly"] {
        let dir = root.join(sub);
        if !dir.exists() {
            continue;
        }
        for entry in WalkDir::new(&dir)
            .follow_links(false)
            .into_iter()
            .filter_map(Result::ok)
        {
            let p = entry.path();
            // Skip directories starting with "."
            if entry
                .file_name()
                .to_string_lossy()
                .starts_with('.')
                && entry.depth() > 0
            {
                continue;
            }
            if !p.is_file() {
                continue;
            }
            let name = match p.file_name().and_then(|n| n.to_str()) {
                Some(n) => n,
                None => continue,
            };
            // Don't try to parse encrypted blobs.
            if !name.ends_with(".md") {
                continue;
            }
            let Ok(rel) = p.strip_prefix(&root) else {
                continue;
            };
            let rel_str = rel
                .components()
                .map(|c| c.as_os_str().to_string_lossy().to_string())
                .collect::<Vec<_>>()
                .join("/");
            if let Ok(raw) = fs::read_to_string(p) {
                if let Some(color) = frontmatter::parse_note(&raw).color {
                    out.insert(rel_str, color);
                }
            }
        }
    }
    out
}

/// Write binary data to a file (used for PDF / plaintext export).
///
/// Hardened: the target's extension must match `extension` (defaulting to
/// "pdf" for back-compat with existing callers), its parent directory must
/// already exist (so we can canonicalize it), and that canonical parent must
/// not live inside a sensitive dotfile directory like ~/.ssh, ~/.config, or
/// ~/Library. This command is callable from any JS context, so the policy
/// can't rely on the file-save dialog to pick a "sane" path.
#[tauri::command]
pub(crate) fn write_binary_file(
    path: String,
    contents: Vec<u8>,
    extension: Option<String>,
) -> Result<(), String> {
    let file_path = Path::new(&path);
    // Allow only a small explicit list of export targets. Adding here is
    // deliberate — `write_binary_file` is the only generic write helper, so
    // each accepted extension is opt-in.
    let ext = extension.as_deref().unwrap_or("pdf").to_lowercase();
    if !matches!(ext.as_str(), "pdf" | "txt") {
        return Err(format!("Unsupported export extension: {}", ext));
    }
    crate::validation::validate_user_export_path(file_path, &ext)?;

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

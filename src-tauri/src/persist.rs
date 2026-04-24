//! On-disk state read/write helpers (config, trash metadata, note metadata).

use std::fs;
use std::path::Path;

use lazy_static::lazy_static;
use regex::Regex;

use crate::paths::{
    ensure_trash_dir, get_config_path, get_metadata_path, get_trash_metadata_path,
};
use crate::types::{AppConfig, NoteMetadata, TrashMetadata};

lazy_static! {
    /// Matches a trailing " (N)" counter on a name.
    static ref COUNTER_SUFFIX_RE: Regex = Regex::new(r"^(.+) \((\d+)\)$").unwrap();
}

pub(crate) fn read_config() -> AppConfig {
    let config_path = get_config_path();
    if config_path.exists() {
        if let Ok(content) = fs::read_to_string(&config_path) {
            if let Ok(config) = serde_json::from_str::<AppConfig>(&content) {
                return config;
            }
        }
    }
    AppConfig::default()
}

pub(crate) fn write_config(config: &AppConfig) -> Result<(), String> {
    let config_path = get_config_path();

    // Ensure config directory exists
    if let Some(parent) = config_path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("Failed to create config directory: {}", e))?;
    }

    let json = serde_json::to_string_pretty(config).map_err(|e| e.to_string())?;
    fs::write(&config_path, &json).map_err(|e| format!("Failed to write config: {}", e))?;

    // Set restrictive permissions on config file (0o600 = owner read/write only)
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let permissions = fs::Permissions::from_mode(0o600);
        let _ = fs::set_permissions(&config_path, permissions);
    }

    Ok(())
}

pub(crate) fn read_trash_metadata() -> TrashMetadata {
    let metadata_path = get_trash_metadata_path();
    if metadata_path.exists() {
        if let Ok(content) = fs::read_to_string(&metadata_path) {
            if let Ok(metadata) = serde_json::from_str::<TrashMetadata>(&content) {
                return metadata;
            }
        }
    }
    TrashMetadata::default()
}

pub(crate) fn write_trash_metadata(metadata: &TrashMetadata) -> Result<(), String> {
    ensure_trash_dir()?;
    let metadata_path = get_trash_metadata_path();
    let json = serde_json::to_string_pretty(metadata).map_err(|e| e.to_string())?;
    fs::write(&metadata_path, json).map_err(|e| format!("Failed to write trash metadata: {}", e))?;
    Ok(())
}

pub(crate) fn read_note_metadata() -> NoteMetadata {
    let path = get_metadata_path();
    if path.exists() {
        if let Ok(content) = fs::read_to_string(&path) {
            if let Ok(metadata) = serde_json::from_str(&content) {
                return metadata;
            }
        }
    }
    NoteMetadata::default()
}

pub(crate) fn write_note_metadata(metadata: &NoteMetadata) -> Result<(), String> {
    let path = get_metadata_path();
    let content = serde_json::to_string_pretty(metadata).map_err(|e| e.to_string())?;
    fs::write(&path, content).map_err(|e| e.to_string())?;
    Ok(())
}

/// Build the full on-disk name (file or folder) from a base name and
/// optional extension.
fn build_name(base: &str, counter: Option<u32>, extension: Option<&str>) -> String {
    let with_counter = match counter {
        Some(n) => format!("{} ({})", base, n),
        None => base.to_string(),
    };
    match extension {
        Some(ext) => format!("{}.{}", with_counter, ext),
        None => with_counter,
    }
}

/// Core uniqueness search shared by file and folder name generation.
///
/// If `extension` is `Some(ext)`, the returned name is `"<base>.<ext>"`
/// (or `"<base> (N).<ext>"`). If `None`, the returned name has no
/// extension (folder case).
fn generate_unique_name(dir: &Path, base_name: &str, extension: Option<&str>) -> String {
    let initial = build_name(base_name, None, extension);
    if !dir.join(&initial).exists() {
        return initial;
    }

    // Strip any existing " (N)" suffix so we don't produce "foo (2) (2)".
    let (actual_base, start_num) = COUNTER_SUFFIX_RE
        .captures(base_name)
        .and_then(|caps| {
            let base = caps.get(1)?.as_str().to_string();
            let n = caps.get(2)?.as_str().parse::<u32>().ok()?;
            Some((base, n))
        })
        .unwrap_or_else(|| (base_name.to_string(), 1));

    // Start from 2 if this is a fresh duplicate, or from existing number + 1.
    let mut counter = if start_num == 1 { 2 } else { start_num + 1 };

    loop {
        let candidate = build_name(&actual_base, Some(counter), extension);
        if !dir.join(&candidate).exists() {
            return candidate;
        }
        counter += 1;
        if counter > 10_000 {
            let timestamp = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_secs() as u32;
            return build_name(&actual_base, Some(timestamp), extension);
        }
    }
}

/// Generate a unique filename in the given directory.
/// If "name.md" exists, tries "name (2).md", "name (3).md", etc.
pub(crate) fn generate_unique_filename(dir: &Path, base_name: &str, extension: &str) -> String {
    generate_unique_name(dir, base_name, Some(extension))
}

/// Generate a unique folder name in the given directory.
pub(crate) fn generate_unique_folder_name(parent_dir: &Path, base_name: &str) -> String {
    generate_unique_name(parent_dir, base_name, None)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    struct TempDir(PathBuf);
    impl TempDir {
        fn new(tag: &str) -> Self {
            let base = std::env::temp_dir().join(format!(
                "moldavite-persist-{}-{}",
                tag,
                std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .unwrap()
                    .as_nanos()
            ));
            fs::create_dir_all(&base).unwrap();
            Self(base)
        }
        fn path(&self) -> &Path {
            &self.0
        }
    }
    impl Drop for TempDir {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    #[test]
    fn unique_filename_returns_base_when_free() {
        let tmp = TempDir::new("unique-free");
        let name = generate_unique_filename(tmp.path(), "hello", "md");
        assert_eq!(name, "hello.md");
    }

    #[test]
    fn unique_filename_appends_counter_on_collision() {
        let tmp = TempDir::new("unique-collide");
        fs::write(tmp.path().join("hello.md"), "").unwrap();
        let name = generate_unique_filename(tmp.path(), "hello", "md");
        assert_eq!(name, "hello (2).md");
    }

    #[test]
    fn unique_filename_increments_over_multiple_collisions() {
        let tmp = TempDir::new("unique-multi");
        for n in ["hello.md", "hello (2).md", "hello (3).md"] {
            fs::write(tmp.path().join(n), "").unwrap();
        }
        let name = generate_unique_filename(tmp.path(), "hello", "md");
        assert_eq!(name, "hello (4).md");
    }

    #[test]
    fn unique_filename_does_not_double_counter_suffix() {
        let tmp = TempDir::new("unique-nodouble");
        fs::write(tmp.path().join("hello (2).md"), "").unwrap();
        let name = generate_unique_filename(tmp.path(), "hello (2)", "md");
        assert_eq!(name, "hello (3).md");
    }

    #[test]
    fn unique_folder_name_returns_base_when_free() {
        let tmp = TempDir::new("unique-folder-free");
        let name = generate_unique_folder_name(tmp.path(), "projects");
        assert_eq!(name, "projects");
    }

    #[test]
    fn unique_folder_name_appends_counter_on_collision() {
        let tmp = TempDir::new("unique-folder-collide");
        fs::create_dir(tmp.path().join("projects")).unwrap();
        let name = generate_unique_folder_name(tmp.path(), "projects");
        assert_eq!(name, "projects (2)");
    }
}

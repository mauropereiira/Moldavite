//! Atomic persistence and collision-free name generation for shared disk state.
//!
//! [`write_atomic`] is the only write primitive for config, metadata, indexes,
//! and note data: it creates a same-directory temporary file, applies restrictive
//! permissions before data becomes visible, writes and `fsync`s the file, then
//! renames it over the destination. Same-directory rename provides atomic
//! replacement; unique temp names keep concurrent writers isolated. Failed
//! writes remove their temp file and leave the previous destination intact.

use std::fs;
use std::path::Path;

use lazy_static::lazy_static;
use regex::Regex;

use crate::paths::{ensure_trash_dir, get_config_path, get_trash_metadata_path};
use crate::types::{AppConfig, TrashMetadata};

lazy_static! {
    /// Matches a trailing " (N)" counter on a name.
    static ref COUNTER_SUFFIX_RE: Regex = Regex::new(r"^(.+) \((\d+)\)$").unwrap();
}

/// Atomically replace `path` after a same-directory temp write and file `fsync`.
///
/// On Unix, `mode` is applied to the temporary file before rename, so the
/// destination is never observable with broader permissions. Concurrent calls
/// never share a temp path; on failure the prior destination remains intact.
pub(crate) fn write_atomic(path: &Path, contents: &[u8], mode: Option<u32>) -> Result<(), String> {
    let parent = path
        .parent()
        .filter(|p| !p.as_os_str().is_empty())
        .ok_or_else(|| format!("No parent directory for {}", path.display()))?;
    let file_name = path
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .ok_or_else(|| format!("Invalid file name for {}", path.display()))?;
    // Unique per process AND per call: concurrent writers to the same file
    // must never share a temp path (a clock-resolution timestamp can collide).
    static TMP_COUNTER: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
    let tmp_path = parent.join(format!(
        ".{}.{}.{}.tmp",
        file_name,
        std::process::id(),
        TMP_COUNTER.fetch_add(1, std::sync::atomic::Ordering::Relaxed)
    ));

    let result = (|| -> std::io::Result<()> {
        use std::io::Write;
        let mut file = fs::File::create(&tmp_path)?;
        #[cfg(unix)]
        if let Some(mode) = mode {
            use std::os::unix::fs::PermissionsExt;
            file.set_permissions(fs::Permissions::from_mode(mode))?;
        }
        #[cfg(not(unix))]
        let _ = mode;
        file.write_all(contents)?;
        file.sync_all()?;
        fs::rename(&tmp_path, path)
    })();

    if result.is_err() {
        let _ = fs::remove_file(&tmp_path);
    }
    result.map_err(|e| format!("Failed to write {}: {}", path.display(), e))
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
    write_atomic(&config_path, json.as_bytes(), Some(0o600))
        .map_err(|e| format!("Failed to write config: {}", e))?;

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
    write_atomic(&metadata_path, json.as_bytes(), Some(0o600))
        .map_err(|e| format!("Failed to write trash metadata: {}", e))?;
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
    fn write_atomic_creates_file_with_content_and_mode() {
        let tmp = TempDir::new("atomic-basic");
        let path = tmp.path().join("note.md");
        write_atomic(&path, b"hello world", Some(0o600)).unwrap();
        assert_eq!(fs::read_to_string(&path).unwrap(), "hello world");
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mode = fs::metadata(&path).unwrap().permissions().mode() & 0o777;
            assert_eq!(mode, 0o600);
        }
    }

    #[test]
    fn write_atomic_replaces_existing_and_leaves_no_temp_files() {
        let tmp = TempDir::new("atomic-replace");
        let path = tmp.path().join("note.md");
        write_atomic(&path, b"first", None).unwrap();
        write_atomic(&path, b"second", None).unwrap();
        assert_eq!(fs::read_to_string(&path).unwrap(), "second");
        let leftovers: Vec<_> = fs::read_dir(tmp.path())
            .unwrap()
            .flatten()
            .filter(|e| e.file_name().to_string_lossy().ends_with(".tmp"))
            .collect();
        assert!(leftovers.is_empty());
    }

    #[test]
    fn write_atomic_fails_for_missing_parent() {
        let tmp = TempDir::new("atomic-noparent");
        let path = tmp.path().join("nope").join("note.md");
        assert!(write_atomic(&path, b"x", None).is_err());
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

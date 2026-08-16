//! Atomic persistence and collision-free name generation for shared disk state.
//!
//! [`write_atomic`] is the only write primitive for config, metadata, indexes,
//! and note data: it creates a same-directory temporary file, applies restrictive
//! permissions before data becomes visible, writes and `fsync`s the file, then
//! renames it over the destination. Same-directory rename provides atomic
//! replacement; unique temp names keep concurrent writers isolated. Failed
//! writes remove their temp file and leave the previous destination intact.

use std::fs;
use std::fs::OpenOptions;
use std::io::Write;
use std::path::Path;

use lazy_static::lazy_static;
use rand::rngs::OsRng;
use rand::RngCore;
use regex::Regex;

use crate::paths::{ensure_trash_dir, get_config_path, get_trash_metadata_path};
use crate::types::{AppConfig, TrashMetadata};

lazy_static! {
    /// Matches a trailing " (N)" counter on a name.
    static ref COUNTER_SUFFIX_RE: Regex = Regex::new(r"^(.+) \((\d+)\)$").unwrap();
}

#[cfg(windows)]
const WINDOWS_RENAME_RETRY_DELAYS: [std::time::Duration; 4] = [
    std::time::Duration::from_millis(10),
    std::time::Duration::from_millis(25),
    std::time::Duration::from_millis(50),
    std::time::Duration::from_millis(100),
];

#[cfg(windows)]
const WINDOWS_RENAME_BUSY_MESSAGE: &str =
    "File is busy. Wait for syncing or antivirus scanning to finish, then try again.";

#[cfg(target_os = "linux")]
const O_NOFOLLOW_FLAG: i32 = 0o400000;
#[cfg(all(unix, not(target_os = "linux")))]
const O_NOFOLLOW_FLAG: i32 = 0x0100;

// MoveFileExW can report a non-delete-sharing handle with either code.
#[cfg(windows)]
fn is_transient_windows_rename_error(error: &std::io::Error) -> bool {
    matches!(error.raw_os_error(), Some(5) | Some(32))
}

#[cfg(windows)]
fn retry_windows_rename(
    mut rename: impl FnMut() -> std::io::Result<()>,
    mut sleep: impl FnMut(std::time::Duration),
) -> std::io::Result<()> {
    // Scanners and sync clients normally release handles within tens of
    // milliseconds. Four front-loaded waits give five total attempts while
    // bounding deliberate backoff to 185 ms.
    let mut delays = WINDOWS_RENAME_RETRY_DELAYS.into_iter();
    loop {
        match rename() {
            Ok(()) => return Ok(()),
            Err(error) if is_transient_windows_rename_error(&error) => {
                let Some(delay) = delays.next() else {
                    return Err(std::io::Error::new(
                        error.kind(),
                        WINDOWS_RENAME_BUSY_MESSAGE,
                    ));
                };
                sleep(delay);
            }
            Err(error) => return Err(error),
        }
    }
}

#[cfg(windows)]
fn rename_with_retry(from: &Path, to: &Path) -> std::io::Result<()> {
    retry_windows_rename(|| fs::rename(from, to), std::thread::sleep)
}

fn open_atomic_temp(
    parent: &Path,
    file_name: &str,
    mode: Option<u32>,
) -> std::io::Result<(std::path::PathBuf, fs::File)> {
    const MAX_ATTEMPTS: usize = 32;

    for _ in 0..MAX_ATTEMPTS {
        let suffix = OsRng.next_u64();
        let tmp_path = parent.join(format!(
            ".{file_name}.{}.{suffix:016x}.tmp",
            std::process::id()
        ));
        let mut options = OpenOptions::new();
        options.write(true).create_new(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options
                .mode(mode.unwrap_or(0o600))
                .custom_flags(O_NOFOLLOW_FLAG);
        }
        #[cfg(not(unix))]
        let _ = mode;

        match options.open(&tmp_path) {
            Ok(file) => return Ok((tmp_path, file)),
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(error) => return Err(error),
        }
    }

    Err(std::io::Error::new(
        std::io::ErrorKind::AlreadyExists,
        "could not reserve a unique atomic temporary file",
    ))
}

/// Atomically replace `path` after writing a securely created same-directory temp file.
pub(crate) fn write_atomic_with<F>(
    path: &Path,
    mode: Option<u32>,
    write: F,
) -> Result<(), String>
where
    F: FnOnce(&mut fs::File) -> Result<(), String>,
{
    let parent = path
        .parent()
        .filter(|p| !p.as_os_str().is_empty())
        .ok_or_else(|| format!("No parent directory for {}", path.display()))?;
    let file_name = path
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .ok_or_else(|| format!("Invalid file name for {}", path.display()))?;
    if fs::symlink_metadata(path)
        .map(|metadata| metadata.file_type().is_symlink())
        .unwrap_or(false)
    {
        return Err(format!("Refusing to replace symlink {}", path.display()));
    }

    let (tmp_path, mut file) = open_atomic_temp(parent, &file_name, mode)
        .map_err(|e| format!("Failed to write {}: {}", path.display(), e))?;
    let result = (|| -> Result<(), String> {
        write(&mut file)?;
        file.sync_all().map_err(|e| e.to_string())?;
        drop(file);
        #[cfg(windows)]
        {
            rename_with_retry(&tmp_path, path).map_err(|e| e.to_string())
        }
        #[cfg(not(windows))]
        {
            fs::rename(&tmp_path, path).map_err(|e| e.to_string())
        }
    })();

    if result.is_err() {
        let _ = fs::remove_file(&tmp_path);
    }
    result.map_err(|e| format!("Failed to write {}: {}", path.display(), e))
}

/// Atomically replace `path` after a same-directory temp write and file `fsync`.
///
/// The temporary name has OS entropy, is reserved exclusively without following
/// symlinks, and receives its final mode at creation. On failure the prior
/// destination remains intact and the temporary file is removed.
pub(crate) fn write_atomic(path: &Path, contents: &[u8], mode: Option<u32>) -> Result<(), String> {
    write_atomic_with(path, mode, |file| {
        file.write_all(contents).map_err(|e| e.to_string())
    })
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
    let mut counter = if start_num == 1 {
        2
    } else {
        match start_num.checked_add(1) {
            Some(next) => next,
            None => return timestamped_name(&actual_base, extension),
        }
    };

    loop {
        let candidate = build_name(&actual_base, Some(counter), extension);
        if !dir.join(&candidate).exists() {
            return candidate;
        }
        let Some(next) = counter.checked_add(1) else {
            return timestamped_name(&actual_base, extension);
        };
        counter = next;
        if counter > 10_000 {
            return timestamped_name(&actual_base, extension);
        }
    }
}

fn timestamped_name(base: &str, extension: Option<&str>) -> String {
    let timestamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as u32;
    build_name(base, Some(timestamp), extension)
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

    #[cfg(unix)]
    #[test]
    fn security_regression_write_atomic_ignores_predictable_temp_symlink() {
        use std::os::unix::fs::symlink;

        let tmp = TempDir::new("atomic-temp-symlink");
        let path = tmp.path().join("note.md");
        let outside = tmp.path().join("outside-secret");
        fs::write(&outside, "must survive").unwrap();
        let predictable = tmp.path().join(format!(
            ".note.md.{}.0.tmp",
            std::process::id()
        ));
        symlink(&outside, predictable).unwrap();

        write_atomic(&path, b"new note", Some(0o600)).unwrap();

        assert_eq!(fs::read_to_string(&outside).unwrap(), "must survive");
        assert_eq!(fs::read_to_string(&path).unwrap(), "new note");
        assert!(!fs::symlink_metadata(path).unwrap().file_type().is_symlink());
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn write_atomic_retries_a_real_windows_sharing_violation() {
        use std::fs::OpenOptions;
        use std::os::windows::fs::OpenOptionsExt;
        use std::sync::mpsc;
        use std::thread;
        use std::time::Duration;

        const FILE_SHARE_READ: u32 = 0x0000_0001;
        const FILE_SHARE_WRITE: u32 = 0x0000_0002;

        let tmp = TempDir::new("atomic-sharing-violation");
        let path = tmp.path().join("note.md");
        fs::write(&path, "before").unwrap();

        // Omitting FILE_SHARE_DELETE makes MoveFileExW unable to replace the
        // destination until this handle closes.
        let blocking_handle = OpenOptions::new()
            .read(true)
            .share_mode(FILE_SHARE_READ | FILE_SHARE_WRITE)
            .open(&path)
            .unwrap();

        let probe_path = tmp.path().join("probe.md");
        fs::write(&probe_path, "probe").unwrap();
        let probe_error = fs::rename(&probe_path, &path).unwrap_err();
        assert!(
            matches!(probe_error.raw_os_error(), Some(5) | Some(32)),
            "expected a Windows sharing violation, got {probe_error:?}"
        );
        assert!(probe_path.exists());
        fs::remove_file(probe_path).unwrap();

        let (started_tx, started_rx) = mpsc::channel();
        let releaser = thread::spawn(move || {
            started_tx.send(()).unwrap();
            thread::sleep(Duration::from_millis(50));
            drop(blocking_handle);
        });
        started_rx.recv().unwrap();

        let result = write_atomic(&path, b"after", None);
        releaser.join().unwrap();
        result.unwrap();
        assert_eq!(fs::read_to_string(path).unwrap(), "after");
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn windows_rename_does_not_retry_a_permanent_error() {
        use std::cell::Cell;

        let tmp = TempDir::new("atomic-missing-parent");
        let source = tmp.path().join("source.md");
        let missing_destination = tmp.path().join("missing").join("note.md");
        fs::write(&source, "content").unwrap();

        let attempts = Cell::new(0);
        let sleeps = Cell::new(0);
        let error = retry_windows_rename(
            || {
                attempts.set(attempts.get() + 1);
                fs::rename(&source, &missing_destination)
            },
            |_| sleeps.set(sleeps.get() + 1),
        )
        .unwrap_err();

        assert!(!is_transient_windows_rename_error(&error));
        assert_eq!(attempts.get(), 1);
        assert_eq!(sleeps.get(), 0);
        assert!(source.exists());
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn windows_rename_exhaustion_returns_actionable_error() {
        use std::cell::Cell;

        let attempts = Cell::new(0);
        let sleeps = Cell::new(0);
        let error = retry_windows_rename(
            || {
                attempts.set(attempts.get() + 1);
                Err(std::io::Error::from_raw_os_error(32))
            },
            |_| sleeps.set(sleeps.get() + 1),
        )
        .unwrap_err();

        assert_eq!(attempts.get(), WINDOWS_RENAME_RETRY_DELAYS.len() + 1);
        assert_eq!(sleeps.get(), WINDOWS_RENAME_RETRY_DELAYS.len());
        assert_eq!(error.to_string(), WINDOWS_RENAME_BUSY_MESSAGE);
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
    fn security_regression_duplicate_counter_does_not_overflow() {
        let tmp = TempDir::new("unique-overflow");
        fs::write(tmp.path().join("hello (4294967295).md"), "").unwrap();

        let name = generate_unique_filename(tmp.path(), "hello (4294967295)", "md");

        assert_ne!(name, "hello (4294967295).md");
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

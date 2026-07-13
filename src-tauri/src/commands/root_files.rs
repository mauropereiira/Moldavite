//! Forge-root file commands (AGENTS.md, .gitignore).
//!
//! These commands let the frontend write a small, hard-whitelisted set of
//! files at the root of the active Forge — used by the "agent-ready vault"
//! feature (Settings → AI & Agents). The whitelist is deliberately exact
//! (no globs, no user-supplied paths): anything not on it is rejected
//! before any filesystem access happens.
//! Writes are create-only when requested and always use atomic persistence with
//! owner-only permissions; this surface must never grow into an arbitrary Forge
//! root file API.

use std::fs;
use std::path::Path;

use crate::paths::get_notes_dir;
use crate::persist::write_atomic;

/// The only files these commands may ever touch, by exact name.
const ROOT_FILE_WHITELIST: [&str; 2] = ["AGENTS.md", ".gitignore"];

/// Cap on the content size (bytes) accepted for a root file. These are
/// hand-sized text files; anything larger indicates a misbehaving caller.
const MAX_ROOT_FILE_BYTES: usize = 262_144; // 256 KiB

/// Error string returned when the target exists and `overwrite` is false.
/// The frontend matches on this exact value to offer a confirm-overwrite
/// flow, so it must stay stable (and must not contain a filesystem path,
/// which the IPC layer would redact).
pub(crate) const ERR_EXISTS: &str = "EXISTS";

fn validate_root_filename(filename: &str) -> Result<(), String> {
    if ROOT_FILE_WHITELIST.contains(&filename) {
        Ok(())
    } else {
        Err(format!("File name not allowed: {}", filename))
    }
}

/// Core write, parameterized over the base directory for testability.
pub(crate) fn write_forge_root_file_in(
    base: &Path,
    filename: &str,
    content: &str,
    overwrite: bool,
) -> Result<String, String> {
    validate_root_filename(filename)?;
    if content.len() > MAX_ROOT_FILE_BYTES {
        return Err("Content too large".to_string());
    }

    fs::create_dir_all(base).map_err(|e| format!("Failed to create Forge directory: {}", e))?;
    let dest = base.join(filename);
    if dest.exists() && !overwrite {
        return Err(ERR_EXISTS.to_string());
    }

    // 0644 (not the note default of 0600): these files exist precisely so
    // external tools and agents can read them.
    write_atomic(&dest, content.as_bytes(), Some(0o644))?;
    Ok(dest.to_string_lossy().to_string())
}

/// Core read, parameterized over the base directory for testability.
/// Returns `Ok(None)` when the file doesn't exist.
pub(crate) fn read_forge_root_file_in(
    base: &Path,
    filename: &str,
) -> Result<Option<String>, String> {
    validate_root_filename(filename)?;
    let src = base.join(filename);
    if !src.exists() {
        return Ok(None);
    }
    fs::read_to_string(&src)
        .map(Some)
        .map_err(|e| format!("Failed to read {}: {}", filename, e))
}

/// Write a whitelisted file (AGENTS.md or .gitignore) at the root of the
/// active Forge. Returns the absolute path written. If the file already
/// exists and `overwrite` is false, fails with the distinct error "EXISTS".
#[tauri::command]
pub(crate) fn write_forge_root_file(
    filename: String,
    content: String,
    overwrite: bool,
) -> Result<String, String> {
    write_forge_root_file_in(&get_notes_dir(), &filename, &content, overwrite)
}

/// Read a whitelisted file from the root of the active Forge.
/// Returns `None` if the file doesn't exist.
#[tauri::command]
pub(crate) fn read_forge_root_file(filename: String) -> Result<Option<String>, String> {
    read_forge_root_file_in(&get_notes_dir(), &filename)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    struct TempDir(PathBuf);
    impl TempDir {
        fn new(tag: &str) -> Self {
            let base = std::env::temp_dir().join(format!(
                "moldavite-rootfiles-{}-{}",
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
    fn whitelist_rejects_everything_but_the_two_allowed_names() {
        let tmp = TempDir::new("whitelist");
        for bad in [
            "notes.md",
            "agents.md",           // case matters
            "AGENTS.md.bak",
            "../AGENTS.md",        // traversal
            "daily/AGENTS.md",     // subpath
            "/etc/passwd",
            ".gitignore2",
            ".git",
            "",
            "AGENTS.md\0",
        ] {
            let write = write_forge_root_file_in(tmp.path(), bad, "x", true);
            assert!(write.is_err(), "write accepted disallowed name: {:?}", bad);
            assert_ne!(write.unwrap_err(), ERR_EXISTS);
            assert!(
                read_forge_root_file_in(tmp.path(), bad).is_err(),
                "read accepted disallowed name: {:?}",
                bad
            );
            // Nothing may have been created anywhere under the temp dir.
            assert!(fs::read_dir(tmp.path()).unwrap().next().is_none());
        }
    }

    #[test]
    fn whitelist_accepts_agents_md_and_gitignore() {
        let tmp = TempDir::new("allowed");
        for good in ROOT_FILE_WHITELIST {
            let path = write_forge_root_file_in(tmp.path(), good, "content", false).unwrap();
            assert!(Path::new(&path).exists());
        }
    }

    #[test]
    fn existing_file_without_overwrite_returns_distinct_exists_error() {
        let tmp = TempDir::new("no-overwrite");
        write_forge_root_file_in(tmp.path(), "AGENTS.md", "first", false).unwrap();
        let err = write_forge_root_file_in(tmp.path(), "AGENTS.md", "second", false).unwrap_err();
        assert_eq!(err, ERR_EXISTS);
        // Original content untouched.
        assert_eq!(
            read_forge_root_file_in(tmp.path(), "AGENTS.md").unwrap(),
            Some("first".to_string())
        );
    }

    #[test]
    fn overwrite_true_replaces_existing_content() {
        let tmp = TempDir::new("overwrite");
        write_forge_root_file_in(tmp.path(), ".gitignore", "old", false).unwrap();
        write_forge_root_file_in(tmp.path(), ".gitignore", "new", true).unwrap();
        assert_eq!(
            read_forge_root_file_in(tmp.path(), ".gitignore").unwrap(),
            Some("new".to_string())
        );
    }

    #[test]
    fn content_round_trips_including_unicode() {
        let tmp = TempDir::new("roundtrip");
        let content = "# AGENTS.md\n\nCafé notes — 日本語 ✅\n\n- `daily/2026-07-12.md`\n";
        write_forge_root_file_in(tmp.path(), "AGENTS.md", content, false).unwrap();
        assert_eq!(
            read_forge_root_file_in(tmp.path(), "AGENTS.md").unwrap(),
            Some(content.to_string())
        );
    }

    #[test]
    fn read_missing_file_returns_none() {
        let tmp = TempDir::new("missing");
        assert_eq!(read_forge_root_file_in(tmp.path(), "AGENTS.md").unwrap(), None);
    }

    #[test]
    fn oversized_content_is_rejected() {
        let tmp = TempDir::new("oversize");
        let big = "x".repeat(MAX_ROOT_FILE_BYTES + 1);
        assert!(write_forge_root_file_in(tmp.path(), "AGENTS.md", &big, true).is_err());
        assert!(!tmp.path().join("AGENTS.md").exists());
    }

    #[test]
    fn written_file_is_world_readable() {
        // Agent-facing files must be readable by external tools.
        let tmp = TempDir::new("mode");
        write_forge_root_file_in(tmp.path(), "AGENTS.md", "hi", false).unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mode = fs::metadata(tmp.path().join("AGENTS.md"))
                .unwrap()
                .permissions()
                .mode()
                & 0o777;
            assert_eq!(mode, 0o644);
        }
    }
}

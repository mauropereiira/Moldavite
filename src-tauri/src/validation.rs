//! Trust-boundary validation for every user- or client-supplied filesystem path.
//!
//! Bare note names, Forge-relative note paths, in-Forge destinations, and
//! user-selected absolute export paths have distinct threat models and must use
//! the matching validator. Checks reject traversal, hidden/internal paths,
//! symlink redirection, and writes into sensitive system or home directories;
//! validation must happen before any filesystem mutation.

use std::fs;
use std::path::Path;

/// Accept only one non-empty filename component with no traversal or NUL bytes.
pub(crate) fn is_safe_filename(filename: &str) -> bool {
    // Reject empty filenames
    if filename.is_empty() {
        return false;
    }

    // Reject path traversal attempts
    if filename.contains("..") {
        return false;
    }

    // Reject absolute paths
    if filename.starts_with('/') || filename.starts_with('\\') {
        return false;
    }

    // Reject paths with directory separators
    if filename.contains('/') || filename.contains('\\') {
        return false;
    }

    // Reject null bytes
    if filename.contains('\0') {
        return false;
    }

    true
}

/// Accept a visible slash-separated path relative to the standalone notes root.
///
/// Each component must be non-empty and non-hidden; backslashes, absolute paths,
/// NUL bytes, and `..` components are rejected so internal trees and atomic
/// temporary files cannot be addressed.
pub(crate) fn is_safe_note_path(path: &str) -> bool {
    if path.is_empty() || path.contains('\0') || path.contains('\\') || path.starts_with('/') {
        return false;
    }
    path.split('/')
        .all(|part| !part.is_empty() && !part.starts_with('.'))
}

/// Require an existing destination parent inside `base_dir` with no symlink hop.
///
/// Canonical containment blocks lexical traversal, while the component walk
/// rejects pre-positioned symlinks even when their current target resolves back
/// inside the base.
pub(crate) fn validate_path_within_base(dest_path: &Path, base_dir: &Path) -> Result<(), String> {
    let canonical_base = base_dir
        .canonicalize()
        .map_err(|_| "Base directory does not exist".to_string())?;

    let parent = dest_path
        .parent()
        .ok_or_else(|| "Invalid destination path".to_string())?;

    let canonical_parent = parent
        .canonicalize()
        .map_err(|_| "Destination directory does not exist".to_string())?;

    if !canonical_parent.starts_with(&canonical_base) {
        return Err("Path traversal attempt detected".to_string());
    }

    // Walk the non-canonicalized parent walk-back, rejecting any symlink component
    // that sits at or below `base_dir`. This closes the gap where canonicalize()
    // silently follows a symlink that points inside the base (still resolving to a
    // valid prefix) but whose link target sits outside of it after later operations.
    let mut cursor = parent.to_path_buf();
    while cursor.starts_with(base_dir) || cursor == base_dir {
        if let Ok(meta) = fs::symlink_metadata(&cursor) {
            if meta.file_type().is_symlink() {
                return Err("Refusing to traverse a symlink".to_string());
            }
        }
        if !cursor.pop() {
            break;
        }
    }

    Ok(())
}

/// Accept an absolute export file path with the required extension outside protected locations.
///
/// The parent must already exist; system trees, security-sensitive home
/// subdirectories, and dotfiles are denied even though the user chose the path.
pub(crate) fn validate_user_export_path(path: &Path, required_ext: &str) -> Result<(), String> {
    if !path.is_absolute() {
        return Err("Path must be absolute".to_string());
    }
    let ext_ok = path
        .extension()
        .and_then(|s| s.to_str())
        .is_some_and(|e| e.eq_ignore_ascii_case(required_ext));
    if !ext_ok {
        return Err(format!(
            "Only .{} files may be written via this command",
            required_ext
        ));
    }
    let parent = path
        .parent()
        .ok_or_else(|| "Invalid destination path".to_string())?;
    let canonical_parent = parent
        .canonicalize()
        .map_err(|_| "Destination directory does not exist".to_string())?;
    let canonical_str = canonical_parent.to_string_lossy().to_lowercase();
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
    if let Some(name) = path.file_name().and_then(|s| s.to_str()) {
        if name.starts_with('.') {
            return Err("Refusing to write a dotfile".to_string());
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    /// Build a throwaway directory under Cargo's writable target directory.
    /// `temp_dir()` is intentionally rejected by export validation on macOS,
    /// while sandboxed test runners may not allow writes directly under HOME.
    fn tmp_dir(tag: &str) -> PathBuf {
        let base = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("target")
            .join(format!(
                "moldavite-validation-test-{}-{}",
                tag,
                std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .unwrap()
                    .as_nanos()
            ));
        fs::create_dir_all(&base).unwrap();
        base
    }

    #[test]
    fn user_export_path_accepts_valid_target() {
        let dir = tmp_dir("valid");
        let dest = dir.join("export.json");
        assert!(validate_user_export_path(&dest, "json").is_ok());
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn user_export_path_rejects_relative_path() {
        let err = validate_user_export_path(Path::new("relative.json"), "json");
        assert!(err.is_err(), "relative path must be rejected");
    }

    #[test]
    fn user_export_path_rejects_wrong_extension() {
        let dir = tmp_dir("wrong-ext");
        let dest = dir.join("export.txt");
        let err = validate_user_export_path(&dest, "json");
        assert!(err.is_err(), "wrong extension must be rejected");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn user_export_path_rejects_missing_parent() {
        let dir = tmp_dir("missing-parent");
        let dest = dir.join("does-not-exist").join("out.json");
        let err = validate_user_export_path(&dest, "json");
        assert!(err.is_err(), "missing parent must be rejected");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn user_export_path_rejects_dotfile() {
        let dir = tmp_dir("dotfile");
        let dest = dir.join(".hidden.json");
        let err = validate_user_export_path(&dest, "json");
        assert!(err.is_err(), "dotfile target must be rejected");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn user_export_path_accepts_case_insensitive_extension() {
        let dir = tmp_dir("upper-ext");
        let dest = dir.join("export.JSON");
        assert!(validate_user_export_path(&dest, "json").is_ok());
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn safe_note_path_accepts_bare_and_folder_relative_names() {
        assert!(is_safe_note_path("foo.md"));
        assert!(is_safe_note_path("Projects/foo.md"));
        assert!(is_safe_note_path("a/b/c.md"));
        assert!(is_safe_note_path("café notes.md"));
    }

    #[test]
    fn safe_note_path_rejects_traversal_and_hidden_components() {
        assert!(!is_safe_note_path(""));
        assert!(!is_safe_note_path("../evil.md"));
        assert!(!is_safe_note_path("a/../evil.md"));
        assert!(!is_safe_note_path("/abs.md"));
        assert!(!is_safe_note_path("a//b.md"));
        assert!(!is_safe_note_path("a/b.md/"));
        assert!(!is_safe_note_path(".trash/x.md"));
        assert!(!is_safe_note_path("a/.hidden.md"));
        assert!(!is_safe_note_path("a\\b.md"));
        assert!(!is_safe_note_path("a/b\0.md"));
    }
}

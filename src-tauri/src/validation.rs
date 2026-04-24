//! Filename and path validation helpers.

use std::fs;
use std::path::Path;

/// Validates that a filename is safe (no path traversal, no absolute paths)
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

/// Validates that a destination path is within the expected base directory.
/// Also rejects any path component along the way that is itself a symlink,
/// so pre-placed symlinks inside `base_dir` cannot be used to redirect writes
/// outside the canonicalized base.
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

/// Validate that `path` is a safe absolute destination for a user-chosen
/// export file with the given extension. Shared by settings JSON export.
pub(crate) fn validate_user_export_path(path: &Path, required_ext: &str) -> Result<(), String> {
    if !path.is_absolute() {
        return Err("Path must be absolute".to_string());
    }
    let ext_ok = path
        .extension()
        .and_then(|s| s.to_str())
        .is_some_and(|e| e.eq_ignore_ascii_case(required_ext));
    if !ext_ok {
        return Err(format!("Only .{} files may be written via this command", required_ext));
    }
    let parent = path
        .parent()
        .ok_or_else(|| "Invalid destination path".to_string())?;
    let canonical_parent = parent
        .canonicalize()
        .map_err(|_| "Destination directory does not exist".to_string())?;
    let canonical_str = canonical_parent.to_string_lossy().to_lowercase();
    let forbidden_prefixes = [
        "/system", "/usr", "/bin", "/sbin", "/etc", "/var", "/private/var", "/library",
    ];
    for prefix in &forbidden_prefixes {
        if canonical_str.starts_with(prefix) {
            return Err("Cannot write to system directories".to_string());
        }
    }
    if let Some(home) = dirs::home_dir() {
        if let Ok(home_canon) = home.canonicalize() {
            let forbidden_subpaths = [
                ".ssh", ".gnupg", ".aws", ".config", ".docker", ".kube",
                "Library/LaunchAgents", "Library/LaunchDaemons",
                "Library/Preferences", "Library/Application Support", "Library/Keychains",
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

    /// Build a throwaway directory under the user's home dir.
    ///
    /// We can't use `std::env::temp_dir()` here because on macOS that
    /// lives under `/private/var/...`, which `validate_user_export_path`
    /// correctly rejects as a system path. Home-relative dirs aren't on
    /// the forbidden list (as long as they don't live in `.ssh`, `.config`,
    /// `Library/LaunchAgents`, etc.), so they exercise the happy path.
    fn tmp_dir(tag: &str) -> PathBuf {
        let home = dirs::home_dir().expect("home dir required for these tests");
        let base = home.join(format!(
            ".moldavite-validation-test-{}-{}",
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
}

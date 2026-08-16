//! Trust-boundary validation for every user- or client-supplied filesystem path.
//!
//! Bare note names, Forge-relative note paths, in-Forge destinations, and
//! user-selected absolute export paths have distinct threat models and must use
//! the matching validator. Checks reject traversal, hidden/internal paths,
//! symlink redirection, and writes into sensitive system or home directories;
//! validation must happen before any filesystem mutation.

use std::fs;
use std::path::Path;

/// Portable cap used by the Obsidian importer and all interactive name checks.
pub(crate) const MAX_PORTABLE_FILENAME_LENGTH: usize = 180;

/// Return whether a filename stem is a reserved Windows device name.
///
/// Keep this rule platform-independent. A Forge created or synced on another
/// platform must remain usable when it is later opened on Windows.
pub(crate) fn is_windows_reserved(stem: &str) -> bool {
    let upper = stem.to_ascii_uppercase();
    if matches!(upper.as_str(), "CON" | "PRN" | "AUX" | "NUL") {
        return true;
    }

    let bytes = upper.as_bytes();
    bytes.len() == 4 && matches!(&bytes[..3], b"COM" | b"LPT") && matches!(bytes[3], b'1'..=b'9')
}

/// Windows reserves device names before the first extension, including names
/// with multiple extensions such as `NUL.tar.gz`.
fn has_windows_reserved_stem(filename: &str) -> bool {
    is_windows_reserved(filename.split('.').next().unwrap_or(filename))
}

/// Apply the importer's established path-segment normalization rules.
fn normalized_path_segment(raw: &str) -> String {
    let mut sanitized = String::with_capacity(raw.len());
    for character in raw.trim().chars() {
        if character.is_control()
            || matches!(
                character,
                '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|'
            )
        {
            sanitized.push('-');
        } else {
            sanitized.push(character);
        }
    }
    while sanitized.contains("..") {
        sanitized = sanitized.replace("..", "-");
    }
    sanitized.trim().trim_matches('.').trim().to_string()
}

/// Sanitize one imported path segment with the importer's established
/// replacement, trimming, fallback, and length behavior. Portable validation
/// additionally sends Windows device stems through the existing fallback.
pub(crate) fn sanitize_path_segment(raw: &str, fallback: &str) -> String {
    let normalized = normalized_path_segment(raw);
    let mut sanitized = if normalized.is_empty() {
        fallback.to_string()
    } else {
        normalized
    };
    if sanitized.chars().count() > MAX_PORTABLE_FILENAME_LENGTH {
        sanitized = sanitized
            .chars()
            .take(MAX_PORTABLE_FILENAME_LENGTH)
            .collect();
    }
    if !is_safe_filename(&sanitized) {
        fallback.to_string()
    } else {
        sanitized
    }
}

/// Reject a Windows drive prefix at the start of an otherwise relative path.
fn has_windows_drive_prefix(path: &str) -> bool {
    let bytes = path.as_bytes();
    bytes.len() >= 2 && bytes[0].is_ascii_alphabetic() && bytes[1] == b':'
}

/// Accept the lexical shape shared by relative note paths and ZIP entry names.
pub(crate) fn has_safe_relative_path_syntax(path: &str) -> bool {
    !path.is_empty()
        && !path.contains('\0')
        && !path.contains('\\')
        && !path.starts_with('/')
        && !has_windows_drive_prefix(path)
}

/// Accept one existing filename component without applying newer portability rules.
///
/// Use this only to address a path that came from a trusted on-disk listing. It
/// deliberately keeps legacy macOS names containing `:` or trailing dots usable.
pub(crate) fn is_safe_existing_filename(filename: &str) -> bool {
    !filename.is_empty()
        && !matches!(filename, "." | "..")
        && !filename.starts_with('/')
        && !filename.starts_with('\\')
        && !filename.contains('/')
        && !filename.contains('\\')
        && !filename.contains('\0')
        && !has_windows_drive_prefix(filename)
}

/// Accept one new portable filename component.
pub(crate) fn is_safe_filename(filename: &str) -> bool {
    is_safe_existing_filename(filename)
        && normalized_path_segment(filename) == filename
        && filename
            .split('.')
            .next()
            .is_some_and(|stem| stem.chars().count() <= MAX_PORTABLE_FILENAME_LENGTH)
        && !has_windows_reserved_stem(filename)
}

/// Accept an existing visible slash-separated path without applying newer
/// portability rules to its components.
///
/// This is only for reading, deleting, or moving paths obtained from an on-disk
/// listing. New destinations must use [`is_safe_note_path`].
pub(crate) fn is_safe_existing_note_path(path: &str) -> bool {
    has_safe_relative_path_syntax(path)
        && path
            .split('/')
            .all(|part| !part.is_empty() && !part.starts_with('.'))
}

/// Accept a visible slash-separated path relative to the standalone notes root.
///
/// Each component must be non-empty, non-hidden, and portable to Windows;
/// backslashes, absolute paths, drive letters, NUL bytes, and `..` components
/// are rejected so internal trees and atomic temporary files cannot be addressed.
pub(crate) fn is_safe_note_path(path: &str) -> bool {
    is_safe_existing_note_path(path) && path.split('/').all(is_safe_filename)
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

    // The destination itself may not exist yet (writes and atomic renames), but
    // an existing leaf must never be a symlink because reads would follow it.
    if let Ok(meta) = fs::symlink_metadata(dest_path) {
        if meta.file_type().is_symlink() {
            return Err("Refusing to traverse a symlink".to_string());
        }
    }

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

/// Compare Windows paths case-insensitively with a component boundary.
///
/// This stays available on every platform so the Windows blocklist logic can
/// be unit-tested without relying on a Windows filesystem.
#[cfg(any(windows, test))]
fn windows_path_is_within(path: &Path, protected: &Path) -> bool {
    fn normalize(path: &Path) -> String {
        let normalized = path.to_string_lossy().replace('\\', "/").to_lowercase();
        normalized
            .strip_prefix("//?/")
            .unwrap_or(&normalized)
            .trim_end_matches('/')
            .to_string()
    }

    let path = normalize(path);
    let protected = normalize(protected);
    if protected.is_empty() {
        return false;
    }
    path == protected
        || path
            .strip_prefix(&protected)
            .is_some_and(|suffix| suffix.starts_with('/'))
}

#[cfg(windows)]
fn windows_protected_export_paths() -> Vec<std::path::PathBuf> {
    let mut paths: Vec<std::path::PathBuf> = [
        "SystemRoot",
        "ProgramFiles",
        "ProgramFiles(x86)",
        "ProgramW6432",
    ]
    .iter()
    .filter_map(std::env::var_os)
    .filter(|value| !value.is_empty())
    .map(std::path::PathBuf::from)
    .collect();

    if let Some(app_data) = std::env::var_os("APPDATA").filter(|value| !value.is_empty()) {
        paths.push(
            std::path::PathBuf::from(app_data)
                .join("Microsoft/Windows/Start Menu/Programs/Startup"),
        );
    }

    paths
        .into_iter()
        .map(|path| path.canonicalize().unwrap_or(path))
        .collect()
}

fn path_is_within(path: &Path, protected: &Path) -> bool {
    #[cfg(windows)]
    {
        windows_path_is_within(path, protected)
    }
    #[cfg(not(windows))]
    {
        path.starts_with(protected)
    }
}

/// Accept an absolute export file path with the required extension outside protected locations.
///
/// The parent must already exist; system trees, security-sensitive home
/// subdirectories, and dotfiles are denied even though the user chose the path.
pub(crate) fn validate_user_export_path(path: &Path, required_ext: &str) -> Result<(), String> {
    if !path.is_absolute() {
        return Err("Path must be absolute".to_string());
    }
    match fs::symlink_metadata(path) {
        Ok(metadata) if metadata.file_type().is_symlink() => {
            return Err("Refusing to write through a symlink".to_string())
        }
        Ok(_) => {}
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(error) => return Err(format!("Failed to inspect export destination: {error}")),
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
    #[cfg(windows)]
    {
        if windows_protected_export_paths()
            .iter()
            .any(|protected| windows_path_is_within(&canonical_parent, protected))
        {
            return Err("Cannot write into a protected directory".to_string());
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
                if path_is_within(&canonical_parent, &denied) {
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

    #[cfg(unix)]
    #[test]
    fn security_regression_user_export_path_rejects_symlink_leaf() {
        use std::os::unix::fs::symlink;

        let dir = tmp_dir("export-symlink-leaf");
        let protected = dir.join("protected.json");
        let destination = dir.join("export.json");
        fs::write(&protected, "must survive").unwrap();
        symlink(&protected, &destination).unwrap();

        assert!(validate_user_export_path(&destination, "json").is_err());
        assert_eq!(fs::read_to_string(&protected).unwrap(), "must survive");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn windows_reserved_names_are_case_insensitive_and_bounded() {
        for stem in ["CON", "prn", "Aux", "nul", "COM1", "com9", "LPT1", "lpt9"] {
            assert!(is_windows_reserved(stem), "{stem} must be reserved");
        }
        for stem in ["CONSOLE", "COM", "COM0", "COM10", "LPT0", "LPT10", "NULLED"] {
            assert!(!is_windows_reserved(stem), "{stem} must remain valid");
        }

        assert!(!is_safe_filename("NUL"));
        assert!(!is_safe_filename("nul.md"));
        assert!(!is_safe_filename("COM1.tar.gz"));
        assert!(is_safe_filename("COM10.md"));
        assert!(is_safe_filename(&format!(
            "{}.md",
            "a".repeat(MAX_PORTABLE_FILENAME_LENGTH)
        )));
    }

    #[test]
    fn shared_path_segment_sanitizer_keeps_import_rules() {
        assert_eq!(
            sanitize_path_segment("  Q3: Roadmap.  ", "Untitled"),
            "Q3- Roadmap"
        );
        assert_eq!(
            sanitize_path_segment("..bad\\name\u{7}", "Untitled"),
            "-bad-name-"
        );
        assert_eq!(sanitize_path_segment(".", "Untitled"), "Untitled");
        assert_eq!(sanitize_path_segment("NUL", "Untitled"), "Untitled");
        assert_eq!(sanitize_path_segment("COM1", "Attachment"), "Attachment");

        let overlong = "é".repeat(MAX_PORTABLE_FILENAME_LENGTH + 1);
        let sanitized = sanitize_path_segment(&overlong, "Untitled");
        assert_eq!(sanitized.chars().count(), MAX_PORTABLE_FILENAME_LENGTH);
        assert_eq!(sanitized, "é".repeat(MAX_PORTABLE_FILENAME_LENGTH));
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

    #[test]
    fn safe_note_path_rejects_drive_letters_and_nonportable_components() {
        assert!(!has_safe_relative_path_syntax("C:/x.md"));
        assert!(!has_safe_relative_path_syntax("z:notes/x.md"));
        assert!(!is_safe_note_path("C:/x.md"));
        assert!(!is_safe_note_path("Q3: Roadmap.md"));
        assert!(!is_safe_note_path("Reports./x.md"));
        assert!(!is_safe_note_path("Projects/NUL.md"));
        assert!(is_safe_note_path("Drive C/roadmap.md"));
    }

    #[test]
    fn existing_path_validation_keeps_legacy_names_addressable() {
        assert!(is_safe_existing_filename("Q3: Roadmap.md"));
        assert!(is_safe_existing_filename("Reports..md"));
        assert!(is_safe_existing_note_path("Q3: Roadmap.md"));
        assert!(is_safe_existing_note_path("Reports./x.md"));
        assert!(!is_safe_existing_note_path("C:/x.md"));
        assert!(!is_safe_existing_note_path("../x.md"));
    }

    #[test]
    fn windows_export_blocklist_is_case_insensitive_and_component_aware() {
        let protected = [
            PathBuf::from(r"C:\Windows"),
            PathBuf::from(r"C:\Program Files"),
            PathBuf::from(
                r"C:\Users\Test\AppData\Roaming\Microsoft\Windows\Start Menu\Programs\Startup",
            ),
        ];

        assert!(windows_path_is_within(
            Path::new(r"c:\WINDOWS\System32"),
            &protected[0]
        ));
        assert!(windows_path_is_within(
            Path::new(r"C:\PROGRAM FILES\Moldavite"),
            &protected[1]
        ));
        assert!(windows_path_is_within(
            Path::new(
                r"C:\Users\Test\AppData\Roaming\Microsoft\Windows\Start Menu\Programs\Startup",
            ),
            &protected[2]
        ));
        assert!(!windows_path_is_within(
            Path::new(r"C:\Windows.old"),
            &protected[0]
        ));
        assert!(!windows_path_is_within(
            Path::new(r"C:\Program Files Backup\Moldavite"),
            &protected[1]
        ));
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn user_export_path_rejects_actual_windows_system_root() {
        let system_root = std::env::var_os("SystemRoot")
            .map(PathBuf::from)
            .expect("Windows test runner must define SystemRoot");
        let destination = system_root.join("moldavite-validation-test.json");
        let error = validate_user_export_path(&destination, "json").unwrap_err();
        assert!(error.contains("protected"));
    }

    #[cfg(unix)]
    #[test]
    fn user_export_path_rejects_unix_system_prefix() {
        let error =
            validate_user_export_path(Path::new("/usr/moldavite-validation-test.json"), "json")
                .unwrap_err();
        assert!(error.contains("system directories"));
    }

    #[cfg(unix)]
    #[test]
    fn path_within_base_rejects_symlink_leaf_and_accepts_regular_or_missing_leaf() {
        use std::os::unix::fs::symlink;

        let dir = tmp_dir("symlink-leaf");
        let outside = dir.parent().unwrap().join(format!(
            "{}-outside",
            dir.file_name().unwrap().to_string_lossy()
        ));
        fs::write(&outside, "secret").unwrap();

        let link = dir.join("leak.md");
        symlink(&outside, &link).unwrap();
        assert!(validate_path_within_base(&link, &dir).is_err());

        let regular = dir.join("regular.md");
        fs::write(&regular, "note").unwrap();
        assert!(validate_path_within_base(&regular, &dir).is_ok());
        assert!(validate_path_within_base(&dir.join("new.md"), &dir).is_ok());

        let _ = fs::remove_dir_all(&dir);
        let _ = fs::remove_file(&outside);
    }
}

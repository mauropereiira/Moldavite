//! One-shot migration from sidecar `.note-metadata.json` colors to per-file
//! YAML frontmatter.
//!
//! Idempotent: after running, the JSON file is renamed to
//! `.note-metadata.json.migrated` so subsequent runs are no-ops. Safe to call
//! on every app start.

use std::fs;
use std::path::{Path, PathBuf};

use serde::Deserialize;

use crate::frontmatter;
use crate::paths::{get_metadata_path, get_notes_dir};

#[derive(Debug, Default, Deserialize)]
struct MetadataFile {
    #[serde(default)]
    colors: std::collections::HashMap<String, String>,
}

/// Resolve a `notePath` (e.g. `daily/2024-01-01.md`, `notes/foo.md`,
/// `notes/sub/bar.md`) to an absolute on-disk path under the configured
/// Forge directory.
fn resolve_note_path(notes_dir: &Path, note_path: &str) -> Option<PathBuf> {
    // Reject anything that tries to escape the notes_dir.
    if note_path.contains("..") || note_path.starts_with('/') || note_path.contains('\0') {
        return None;
    }
    Some(notes_dir.join(note_path))
}

/// Run the migration. Returns the number of notes that had a color stamped
/// into their frontmatter. Errors during individual files are logged but do
/// not abort the whole migration.
pub fn migrate_metadata_to_frontmatter() -> Result<u32, String> {
    let metadata_path = get_metadata_path();
    if !metadata_path.exists() {
        return Ok(0);
    }

    let raw = match fs::read_to_string(&metadata_path) {
        Ok(s) => s,
        Err(e) => {
            log::warn!("[forge migration] could not read {:?}: {}", metadata_path, e);
            return Ok(0);
        }
    };
    let meta: MetadataFile = match serde_json::from_str(&raw) {
        Ok(m) => m,
        Err(e) => {
            log::warn!("[forge migration] malformed metadata json: {}", e);
            // Still rename so we don't keep retrying on every boot.
            let _ = fs::rename(&metadata_path, metadata_path.with_extension("json.migrated"));
            return Ok(0);
        }
    };

    let notes_dir = get_notes_dir();
    let mut migrated = 0u32;

    for (note_path, color) in &meta.colors {
        let Some(abs) = resolve_note_path(&notes_dir, note_path) else {
            log::warn!("[forge migration] skipping unsafe path: {}", note_path);
            continue;
        };
        if !abs.exists() {
            log::info!(
                "[forge migration] note no longer exists, skipping: {}",
                note_path
            );
            continue;
        }
        // Don't touch encrypted files.
        if abs
            .file_name()
            .and_then(|f| f.to_str())
            .is_some_and(|n| n.ends_with(".md.locked"))
        {
            continue;
        }
        let existing = match fs::read_to_string(&abs) {
            Ok(s) => s,
            Err(e) => {
                log::warn!("[forge migration] read failed for {}: {}", note_path, e);
                continue;
            }
        };
        // If frontmatter already carries a color, leave it alone.
        let parsed = frontmatter::parse_note(&existing);
        if parsed.color.is_some() {
            continue;
        }
        let new_content = frontmatter::write_with_color(&existing, Some(color), &parsed.body);
        if let Err(e) = fs::write(&abs, new_content) {
            log::warn!("[forge migration] write failed for {}: {}", note_path, e);
            continue;
        }
        migrated += 1;
        log::info!(
            "[forge migration] stamped color={} into {}",
            color,
            note_path
        );
    }

    // Rename the JSON so the migration is idempotent. Keep the `.migrated`
    // suffix as a breadcrumb so users (or a recovery script) can find the
    // original payload if something went wrong.
    let renamed = metadata_path.with_extension("json.migrated");
    if let Err(e) = fs::rename(&metadata_path, &renamed) {
        log::warn!(
            "[forge migration] could not rename metadata file: {}",
            e
        );
    }

    Ok(migrated)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resolve_rejects_traversal() {
        let base = PathBuf::from("/tmp/forge");
        assert!(resolve_note_path(&base, "../etc/passwd").is_none());
        assert!(resolve_note_path(&base, "/etc/passwd").is_none());
        assert!(resolve_note_path(&base, "notes/foo\0.md").is_none());
    }

    #[test]
    fn resolve_accepts_normal_paths() {
        let base = PathBuf::from("/tmp/forge");
        assert_eq!(
            resolve_note_path(&base, "notes/foo.md"),
            Some(base.join("notes/foo.md"))
        );
        assert_eq!(
            resolve_note_path(&base, "daily/2024-01-01.md"),
            Some(base.join("daily/2024-01-01.md"))
        );
    }
}

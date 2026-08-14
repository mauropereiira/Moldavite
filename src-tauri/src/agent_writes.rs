//! Best-effort attribution markers for note writes made through MCP.
//!
//! Markers live beside app configuration rather than inside a Forge, so they
//! cannot trigger Forge watcher events or become user notes. Each write owns a
//! separate, owner-only file: concurrent MCP processes never rewrite shared
//! marker state, and a failed note write can remove only its own marker.

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};

use crate::commands::notes::sha256_hex;
use crate::persist::write_atomic;
use crate::validation::{is_safe_existing_filename, is_safe_existing_note_path};

const MARKER_TTL_MS: u64 = 60_000;
const MAX_MARKER_BYTES: u64 = 16 * 1024;
const MAX_CLIENT_CHARS: usize = 200;

static MARKER_COUNTER: AtomicU64 = AtomicU64::new(0);

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AgentWriteInfo {
    pub(crate) client: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AgentWriteMarker {
    forge_root: String,
    rel_path: String,
    content_hash: String,
    written_at_ms: u64,
    client: Option<String>,
}

/// Resolve the global marker spool without depending on an initialized Tauri app.
/// `None` is a normal outcome on platforms where no config directory is available.
pub(crate) fn spool_dir() -> Option<PathBuf> {
    dirs::config_dir().map(|dir| dir.join("Moldavite").join("agent-writes"))
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
        .try_into()
        .unwrap_or(u64::MAX)
}

fn marker_filename() -> String {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    let counter = MARKER_COUNTER.fetch_add(1, Ordering::Relaxed);
    format!("{nanos:x}-{:x}-{counter:x}.json", std::process::id())
}

fn normalized_client(client: Option<&str>) -> Option<String> {
    client
        .map(str::trim)
        .filter(|name| !name.is_empty())
        .map(|name| name.chars().take(MAX_CLIENT_CHARS).collect())
}

fn valid_rel_path(rel_path: &str) -> bool {
    let Some((top, rest)) = rel_path.split_once('/') else {
        return false;
    };
    if !rest.ends_with(".md") {
        return false;
    }
    match top {
        "notes" => is_safe_existing_note_path(rest),
        "daily" | "weekly" => is_safe_existing_filename(rest),
        _ => false,
    }
}

fn valid_content_hash(content_hash: &str) -> bool {
    content_hash.len() == 64 && content_hash.bytes().all(|byte| byte.is_ascii_hexdigit())
}

fn ensure_spool_dir(path: &Path) -> Result<(), String> {
    match fs::symlink_metadata(path) {
        Ok(metadata) if metadata.file_type().is_symlink() => {
            return Err("Refusing a symlinked agent-write spool".to_string());
        }
        Ok(metadata) if !metadata.is_dir() => {
            return Err("Agent-write spool is not a directory".to_string());
        }
        Ok(_) => {}
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            fs::create_dir_all(path)
                .map_err(|error| format!("Failed to create agent-write spool: {error}"))?;
        }
        Err(error) => return Err(format!("Failed to inspect agent-write spool: {error}")),
    }

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(path, fs::Permissions::from_mode(0o700))
            .map_err(|error| format!("Failed to secure agent-write spool: {error}"))?;
    }
    Ok(())
}

fn marker_path(entry: &fs::DirEntry) -> Option<PathBuf> {
    let path = entry.path();
    if path.extension().and_then(|extension| extension.to_str()) != Some("json") {
        return None;
    }
    let metadata = fs::symlink_metadata(&path).ok()?;
    if !metadata.is_file() || metadata.len() > MAX_MARKER_BYTES {
        if metadata.is_file() {
            let _ = fs::remove_file(&path);
        }
        return None;
    }
    Some(path)
}

fn marker_is_valid(marker: &AgentWriteMarker) -> bool {
    !marker.forge_root.is_empty()
        && valid_rel_path(&marker.rel_path)
        && valid_content_hash(&marker.content_hash)
        && match marker.client.as_ref() {
            Some(client) => !client.is_empty() && client.chars().count() <= MAX_CLIENT_CHARS,
            None => true,
        }
}

fn read_marker(path: &Path) -> Option<AgentWriteMarker> {
    let raw = match fs::read_to_string(path) {
        Ok(raw) => raw,
        Err(_) => {
            let _ = fs::remove_file(path);
            return None;
        }
    };
    match serde_json::from_str::<AgentWriteMarker>(&raw) {
        Ok(marker) if marker_is_valid(&marker) => Some(marker),
        _ => {
            let _ = fs::remove_file(path);
            None
        }
    }
}

fn prune_spool_at(spool: &Path, current_ms: u64) {
    let Ok(entries) = fs::read_dir(spool) else {
        return;
    };
    for entry in entries.flatten() {
        let Some(path) = marker_path(&entry) else {
            continue;
        };
        let Some(marker) = read_marker(&path) else {
            continue;
        };
        if current_ms.saturating_sub(marker.written_at_ms) > MARKER_TTL_MS {
            let _ = fs::remove_file(path);
        }
    }
}

fn record_marker_at(
    spool: &Path,
    forge_root: &Path,
    rel_path: &str,
    raw_content: &str,
    client: Option<&str>,
    written_at_ms: u64,
) -> Result<PathBuf, String> {
    if !valid_rel_path(rel_path) {
        return Err("Invalid agent-write note path".to_string());
    }
    ensure_spool_dir(spool)?;
    // MCP can outlive the window, so writes also opportunistically remove stale
    // markers rather than relying only on frontend consumption to clean the spool.
    prune_spool_at(spool, written_at_ms);

    let body = crate::frontmatter::parse_note(raw_content).body;
    let marker = AgentWriteMarker {
        forge_root: forge_root.to_string_lossy().into_owned(),
        rel_path: rel_path.to_string(),
        content_hash: sha256_hex(&body),
        written_at_ms,
        client: normalized_client(client),
    };
    let json = serde_json::to_vec(&marker)
        .map_err(|error| format!("Failed to encode agent-write marker: {error}"))?;
    let path = spool.join(marker_filename());
    write_atomic(&path, &json, Some(0o600))?;
    Ok(path)
}

/// Run one note write after creating its attribution marker. Marker creation is
/// deliberately best-effort, while a failed note write removes the marker before
/// returning the original write error. This ordering is part of the watcher contract.
pub(crate) fn write_with_marker_at<T, F>(
    spool: &Path,
    forge_root: &Path,
    rel_path: &str,
    raw_content: &str,
    client: Option<&str>,
    write: F,
) -> Result<T, String>
where
    F: FnOnce() -> Result<T, String>,
{
    let marker = record_marker_at(spool, forge_root, rel_path, raw_content, client, now_ms()).ok();
    match write() {
        Ok(value) => Ok(value),
        Err(error) => {
            if let Some(marker) = marker {
                let _ = fs::remove_file(marker);
            }
            Err(error)
        }
    }
}

/// Consume the newest live marker for the active Forge and incoming body hash.
/// Every filesystem error degrades to `None`; attribution must never gate editing.
pub(crate) fn take_agent_write_from(
    spool: &Path,
    forge_root: &Path,
    rel_path: &str,
    content_hash: &str,
) -> Option<AgentWriteInfo> {
    take_agent_write_from_at(spool, forge_root, rel_path, content_hash, now_ms())
}

fn take_agent_write_from_at(
    spool: &Path,
    forge_root: &Path,
    rel_path: &str,
    content_hash: &str,
    current_ms: u64,
) -> Option<AgentWriteInfo> {
    if !valid_rel_path(rel_path) || !valid_content_hash(content_hash) {
        return None;
    }
    let entries = fs::read_dir(spool).ok()?;
    let forge_root = forge_root.to_string_lossy();
    let mut newest: Option<(u64, PathBuf, AgentWriteInfo)> = None;

    for entry in entries.flatten() {
        let Some(path) = marker_path(&entry) else {
            continue;
        };
        let Some(marker) = read_marker(&path) else {
            continue;
        };
        if current_ms.saturating_sub(marker.written_at_ms) > MARKER_TTL_MS {
            let _ = fs::remove_file(path);
            continue;
        }
        if marker.forge_root != forge_root
            || marker.rel_path != rel_path
            || marker.content_hash != content_hash
        {
            continue;
        }

        let replace = match newest.as_ref() {
            Some((written_at_ms, newest_path, _)) => {
                (marker.written_at_ms, &path) > (*written_at_ms, newest_path)
            }
            None => true,
        };
        if replace {
            newest = Some((
                marker.written_at_ms,
                path,
                AgentWriteInfo {
                    client: marker.client,
                },
            ));
        }
    }

    let (_, path, info) = newest?;
    fs::remove_file(path).ok()?;
    Some(info)
}

#[tauri::command]
pub(crate) fn take_agent_write(rel_path: String, content_hash: String) -> Option<AgentWriteInfo> {
    let spool = spool_dir()?;
    take_agent_write_from(
        &spool,
        &crate::paths::get_notes_dir(),
        &rel_path,
        &content_hash,
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    struct TempDir(PathBuf);

    impl TempDir {
        fn new(tag: &str) -> Self {
            let path = std::env::temp_dir().join(format!(
                "moldavite-agent-writes-{tag}-{}-{}",
                std::process::id(),
                SystemTime::now()
                    .duration_since(UNIX_EPOCH)
                    .unwrap()
                    .as_nanos()
            ));
            fs::create_dir_all(&path).unwrap();
            Self(path)
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

    fn marker_count(spool: &Path) -> usize {
        fs::read_dir(spool)
            .map(|entries| {
                entries
                    .flatten()
                    .filter(|entry| {
                        entry
                            .path()
                            .extension()
                            .and_then(|extension| extension.to_str())
                            == Some("json")
                    })
                    .count()
            })
            .unwrap_or(0)
    }

    #[test]
    fn marker_uses_parsed_body_hash_and_is_owner_only() {
        let temp = TempDir::new("body-hash");
        let spool = temp.path().join("spool");
        let forge = temp.path().join("forge");
        fs::create_dir_all(&forge).unwrap();
        let raw = "---\ncolor: blue\n---\nagent body";

        write_with_marker_at(
            &spool,
            &forge,
            "notes/example.md",
            raw,
            Some("Claude Code"),
            || Ok(()),
        )
        .unwrap();

        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let marker_path = fs::read_dir(&spool)
                .unwrap()
                .next()
                .unwrap()
                .unwrap()
                .path();
            assert_eq!(
                fs::metadata(&marker_path).unwrap().permissions().mode() & 0o777,
                0o600
            );
        }
        let info = take_agent_write_from(
            &spool,
            &forge,
            "notes/example.md",
            &sha256_hex("agent body"),
        )
        .unwrap();
        assert_eq!(info.client.as_deref(), Some("Claude Code"));
        assert_eq!(marker_count(&spool), 0);
    }

    #[test]
    fn failed_note_write_removes_its_marker() {
        let temp = TempDir::new("failed-write");
        let spool = temp.path().join("spool");
        let result = write_with_marker_at(
            &spool,
            temp.path(),
            "notes/example.md",
            "agent body",
            Some("Claude Code"),
            || Err::<(), _>("note write failed".to_string()),
        );

        assert_eq!(result, Err("note write failed".to_string()));
        assert_eq!(marker_count(&spool), 0);
    }

    #[test]
    fn take_returns_none_for_no_match_and_deletes_the_marker_it_returns() {
        let temp = TempDir::new("take-once");
        let spool = temp.path().join("spool");
        record_marker_at(
            &spool,
            temp.path(),
            "daily/2026-08-14.md",
            "agent body",
            None,
            now_ms(),
        )
        .unwrap();

        assert!(take_agent_write_from(
            &spool,
            temp.path(),
            "daily/2026-08-14.md",
            &sha256_hex("different body")
        )
        .is_none());
        assert_eq!(marker_count(&spool), 1);

        assert!(take_agent_write_from(
            &spool,
            temp.path(),
            "daily/2026-08-14.md",
            &sha256_hex("agent body")
        )
        .is_some());
        assert!(take_agent_write_from(
            &spool,
            temp.path(),
            "daily/2026-08-14.md",
            &sha256_hex("agent body")
        )
        .is_none());
    }

    #[test]
    fn take_selects_the_newest_of_two_matching_markers() {
        let temp = TempDir::new("newest");
        let spool = temp.path().join("spool");
        let current_ms = now_ms();
        record_marker_at(
            &spool,
            temp.path(),
            "notes/example.md",
            "same body",
            Some("Older Client"),
            current_ms.saturating_sub(1),
        )
        .unwrap();
        record_marker_at(
            &spool,
            temp.path(),
            "notes/example.md",
            "same body",
            Some("Newest Client"),
            current_ms,
        )
        .unwrap();

        let newest = take_agent_write_from_at(
            &spool,
            temp.path(),
            "notes/example.md",
            &sha256_hex("same body"),
            current_ms,
        )
        .unwrap();
        assert_eq!(newest.client.as_deref(), Some("Newest Client"));
        assert_eq!(marker_count(&spool), 1);
    }

    #[test]
    fn stale_markers_are_pruned_during_every_scan() {
        let temp = TempDir::new("stale");
        let spool = temp.path().join("spool");
        let current_ms = now_ms();
        record_marker_at(
            &spool,
            temp.path(),
            "weekly/2026-W33.md",
            "old body",
            None,
            current_ms.saturating_sub(MARKER_TTL_MS + 1),
        )
        .unwrap();

        assert!(take_agent_write_from_at(
            &spool,
            temp.path(),
            "weekly/2026-W33.md",
            &sha256_hex("different body"),
            current_ms
        )
        .is_none());
        assert_eq!(marker_count(&spool), 0);
    }

    #[test]
    fn malformed_and_unreadable_entries_do_not_break_a_scan() {
        let temp = TempDir::new("malformed");
        let spool = temp.path().join("spool");
        fs::create_dir_all(&spool).unwrap();
        write_atomic(&spool.join("malformed.json"), b"{not json", Some(0o600)).unwrap();
        write_atomic(&spool.join("unreadable.json"), &[0xff], Some(0o600)).unwrap();
        record_marker_at(
            &spool,
            temp.path(),
            "notes/good.md",
            "good body",
            Some("Claude Code"),
            now_ms(),
        )
        .unwrap();

        let info = take_agent_write_from(
            &spool,
            temp.path(),
            "notes/good.md",
            &sha256_hex("good body"),
        )
        .unwrap();
        assert_eq!(info.client.as_deref(), Some("Claude Code"));
        assert!(!spool.join("malformed.json").exists());
    }
}

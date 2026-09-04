//! File watcher rooted at the active Forge plus its parent Forges directory.
//!
//! Emits a Tauri event `forge:changed` with `{ kind, relPath }` whenever a
//! note file is created, modified, or removed by an external process, and a
//! `forges:changed` event when a direct child Forge is added, removed, or renamed.
//!
//! Mutations performed by Moldavite itself are short-circuited when the current
//! file state still matches the content or absence recorded after the operation,
//! so the UI doesn't double-refresh after its own saves and moves. Entries are
//! short-lived hints, not durable state; paths are normalized relative to the
//! watched Forge and hidden/internal files never emit events.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use notify::RecursiveMode;
use notify_debouncer_mini::new_debouncer;
use serde::Serialize;
use tauri::{AppHandle, Emitter};

use crate::commands::notes::sha256_hex;
use crate::frontmatter;
use crate::paths::{get_forges_root, get_notes_dir};

/// Self-write entries only need to survive filesystem and debouncer latency.
/// Content equality decides suppression; this ceiling only bounds retention.
const SELF_WRITE_MAX_AGE: Duration = Duration::from_secs(30);

#[derive(Clone, Debug, Eq, PartialEq)]
enum ExpectedDiskState {
    ContentHash(String),
    Missing,
}

#[derive(Clone, Debug, Eq, PartialEq)]
struct RecentWrite {
    recorded_at: Instant,
    expected: ExpectedDiskState,
}

/// Records writes Moldavite itself initiated, keyed by absolute path.
#[derive(Debug, Default)]
pub struct RecentWrites {
    inner: Mutex<HashMap<PathBuf, RecentWrite>>,
}

impl RecentWrites {
    pub fn new() -> Self {
        Self::default()
    }

    /// Record the logical body hash written to `path`. Watcher events are
    /// suppressed only while the current on-disk body still has this hash.
    pub fn record(&self, path: &Path, content_hash: &str) {
        self.record_expected(
            path,
            ExpectedDiskState::ContentHash(content_hash.to_string()),
        );
    }

    /// Record a path Moldavite just removed or moved away from. A recreated
    /// file does not match this expectation and is emitted as an external edit.
    pub fn record_missing(&self, path: &Path) {
        self.record_expected(path, ExpectedDiskState::Missing);
    }

    fn record_expected(&self, path: &Path, expected: ExpectedDiskState) {
        if let Ok(mut map) = self.inner.lock() {
            map.insert(
                path.to_path_buf(),
                RecentWrite {
                    recorded_at: Instant::now(),
                    expected,
                },
            );
            // Opportunistic GC.
            map.retain(|_, write| write.recorded_at.elapsed() < SELF_WRITE_MAX_AGE);
        }
    }

    /// Drop all recorded recent-writes. Called when swapping the watcher
    /// root so stale entries from the previous Forge can't suppress real
    /// events in the new one.
    pub fn clear(&self) {
        if let Ok(mut map) = self.inner.lock() {
            map.clear();
        }
    }

    /// Returns true only when `path` still matches the content or absence we
    /// recorded. Read failures and mismatches evict the hint so external changes
    /// flow through instead of being hidden behind stale self-mutation state.
    pub fn matches_current_content(&self, path: &Path) -> bool {
        let recorded = {
            let Ok(mut map) = self.inner.lock() else {
                return false;
            };
            let Some(recorded) = map.get(path).cloned() else {
                return false;
            };
            if recorded.recorded_at.elapsed() >= SELF_WRITE_MAX_AGE {
                map.remove(path);
                return false;
            }
            recorded
        };

        let matches = match &recorded.expected {
            ExpectedDiskState::ContentHash(content_hash) => std::fs::read_to_string(path)
                .map(|raw| sha256_hex(&frontmatter::parse_note(&raw).body) == *content_hash)
                .unwrap_or(false),
            ExpectedDiskState::Missing => matches!(
                std::fs::metadata(path),
                Err(error) if error.kind() == std::io::ErrorKind::NotFound
            ),
        };
        if matches {
            true
        } else {
            self.evict_if_unchanged(path, &recorded);
            false
        }
    }

    fn evict_if_unchanged(&self, path: &Path, recorded: &RecentWrite) {
        if let Ok(mut map) = self.inner.lock() {
            if map.get(path) == Some(recorded) {
                map.remove(path);
            }
        }
    }
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ForgeChange {
    /// "modified" — debouncer-mini collapses create/modify/remove into one.
    /// Frontend should treat this as "something changed; re-fetch the list
    /// and the active note's content."
    pub kind: String,
    /// Path relative to the Forge root, using forward slashes.
    pub rel_path: String,
}

fn rel_path(root: &Path, abs: &Path) -> Option<String> {
    abs.strip_prefix(root).ok().map(|p| {
        p.components()
            .map(|c| c.as_os_str().to_string_lossy().to_string())
            .collect::<Vec<_>>()
            .join("/")
    })
}

fn direct_forge_name(forges_root: &Path, abs: &Path) -> Option<String> {
    let rel = abs.strip_prefix(forges_root).ok()?;
    let mut components = rel.components();
    let name = components.next()?.as_os_str().to_string_lossy();
    if components.next().is_some() || name.is_empty() || name.starts_with('.') {
        return None;
    }
    Some(name.into_owned())
}

/// Whether a path is something Moldavite cares about (a note, image, or
/// template). Filters out hidden files (`.note-metadata.json*`, `.trash/`,
/// `.DS_Store`) so we don't fire constant noise.
fn is_relevant(rel: &str) -> bool {
    if rel.is_empty() {
        return false;
    }
    let first = rel.split('/').next().unwrap_or("");
    if first.starts_with('.') {
        return false;
    }
    let last = rel.rsplit('/').next().unwrap_or("");
    if last.starts_with('.') {
        return false;
    }
    // Only notes and templates — we leave image events alone since the
    // frontend re-renders images on its own.
    last.ends_with(".md") || last.ends_with(".md.locked") || last.ends_with(".json")
}

/// Push one debounced, non-self-write filesystem event into the keyword
/// index. This is the improvement over the semantic index, which waits for
/// its next reconcile: an agent, a sync client or another editor touching a
/// file is searchable without the frontend in the loop.
///
/// `notify-debouncer-mini` collapses create, modify and remove into a single
/// "something happened here" event, so presence on disk decides which way the
/// index moves. A rename arrives as two such events — the old path now absent,
/// the new one present — and therefore needs no special case. A `.md.locked`
/// event removes the plaintext path it replaced.
fn index_external_change(root: &Path, rel: &str) {
    let rel = match rel.strip_suffix(".locked") {
        Some(plain) => plain,
        None => rel,
    };
    if !rel.ends_with(".md") {
        return;
    }
    if root.join(rel).is_file() {
        crate::search_index::note_changed_in(rel, root.to_path_buf());
    } else {
        crate::search_index::note_removed_in(rel, root.to_path_buf());
    }
}

/// Spawn a long-lived background thread that watches active-Forge contents and
/// direct children of the Forges root. Returns a guard whose Drop stops it.
pub fn spawn(app: AppHandle, recent: Arc<RecentWrites>) -> Result<WatcherHandle, String> {
    let root = get_notes_dir();
    let forges_root = get_forges_root();
    if !root.exists() {
        // Nothing to watch yet; the caller can re-spawn after dirs are made.
        log::info!("[forge watcher] root {:?} does not exist yet", root);
    }

    let app_for_thread = app.clone();
    let root_for_thread = root.clone();
    let forges_root_for_thread = forges_root.clone();
    let recent_for_thread = recent.clone();

    let (tx, rx) = std::sync::mpsc::channel();

    let mut debouncer = new_debouncer(Duration::from_millis(300), tx)
        .map_err(|e| format!("failed to create debouncer: {}", e))?;
    if root.exists() {
        debouncer
            .watcher()
            .watch(&root, RecursiveMode::Recursive)
            .map_err(|e| format!("failed to watch {:?}: {}", root, e))?;
    }
    if forges_root.exists() {
        debouncer
            .watcher()
            .watch(&forges_root, RecursiveMode::NonRecursive)
            .map_err(|e| format!("failed to watch {:?}: {}", forges_root, e))?;
    }

    let (stop_tx, stop_rx) = std::sync::mpsc::channel::<()>();

    let join = std::thread::Builder::new()
        .name("forge-watcher".into())
        .spawn(move || {
            // Hold the debouncer for the lifetime of this thread so it keeps
            // running. When the thread exits (on shutdown) it drops.
            let _debouncer = debouncer;
            loop {
                // Wake up periodically so the stop signal can break the loop
                // even when no fs events arrive.
                let events = match rx.recv_timeout(Duration::from_millis(500)) {
                    Ok(ev) => ev,
                    Err(std::sync::mpsc::RecvTimeoutError::Timeout) => {
                        if stop_rx.try_recv().is_ok() {
                            break;
                        }
                        continue;
                    }
                    Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => break,
                };
                if stop_rx.try_recv().is_ok() {
                    break;
                }
                let events = match events {
                    Ok(ev) => ev,
                    Err(err) => {
                        log::warn!("[forge watcher] error: {}", err);
                        continue;
                    }
                };
                for event in events {
                    let path = event.path;
                    if let Some(name) = direct_forge_name(&forges_root_for_thread, &path) {
                        let payload = ForgeChange {
                            kind: "modified".into(),
                            rel_path: name,
                        };
                        if let Err(e) = app_for_thread.emit("forges:changed", payload) {
                            log::warn!("[forge watcher] Forge-list emit failed: {}", e);
                        }
                    } else if let Some(rel) = rel_path(&root_for_thread, &path) {
                        if !is_relevant(&rel) {
                            continue;
                        }
                        if recent_for_thread.matches_current_content(&path) {
                            continue;
                        }
                        index_external_change(&root_for_thread, &rel);
                        let payload = ForgeChange {
                            kind: "modified".into(),
                            rel_path: rel,
                        };
                        if let Err(e) = app_for_thread.emit("forge:changed", payload) {
                            log::warn!("[forge watcher] emit failed: {}", e);
                        }
                    }
                }
            }
        })
        .map_err(|e| format!("failed to spawn watcher thread: {}", e))?;

    Ok(WatcherHandle {
        _join: Some(join),
        stop: Some(stop_tx),
    })
}

/// Owned handle. Calling `shutdown` (or dropping it) stops the watcher
/// thread so a new one can be spawned for a different Forge.
pub struct WatcherHandle {
    _join: Option<std::thread::JoinHandle<()>>,
    stop: Option<std::sync::mpsc::Sender<()>>,
}

impl WatcherHandle {
    /// Tell the watcher thread to stop. Idempotent.
    pub fn shutdown(&self) {
        if let Some(tx) = &self.stop {
            let _ = tx.send(());
        }
    }
}

impl Drop for WatcherHandle {
    fn drop(&mut self) {
        self.shutdown();
    }
}

/// The one piece of managed state that holds the current watcher.
///
/// Switching Forge has to retire one watcher and install another, and Tauri
/// gives no way to re-manage a value: `Manager::manage` inserts *only* when
/// nothing of that type is managed yet and is a silent no-op otherwise
/// (`StateManager::set` returns a `bool` nobody is obliged to read), while
/// `Manager::unmanage` is deprecated as unsafe. Handing the new handle
/// straight to `manage` therefore dropped it on the floor — and because
/// `Drop` shuts the thread down, that killed the replacement outright and
/// left the dead original in place. One Forge switch and nothing was watched
/// at all until the app restarted.
///
/// Tauri's own guidance for this is to manage a `Mutex<Option<T>>` once and
/// swap the value inside it. That is all this is.
#[derive(Default)]
pub struct WatcherSlot(std::sync::Mutex<Option<WatcherHandle>>);

impl WatcherSlot {
    /// Stop whatever is watching now and install `next` in its place.
    ///
    /// Dropping the old handle would stop it anyway; stopping it explicitly
    /// keeps the ordering legible. A poisoned lock is recovered rather than
    /// propagated — a panic elsewhere should not silently disable file
    /// watching for the rest of the session.
    pub fn replace(&self, next: Option<WatcherHandle>) {
        let mut slot = self.0.lock().unwrap_or_else(|e| e.into_inner());
        if let Some(old) = slot.take() {
            old.shutdown();
        }
        *slot = next;
    }

    /// Whether a watcher is currently installed. Test-only: nothing in the app
    /// asks, it exists so the swap can be asserted on rather than inferred.
    #[cfg(test)]
    pub fn is_watching(&self) -> bool {
        self.0
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .as_ref()
            .is_some()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::path::PathBuf;

    struct TempDir(PathBuf);

    impl TempDir {
        fn new(tag: &str) -> Self {
            let path = std::env::temp_dir().join(format!(
                "moldavite-watcher-{tag}-{}-{}",
                std::process::id(),
                std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
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

    /// The watcher is what makes an agent's or a sync client's edit
    /// searchable without the frontend in the loop, so the branch that decides
    /// upsert-versus-remove is asserted directly. Wiring it to a real notify
    /// event would only re-test the debouncer.
    #[test]
    fn an_external_write_reaches_the_search_index_and_a_deletion_removes_it() {
        let tmp = TempDir::new("index-external");
        let root = tmp.path();
        for sub in ["notes", "daily", "weekly"] {
            fs::create_dir_all(root.join(sub)).unwrap();
        }
        fs::write(root.join("notes/seed.md"), "seed").unwrap();
        crate::search_index::reconcile(root).unwrap();

        fs::write(root.join("notes/agent.md"), "written by an agent").unwrap();
        index_external_change(root, "notes/agent.md");
        wait_for(|| {
            crate::search_index::query(root, root, "agent", 10)
                .is_some_and(|hits| hits.iter().any(|hit| hit.path == "notes/agent.md"))
        });

        fs::remove_file(root.join("notes/agent.md")).unwrap();
        index_external_change(root, "notes/agent.md");
        wait_for(|| {
            crate::search_index::query(root, root, "agent", 10).is_some_and(|hits| hits.is_empty())
        });

        // A note being locked arrives as an event on the `.locked` path; the
        // plaintext row it replaced has to go.
        fs::write(root.join("notes/seed.md.locked"), "ciphertext").unwrap();
        fs::remove_file(root.join("notes/seed.md")).unwrap();
        index_external_change(root, "notes/seed.md.locked");
        wait_for(|| {
            crate::search_index::query(root, root, "seed", 10).is_some_and(|hits| hits.is_empty())
        });

        crate::search_index::delete_for(root);
    }

    fn wait_for(mut check: impl FnMut() -> bool) {
        for _ in 0..200 {
            if check() {
                return;
            }
            std::thread::sleep(Duration::from_millis(25));
        }
        panic!("the search index never reached the expected state (waited 5s)");
    }

    #[test]
    fn relevant_filters_dotfiles_and_trash() {
        assert!(!is_relevant(".note-metadata.json"));
        assert!(!is_relevant(".trash/old.md"));
        assert!(!is_relevant("notes/.DS_Store"));
        // Semantic index state (and its atomic-write temp files) must never
        // trigger forge:changed events.
        assert!(!is_relevant(".index/embeddings.v1.bin"));
        assert!(!is_relevant(".index/.embeddings.v1.bin.123.0.tmp"));
        assert!(is_relevant("notes/foo.md"));
        assert!(is_relevant("daily/2024-01-01.md"));
        assert!(is_relevant("notes/secret.md.locked"));
    }

    #[test]
    fn relevant_ignores_unknown_extensions() {
        assert!(!is_relevant("notes/foo.png"));
        assert!(!is_relevant("notes/foo.txt"));
    }

    #[test]
    fn forge_root_events_include_direct_siblings_but_not_nested_files() {
        let root = Path::new("/forges");
        assert_eq!(
            direct_forge_name(root, Path::new("/forges/New Forge")),
            Some("New Forge".to_string())
        );
        assert_eq!(
            direct_forge_name(root, Path::new("/forges/Default")),
            Some("Default".to_string())
        );
        assert_eq!(
            direct_forge_name(root, Path::new("/forges/Other/notes/private.md")),
            None
        );
        assert_eq!(direct_forge_name(root, Path::new("/forges/.hidden")), None);
        assert!(is_relevant("notes/legitimate.md"));
    }

    #[test]
    fn matching_self_write_is_suppressed() {
        let tmp = TempDir::new("matching");
        let path = tmp.path().join("note.md");
        crate::persist::write_atomic(&path, b"---\ncolor: blue\n---\nwritten body", Some(0o600))
            .unwrap();
        let recent = RecentWrites::new();
        recent.record(&path, &sha256_hex("written body"));

        assert!(recent.matches_current_content(&path));
    }

    #[test]
    fn changed_content_is_delivered() {
        let tmp = TempDir::new("changed");
        let path = tmp.path().join("note.md");
        crate::persist::write_atomic(&path, b"written body", Some(0o600)).unwrap();
        let recent = RecentWrites::new();
        recent.record(&path, &sha256_hex("written body"));
        crate::persist::write_atomic(&path, b"external body", Some(0o600)).unwrap();

        assert!(!recent.matches_current_content(&path));
        assert!(!recent.inner.lock().unwrap().contains_key(&path));
    }

    #[test]
    fn missing_file_is_delivered_and_evicted() {
        let tmp = TempDir::new("missing");
        let path = tmp.path().join("missing.md");
        let recent = RecentWrites::new();
        recent.record(&path, &sha256_hex("written body"));

        assert!(!recent.matches_current_content(&path));
        assert!(!recent.inner.lock().unwrap().contains_key(&path));
    }

    #[test]
    fn expected_missing_file_is_suppressed() {
        let tmp = TempDir::new("expected-missing");
        let path = tmp.path().join("moved.md");
        let recent = RecentWrites::new();
        recent.record_missing(&path);

        assert!(recent.matches_current_content(&path));
    }

    #[test]
    fn recreated_missing_file_is_delivered_and_evicted() {
        let tmp = TempDir::new("recreated-missing");
        let path = tmp.path().join("moved.md");
        let recent = RecentWrites::new();
        recent.record_missing(&path);
        crate::persist::write_atomic(&path, b"recreated externally", Some(0o600)).unwrap();

        assert!(!recent.matches_current_content(&path));
        assert!(!recent.inner.lock().unwrap().contains_key(&path));
    }

    #[test]
    fn expired_entry_is_delivered_and_evicted() {
        let tmp = TempDir::new("expired");
        let path = tmp.path().join("note.md");
        crate::persist::write_atomic(&path, b"written body", Some(0o600)).unwrap();
        let recent = RecentWrites::new();
        recent.inner.lock().unwrap().insert(
            path.clone(),
            RecentWrite {
                recorded_at: Instant::now() - SELF_WRITE_MAX_AGE - Duration::from_secs(1),
                expected: ExpectedDiskState::ContentHash(sha256_hex("written body")),
            },
        );

        assert!(!recent.matches_current_content(&path));
        assert!(!recent.inner.lock().unwrap().contains_key(&path));
    }

    /// A handle with no thread behind it, so the stop signal can be observed
    /// directly instead of inferred from a live watcher.
    fn stub_handle() -> (WatcherHandle, std::sync::mpsc::Receiver<()>) {
        let (tx, rx) = std::sync::mpsc::channel();
        (
            WatcherHandle {
                _join: None,
                stop: Some(tx),
            },
            rx,
        )
    }

    /// Why re-managing the handle was fatal rather than merely ineffective:
    /// a dropped handle stops its own watcher. So the replacement Tauri threw
    /// away did not just fail to be stored — it died on the way out.
    #[test]
    fn dropping_a_handle_stops_its_watcher() {
        let (handle, rx) = stub_handle();
        drop(handle);
        assert!(
            rx.try_recv().is_ok(),
            "dropping a handle should stop its watcher thread"
        );
    }

    #[test]
    fn replacing_retires_the_old_watcher_and_keeps_the_new_one() {
        let slot = WatcherSlot::default();
        let (first, first_stop) = stub_handle();
        slot.replace(Some(first));
        assert!(slot.is_watching());

        let (second, second_stop) = stub_handle();
        slot.replace(Some(second));

        assert!(
            first_stop.try_recv().is_ok(),
            "the outgoing watcher was left running"
        );
        // The half that actually regressed: the incoming watcher has to still
        // be installed and alive, not dropped on the floor the way it was when
        // this went through Manager::manage.
        assert!(slot.is_watching());
        assert!(
            second_stop.try_recv().is_err(),
            "the incoming watcher was shut down as soon as it was installed"
        );
    }

    #[test]
    fn replacing_with_none_leaves_nothing_watching() {
        let slot = WatcherSlot::default();
        let (handle, stop) = stub_handle();
        slot.replace(Some(handle));
        slot.replace(None);

        assert!(stop.try_recv().is_ok());
        assert!(!slot.is_watching());
    }
}

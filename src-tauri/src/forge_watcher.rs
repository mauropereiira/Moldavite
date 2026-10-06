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

use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use notify::RecursiveMode;
use notify_debouncer_mini::new_debouncer;
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};

use crate::backlinks_index::BacklinksIndex;
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

/// A folder that can hold notes, at any depth, or one of the three note roots.
fn is_note_folder(rel: &str) -> bool {
    matches!(rel.split('/').next(), Some("daily" | "weekly" | "notes"))
        && !is_relevant(rel)
        && rel
            .split('/')
            .all(|part| !part.is_empty() && !part.starts_with('.'))
}

/// Push one debounced, non-self-write filesystem event into the keyword and
/// backlinks indexes: an agent, a sync client or another editor touching a
/// file is searchable, and its links count, without the frontend in the loop.
/// Returns the notes whose embeddings may now be stale, which the caller
/// queues for the semantic index once per batch of events.
///
/// `notify-debouncer-mini` collapses create, modify and remove into a single
/// "something happened here" event, so presence on disk decides which way the
/// index moves. A rename arrives as two such events — the old path now absent,
/// the new one present — and therefore needs no special case. A `.md.locked`
/// event removes the plaintext path it replaced.
fn index_external_change(
    root: &Path,
    rel: &str,
    backlinks: Option<&BacklinksIndex>,
) -> Vec<String> {
    if is_note_folder(rel) {
        return index_external_folder_change(root, rel, backlinks);
    }
    let rel = match rel.strip_suffix(".locked") {
        Some(plain) => plain,
        None => rel,
    };
    if !rel.ends_with(".md") {
        return Vec::new();
    }
    let path = root.join(rel);
    if path.is_file() {
        crate::search_index::note_changed_in(rel, root.to_path_buf());
    } else {
        crate::search_index::note_removed_in(rel, root.to_path_buf());
    }
    if let Some(index) = backlinks {
        update_backlinks(index, root, rel, &path);
    }
    vec![rel.to_string()]
}

/// A folder renamed, moved in or out, or removed by another process reaches
/// the watcher as one event for the folder and none for the notes inside, on
/// FSEvents, inotify and ReadDirectoryChangesW alike. Both indexes are brought
/// in line with whatever is under the folder now.
///
/// Windows can also report a folder as modified when a note inside it is
/// saved, so this must stay cheap: the keyword index compares the stats it
/// stores, and backlinks compare paths only, since a note's own event carries
/// its content changes. An unbuilt backlinks index reads the whole Forge when
/// it is built, so it is left alone.
///
/// The notes that left or joined backlinks are returned for the semantic
/// index, which tracks the same notes.
fn index_external_folder_change(
    root: &Path,
    rel_dir: &str,
    backlinks: Option<&BacklinksIndex>,
) -> Vec<String> {
    if root.join(rel_dir).is_file() {
        return Vec::new();
    }
    crate::search_index::folder_changed_in(rel_dir, root.to_path_buf());
    let Some(index) = backlinks.filter(|index| index.is_ready()) else {
        return Vec::new();
    };
    let on_disk: HashMap<String, PathBuf> = crate::semantic::scan_note_paths_in(root, rel_dir)
        .into_iter()
        .map(|(abs, rel)| (rel, abs))
        .collect();
    let indexed: HashSet<String> = index
        .sources_under(&format!("{rel_dir}/"))
        .into_iter()
        .collect();
    let mut stale = Vec::new();
    for gone in indexed.iter().filter(|rel| !on_disk.contains_key(*rel)) {
        index.remove_note(gone);
        stale.push(gone.clone());
    }
    for (rel, abs) in on_disk.iter().filter(|(rel, _)| !indexed.contains(*rel)) {
        update_backlinks(index, root, rel, abs);
        stale.push(rel.clone());
    }
    stale
}

/// Applies a rebuild's guards, so an external change never indexes a symlinked
/// or evicted file a rebuild would skip.
fn update_backlinks(index: &BacklinksIndex, root: &Path, rel: &str, path: &Path) {
    if !crate::backlinks_index::is_indexed_path(rel) {
        return;
    }
    let readable = std::fs::symlink_metadata(path).is_ok_and(|meta| meta.is_file())
        && crate::validation::validate_path_within_base(path, root).is_ok()
        && !crate::cloud_forge::is_evicted(path);
    let body = if readable {
        std::fs::read_to_string(path)
            .ok()
            .map(|raw| frontmatter::parse_note(&raw).body)
    } else {
        None
    };
    match body {
        Some(body) => index.update_note(rel, &body),
        None => index.remove_note(rel),
    }
}

/// Index one debounced event under the Forge. Returns the path the frontend
/// should hear about, if any.
fn apply_forge_event(
    root: &Path,
    path: &Path,
    recent: &RecentWrites,
    backlinks: Option<&BacklinksIndex>,
    stale: &mut Vec<String>,
) -> Option<String> {
    let rel = rel_path(root, path)?;
    let folder = is_note_folder(&rel);
    if !folder && !is_relevant(&rel) {
        return None;
    }
    if recent.matches_current_content(path) {
        return None;
    }
    stale.extend(index_external_change(root, &rel, backlinks));
    // Windows can report a note's folder as modified on each save, so emitting
    // folder events could refresh the note list after every autosave there.
    (!folder).then_some(rel)
}

/// Index one debounced batch under the Forge and log, for the Timeline, what
/// other programs did to notes in it. Returns the paths the frontend should
/// hear about and the notes the semantic index must refresh.
fn apply_forge_batch(
    root: &Path,
    paths: &[PathBuf],
    recent: &RecentWrites,
    backlinks: Option<&BacklinksIndex>,
) -> (Vec<String>, Vec<String>) {
    let mut stale = Vec::new();
    let changed: Vec<String> = paths
        .iter()
        .filter_map(|path| apply_forge_event(root, path, recent, backlinks, &mut stale))
        .collect();
    crate::activity_log::outside_changes_in(root, changed.clone());
    (changed, stale)
}

/// Spawn a long-lived background thread that watches active-Forge contents and
/// direct children of the Forges root. Returns a guard whose Drop stops it.
pub fn spawn(app: AppHandle, recent: Arc<RecentWrites>) -> Result<WatcherHandle, String> {
    let root = get_notes_dir()?;
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
                let mut forge_paths = Vec::new();
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
                    } else {
                        forge_paths.push(path);
                    }
                }
                let backlinks = app_for_thread.try_state::<Arc<BacklinksIndex>>();
                let (changed, stale) = apply_forge_batch(
                    &root_for_thread,
                    &forge_paths,
                    &recent_for_thread,
                    backlinks.as_deref().map(Arc::as_ref),
                );
                for rel in changed {
                    let payload = ForgeChange {
                        kind: "modified".into(),
                        rel_path: rel,
                    };
                    if let Err(e) = app_for_thread.emit("forge:changed", payload) {
                        log::warn!("[forge watcher] emit failed: {}", e);
                    }
                }
                crate::semantic::service().notes_changed_in(stale, root_for_thread.clone());
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

    #[test]
    fn a_batch_logs_outside_note_changes_and_skips_the_apps_own_writes() {
        let tmp = TempDir::new("activity");
        let root = tmp.path();
        fs::create_dir_all(root.join("notes")).unwrap();
        fs::write(root.join("notes/mine.md"), "saved by the app").unwrap();
        fs::write(root.join("notes/theirs.md"), "saved by a sync client").unwrap();
        let recent = RecentWrites::new();
        recent.record(&root.join("notes/mine.md"), &sha256_hex("saved by the app"));

        let (changed, _) = apply_forge_batch(
            root,
            &[root.join("notes/mine.md"), root.join("notes/theirs.md")],
            &recent,
            None,
        );
        assert_eq!(changed, vec!["notes/theirs.md".to_string()]);
        let logged: Vec<(String, String)> = crate::activity_log::page(root, None, None, 10)
            .entries
            .into_iter()
            .map(|entry| (entry.path, entry.source))
            .collect();
        assert_eq!(
            logged,
            vec![("notes/theirs.md".to_string(), "outside".to_string())]
        );
        crate::activity_log::delete_for(root);
        crate::search_index::delete_for(root);
    }

    /// The watcher is what makes an agent's or a sync client's edit
    /// searchable without the frontend in the loop, so the branch that decides
    /// upsert-versus-remove is asserted directly. Wiring it to a real notify
    /// event would only re-test the debouncer.
    #[test]
    fn an_external_write_reaches_the_search_and_backlinks_indexes_and_a_deletion_removes_it() {
        let tmp = TempDir::new("index-external");
        let root = tmp.path();
        for sub in ["notes/Seeds", "daily", "weekly"] {
            fs::create_dir_all(root.join(sub)).unwrap();
        }
        fs::write(root.join("notes/Seeds/seed.md"), "seed [[Target]]").unwrap();
        crate::search_index::reconcile(root).unwrap();
        let backlinks = BacklinksIndex::new();
        backlinks.update_note("notes/Seeds/seed.md", "seed [[Target]]");
        let sources = || -> Vec<String> {
            let mut paths: Vec<String> = backlinks
                .get("target.md", "Target")
                .into_iter()
                .map(|link| link.from_path)
                .collect();
            paths.sort();
            paths
        };

        fs::write(
            root.join("notes/agent.md"),
            "---\ncolor: blue\n---\nwritten by an agent about [[Target]]",
        )
        .unwrap();
        index_external_change(root, "notes/agent.md", Some(&backlinks));
        assert_eq!(sources(), ["notes/Seeds/seed.md", "notes/agent.md"]);
        wait_for(|| {
            crate::search_index::query(root, root, "agent", 10)
                .is_some_and(|hits| hits.iter().any(|hit| hit.path == "notes/agent.md"))
        });

        fs::remove_file(root.join("notes/agent.md")).unwrap();
        index_external_change(root, "notes/agent.md", Some(&backlinks));
        assert_eq!(sources(), ["notes/Seeds/seed.md"]);
        wait_for(|| {
            crate::search_index::query(root, root, "agent", 10).is_some_and(|hits| hits.is_empty())
        });

        // A note being locked arrives as an event on the `.locked` path; the
        // plaintext row it replaced has to go.
        fs::write(root.join("notes/Seeds/seed.md.locked"), "ciphertext").unwrap();
        fs::remove_file(root.join("notes/Seeds/seed.md")).unwrap();
        index_external_change(root, "notes/Seeds/seed.md.locked", Some(&backlinks));
        assert!(sources().is_empty());
        wait_for(|| {
            crate::search_index::query(root, root, "seed", 10).is_some_and(|hits| hits.is_empty())
        });

        crate::search_index::delete_for(root);
    }

    fn backlink_sources(backlinks: &BacklinksIndex) -> Vec<String> {
        let mut paths: Vec<String> = backlinks
            .get("target.md", "Target")
            .into_iter()
            .map(|link| link.from_path)
            .collect();
        paths.sort();
        paths
    }

    fn search_paths(root: &Path, query: &str) -> Vec<String> {
        let mut paths: Vec<String> = crate::search_index::query(root, root, query, 1000)
            .unwrap_or_default()
            .into_iter()
            .map(|hit| hit.path)
            .collect();
        paths.sort();
        paths
    }

    /// A folder renamed or moved by Finder, git or a sync client reaches the
    /// watcher as one event for the old folder and one for the new, and none
    /// for the notes inside.
    #[test]
    fn a_folder_renamed_outside_the_app_moves_its_notes_in_search_and_backlinks() {
        let tmp = TempDir::new("folder-rename");
        let root = tmp.path();
        fs::create_dir_all(root.join("notes/Projects/Deep")).unwrap();
        fs::write(root.join("notes/Projects/alpha.md"), "seed [[Target]]").unwrap();
        fs::write(root.join("notes/Projects/Deep/beta.md"), "seed [[Target]]").unwrap();
        crate::search_index::reconcile(root).unwrap();
        let backlinks = BacklinksIndex::new();
        backlinks.update_note("notes/Projects/alpha.md", "seed [[Target]]");
        backlinks.update_note("notes/Projects/Deep/beta.md", "seed [[Target]]");
        backlinks.mark_ready_for_test();

        fs::rename(root.join("notes/Projects"), root.join("notes/Plans")).unwrap();
        index_external_change(root, "notes/Projects", Some(&backlinks));
        index_external_change(root, "notes/Plans", Some(&backlinks));

        let moved = ["notes/Plans/Deep/beta.md", "notes/Plans/alpha.md"];
        assert_eq!(backlink_sources(&backlinks), moved);
        wait_for(|| search_paths(root, "seed") == moved);

        crate::search_index::delete_for(root);
    }

    fn write_note(root: &Path, rel: &str, body: &str) {
        let path = root.join(rel);
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(path, body).unwrap();
    }

    /// A Forge whose notes all say "seed" and link to Target, with both
    /// indexes built from it.
    fn indexed_forge(tag: &str, notes: &[&str]) -> (TempDir, BacklinksIndex) {
        let tmp = TempDir::new(tag);
        for rel in notes {
            write_note(tmp.path(), rel, "seed [[Target]]");
        }
        crate::search_index::reconcile(tmp.path()).unwrap();
        let backlinks = BacklinksIndex::new();
        for rel in notes {
            backlinks.update_note(rel, "seed [[Target]]");
        }
        backlinks.mark_ready_for_test();
        (tmp, backlinks)
    }

    fn assert_indexed(root: &Path, backlinks: &BacklinksIndex, expected: &[&str]) {
        let mut expected: Vec<String> = expected.iter().map(|rel| rel.to_string()).collect();
        expected.sort();
        assert_eq!(backlink_sources(backlinks), expected);
        wait_for(|| search_paths(root, "seed") == expected);
    }

    #[test]
    fn folders_moved_out_of_and_into_the_forge_leave_and_join_both_indexes() {
        let (tmp, backlinks) = indexed_forge(
            "folder-out-in",
            &[
                "daily/2026-01-01.md",
                "notes/keep.md",
                "notes/Out/one.md",
                "notes/Out/Deep/Deeper/two.md",
            ],
        );
        let root = tmp.path();
        let outside = TempDir::new("folder-out-in-outside");

        fs::rename(root.join("notes/Out"), outside.path().join("Out")).unwrap();
        index_external_change(root, "notes/Out", Some(&backlinks));
        assert_indexed(root, &backlinks, &["daily/2026-01-01.md", "notes/keep.md"]);

        write_note(outside.path(), "In/three.md", "seed [[Target]]");
        write_note(outside.path(), "In/Nested/four.md", "seed [[Target]]");
        fs::rename(outside.path().join("In"), root.join("notes/In")).unwrap();
        index_external_change(root, "notes/In", Some(&backlinks));
        assert_indexed(
            root,
            &backlinks,
            &[
                "daily/2026-01-01.md",
                "notes/In/Nested/four.md",
                "notes/In/three.md",
                "notes/keep.md",
            ],
        );

        fs::rename(root.join("daily"), outside.path().join("daily")).unwrap();
        index_external_change(root, "daily", Some(&backlinks));
        assert_indexed(
            root,
            &backlinks,
            &[
                "notes/In/Nested/four.md",
                "notes/In/three.md",
                "notes/keep.md",
            ],
        );

        crate::search_index::delete_for(root);
    }

    /// Events can arrive for names a folder held only briefly, and in any
    /// order. Each one reconciles against disk, so the last name wins.
    #[test]
    fn rapid_repeated_folder_renames_settle_on_the_last_name() {
        let (tmp, backlinks) = indexed_forge("folder-rapid", &["notes/A/x.md", "notes/A/Sub/y.md"]);
        let root = tmp.path();
        for (from, to) in [("A", "B"), ("B", "C"), ("C", "D")] {
            fs::rename(root.join("notes").join(from), root.join("notes").join(to)).unwrap();
        }
        for rel in [
            "notes/D", "notes/B", "notes/A", "notes/C", "notes/D", "notes/A",
        ] {
            index_external_change(root, rel, Some(&backlinks));
        }
        assert_indexed(root, &backlinks, &["notes/D/Sub/y.md", "notes/D/x.md"]);
        crate::search_index::delete_for(root);
    }

    #[test]
    fn stress_a_renamed_folder_of_500_notes_is_rekeyed_in_both_indexes() {
        let notes: Vec<String> = (0..500)
            .map(|i| format!("notes/Big/Level{}/note-{i}.md", i % 5))
            .collect();
        let refs: Vec<&str> = notes.iter().map(String::as_str).collect();
        let (tmp, backlinks) = indexed_forge("folder-500", &refs);
        let root = tmp.path();

        fs::rename(root.join("notes/Big"), root.join("notes/Huge")).unwrap();
        let started = Instant::now();
        index_external_change(root, "notes/Big", Some(&backlinks));
        index_external_change(root, "notes/Huge", Some(&backlinks));
        let moved: Vec<String> = notes
            .iter()
            .map(|rel| rel.replace("/Big/", "/Huge/"))
            .collect();
        let moved: Vec<&str> = moved.iter().map(String::as_str).collect();
        assert_indexed(root, &backlinks, &moved);
        eprintln!("500-note folder rename re-keyed in {:?}", started.elapsed());

        // A folder event with nothing to move, which Windows sends for every
        // save inside the folder, leaves both indexes as they are.
        let started = Instant::now();
        index_external_change(root, "notes/Huge", Some(&backlinks));
        index_external_change(root, "notes/Huge/Level3", Some(&backlinks));
        assert_indexed(root, &backlinks, &moved);
        eprintln!("no-op folder events took {:?}", started.elapsed());

        crate::search_index::delete_for(root);
    }

    /// Saves keep landing while a sync client renames their folder. Whatever
    /// the interleaving, once the watcher has seen both folder names the
    /// indexes hold exactly what is on disk.
    #[test]
    fn a_folder_rename_racing_saves_converges_on_disk() {
        let (tmp, backlinks) = indexed_forge("folder-race", &["notes/A/first.md"]);
        let root = tmp.path().to_path_buf();
        let backlinks = Arc::new(backlinks);
        let renamed = Arc::new(std::sync::atomic::AtomicBool::new(false));

        let saver = {
            let (root, backlinks, renamed) = (root.clone(), backlinks.clone(), renamed.clone());
            std::thread::spawn(move || {
                for i in 0..200 {
                    let folder = if renamed.load(std::sync::atomic::Ordering::SeqCst) {
                        "B"
                    } else {
                        "A"
                    };
                    let rel = format!("notes/{folder}/save-{i}.md");
                    let saved = crate::persist::write_atomic(
                        &root.join(&rel),
                        b"seed [[Target]]",
                        Some(0o600),
                    );
                    if saved.is_ok() {
                        crate::search_index::note_changed_in(&rel, root.clone());
                        backlinks.update_note(&rel, "seed [[Target]]");
                    }
                }
            })
        };
        std::thread::sleep(Duration::from_millis(5));
        // Windows refuses to rename a folder while a save inside it holds a
        // file open, so retry the way a sync client would.
        let deadline = Instant::now() + Duration::from_secs(10);
        while let Err(error) = fs::rename(root.join("notes/A"), root.join("notes/B")) {
            assert!(Instant::now() < deadline, "rename kept failing: {error}");
            std::thread::sleep(Duration::from_millis(1));
        }
        renamed.store(true, std::sync::atomic::Ordering::SeqCst);
        index_external_change(&root, "notes/A", Some(&backlinks));
        index_external_change(&root, "notes/B", Some(&backlinks));
        saver.join().unwrap();
        index_external_change(&root, "notes/A", Some(&backlinks));
        index_external_change(&root, "notes/B", Some(&backlinks));

        let on_disk: Vec<String> = crate::semantic::scan_note_paths(&root)
            .into_iter()
            .map(|(_, rel)| rel)
            .collect();
        assert!(on_disk.iter().all(|rel| rel.starts_with("notes/B/")));
        let on_disk: Vec<&str> = on_disk.iter().map(String::as_str).collect();
        assert_indexed(&root, &backlinks, &on_disk);
        crate::search_index::delete_for(&root);
    }

    struct OneHotEmbedder;

    impl crate::semantic::Embedder for OneHotEmbedder {
        fn embed(&self, texts: &[String]) -> Result<Vec<Vec<f32>>, String> {
            let mut vector = vec![0.0; crate::semantic::EMBED_DIM as usize];
            vector[0] = 1.0;
            Ok(texts.iter().map(|_| vector.clone()).collect())
        }
    }

    #[test]
    fn external_changes_report_the_notes_semantic_search_must_refresh() {
        let (tmp, backlinks) = indexed_forge("semantic-stale", &["notes/A/one.md"]);
        let root = tmp.path();

        write_note(root, "notes/agent.md", "seed [[Target]]");
        assert_eq!(
            index_external_change(root, "notes/agent.md", Some(&backlinks)),
            ["notes/agent.md"]
        );
        write_note(root, "notes/agent.md.locked", "ciphertext");
        fs::remove_file(root.join("notes/agent.md")).unwrap();
        assert_eq!(
            index_external_change(root, "notes/agent.md.locked", Some(&backlinks)),
            ["notes/agent.md"]
        );
        assert!(index_external_change(root, "notes/template.json", Some(&backlinks)).is_empty());

        fs::rename(root.join("notes/A"), root.join("notes/B")).unwrap();
        let mut stale = index_external_change(root, "notes/A", Some(&backlinks));
        stale.extend(index_external_change(root, "notes/B", Some(&backlinks)));
        assert_eq!(stale, ["notes/A/one.md", "notes/B/one.md"]);
        assert!(index_external_change(root, "notes/B", Some(&backlinks)).is_empty());

        crate::search_index::delete_for(root);
    }

    /// The batch the watcher loop hands to semantic search, end to end, on a
    /// service of its own rather than the process-wide one.
    #[test]
    fn an_external_edit_reaches_the_semantic_index() {
        let tmp = TempDir::new("semantic-e2e");
        let root = tmp.path();
        let svc: &'static crate::semantic::SemanticService =
            Box::leak(Box::new(crate::semantic::SemanticService::new()));
        svc.set_embedder(Arc::new(OneHotEmbedder));
        svc.set_phase(crate::semantic::Phase::Ready);
        let recent = RecentWrites::new();
        let indexed = || {
            let mut paths: Vec<String> = svc
                .search("anything", 100)
                .unwrap()
                .into_iter()
                .map(|hit| hit.path)
                .collect();
            paths.sort();
            paths
        };

        write_note(root, "notes/agent.md", "written by an agent");
        let mut stale = Vec::new();
        apply_forge_event(
            root,
            &root.join("notes/agent.md"),
            &recent,
            None,
            &mut stale,
        );
        svc.notes_changed_in(stale, root.to_path_buf());
        wait_for(|| indexed() == ["notes/agent.md"]);

        fs::remove_file(root.join("notes/agent.md")).unwrap();
        let mut stale = Vec::new();
        apply_forge_event(
            root,
            &root.join("notes/agent.md"),
            &recent,
            None,
            &mut stale,
        );
        svc.notes_changed_in(stale, root.to_path_buf());
        wait_for(|| indexed().is_empty());

        crate::search_index::delete_for(root);
    }

    #[test]
    fn folder_events_leave_an_unbuilt_backlinks_index_to_its_build() {
        let tmp = TempDir::new("folder-unbuilt");
        let root = tmp.path();
        write_note(root, "notes/New/one.md", "seed [[Target]]");
        let backlinks = BacklinksIndex::new();
        index_external_change(root, "notes/New", Some(&backlinks));
        assert!(backlink_sources(&backlinks).is_empty());
        crate::search_index::delete_for(root);
    }

    #[test]
    fn only_folders_that_can_hold_notes_are_reconciled() {
        assert!(is_note_folder("notes"));
        assert!(is_note_folder("daily"));
        assert!(is_note_folder("notes/A/B"));
        assert!(!is_note_folder("notes/A/note.md"));
        assert!(!is_note_folder("notes/A/note.md.locked"));
        assert!(!is_note_folder("notes/.hidden"));
        assert!(!is_note_folder("notes/../escape"));
        assert!(!is_note_folder("images/Album"));
        assert!(!is_note_folder(".trash/Old"));
        assert!(!is_note_folder(""));
    }

    #[cfg(unix)]
    #[test]
    fn security_regression_a_symlinked_folder_never_reaches_either_index() {
        let (tmp, backlinks) = indexed_forge("folder-symlink", &["notes/keep.md"]);
        let root = tmp.path();
        let outside = TempDir::new("folder-symlink-outside");
        write_note(outside.path(), "secret.md", "seed [[Target]]");
        std::os::unix::fs::symlink(outside.path(), root.join("notes/Linked")).unwrap();
        fs::create_dir_all(root.join("notes/Real")).unwrap();
        std::os::unix::fs::symlink(outside.path(), root.join("notes/Real/Inner")).unwrap();

        for rel in ["notes/Linked", "notes/Real", "notes/Real/Inner"] {
            index_external_change(root, rel, Some(&backlinks));
        }

        assert_indexed(root, &backlinks, &["notes/keep.md"]);
        crate::search_index::delete_for(root);
    }

    /// The other tests feed folder events by hand. This one lets the real
    /// backend (FSEvents, inotify or ReadDirectoryChangesW) report them, so
    /// each platform proves it delivers a path the watcher acts on.
    #[test]
    fn real_folder_events_reach_both_indexes() {
        let (tmp, backlinks) = indexed_forge(
            "folder-real",
            &["notes/keep.md", "notes/Old/one.md", "notes/Old/Deep/two.md"],
        );
        // FSEvents reports resolved paths, and the temp dir is behind a
        // symlink on macOS.
        let root = if cfg!(target_os = "macos") {
            tmp.path().canonicalize().unwrap()
        } else {
            tmp.path().to_path_buf()
        };
        let outside = TempDir::new("folder-real-outside");
        write_note(outside.path(), "Incoming/three.md", "seed [[Target]]");
        let recent = RecentWrites::new();
        let (tx, rx) = std::sync::mpsc::channel();
        let mut debouncer = new_debouncer(Duration::from_millis(100), tx).unwrap();
        debouncer
            .watcher()
            .watch(&root, RecursiveMode::Recursive)
            .unwrap();
        // Lets the backend finish arming before the moves it must see.
        std::thread::sleep(Duration::from_millis(500));

        let settle = |expected: &[&str]| {
            let deadline = Instant::now() + Duration::from_secs(20);
            let settled = || {
                backlink_sources(&backlinks) == expected
                    && search_paths(tmp.path(), "seed") == expected
            };
            while !settled() && Instant::now() < deadline {
                if let Ok(Ok(events)) = rx.recv_timeout(Duration::from_millis(250)) {
                    for event in events {
                        apply_forge_event(
                            &root,
                            &event.path,
                            &recent,
                            Some(&backlinks),
                            &mut Vec::new(),
                        );
                    }
                }
            }
            assert_eq!(backlink_sources(&backlinks), expected);
            assert_eq!(search_paths(tmp.path(), "seed"), expected);
        };

        fs::rename(root.join("notes/Old"), root.join("notes/New")).unwrap();
        settle(&["notes/New/Deep/two.md", "notes/New/one.md", "notes/keep.md"]);

        fs::rename(outside.path().join("Incoming"), root.join("notes/Incoming")).unwrap();
        settle(&[
            "notes/Incoming/three.md",
            "notes/New/Deep/two.md",
            "notes/New/one.md",
            "notes/keep.md",
        ]);

        fs::rename(root.join("notes/New/Deep"), outside.path().join("Deep")).unwrap();
        settle(&[
            "notes/Incoming/three.md",
            "notes/New/one.md",
            "notes/keep.md",
        ]);

        crate::search_index::delete_for(tmp.path());
    }

    #[cfg(unix)]
    #[test]
    fn security_regression_an_external_symlink_never_reaches_the_backlinks_index() {
        let tmp = TempDir::new("backlinks-symlink");
        let root = tmp.path();
        fs::create_dir_all(root.join("notes")).unwrap();
        let outside = TempDir::new("backlinks-symlink-outside");
        fs::write(outside.path().join("secret.md"), "outside [[Target]]").unwrap();
        std::os::unix::fs::symlink(
            outside.path().join("secret.md"),
            root.join("notes/planted.md"),
        )
        .unwrap();
        let backlinks = BacklinksIndex::new();

        update_backlinks(
            &backlinks,
            root,
            "notes/planted.md",
            &root.join("notes/planted.md"),
        );

        assert!(backlinks.get("target.md", "Target").is_empty());
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

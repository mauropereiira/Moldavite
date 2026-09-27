//! Shared in-memory backlinks index.
//!
//! Maintains an inverted index from target filename -> list of notes
//! that link to it, plus an outbound map from source path -> set of
//! targets it currently references. This replaces O(n) full-disk scans
//! on every `get_backlinks` call.
//!
//! Sources are keyed by Forge-relative path (`notes/A/plan.md`) because notes in
//! different folders may share a filename. Targets stay bare filenames: a
//! `[[link]]` names a note, not a path, and passes through the wiki slug resolver.
//!
//! Both maps are updated under one write lock so they cannot disagree. Rebuilds
//! scan only visible Markdown files, never follow symlinks, and publish the new
//! state only after the scan completes.

use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Mutex, PoisonError, RwLock};
use std::time::{Duration, Instant};

use crate::types::BacklinkInfo;
use crate::wiki::{get_link_context, note_exists, note_name_to_filename, parse_wiki_links};

#[derive(Debug, Clone)]
pub(crate) struct Entry {
    pub(crate) from_path: String,
    pub(crate) from_note: String,
    pub(crate) from_title: String,
    pub(crate) context: String,
}

#[derive(Default)]
struct State {
    /// Keyed by resolved target filename (e.g. "meeting-notes.md").
    by_target: HashMap<String, Vec<Entry>>,
    /// Keyed by source path; value is set of target filenames it links to.
    outbound: HashMap<String, HashSet<String>>,
}

/// How long a query waits before trying again to build an index whose last
/// build failed, instead of rescanning the whole Forge on every call.
const FAILED_BUILD_RETRY_AFTER: Duration = Duration::from_secs(30);

pub(crate) struct BacklinksIndex {
    inner: RwLock<State>,
    ready: AtomicBool,
    /// Held for the whole of a rebuild, so builds never overlap and a query
    /// that needs the index waits for the one already running. Holds the time
    /// the last build failed, if it did.
    build: Mutex<Option<Instant>>,
}

/// Resolver converts a raw link name (e.g. "Meeting Notes" or "2026-01-02")
/// into a concrete filename. The real implementation uses `wiki::note_exists`
/// which hits disk; tests may inject a pure resolver.
pub(crate) type Resolver = dyn Fn(&str) -> String + Send + Sync;

fn default_resolver(name: &str) -> String {
    match note_exists(name) {
        Ok((_, target)) => {
            if target.is_empty() {
                note_name_to_filename(name)
            } else {
                target
            }
        }
        Err(_) => note_name_to_filename(name),
    }
}

fn leaf(path: &str) -> &str {
    path.rsplit('/').next().unwrap_or(path)
}

/// Mirrors what a rebuild scans, so a watcher update cannot admit a note a
/// restart would drop.
pub(crate) fn is_indexed_path(rel: &str) -> bool {
    let Some((top, rest)) = rel.split_once('/') else {
        return false;
    };
    let flat = match top {
        "daily" | "weekly" => true,
        "notes" => false,
        _ => return false,
    };
    if !rest.ends_with(".md") || (flat && rest.contains('/')) {
        return false;
    }
    rest.split('/')
        .all(|part| !part.is_empty() && !part.starts_with('.'))
}

/// `note_root` must be a Forge's `daily`, `weekly` or `notes` directory; its
/// name becomes the path's first component.
pub(crate) fn source_path_under(note_root: &Path, abs: &Path) -> Option<String> {
    let top = note_root.file_name()?.to_str()?;
    let rel = abs.strip_prefix(note_root).ok()?;
    let mut path = top.to_string();
    for part in rel.components() {
        path.push('/');
        path.push_str(part.as_os_str().to_str()?);
    }
    Some(path)
}

fn extract_title(content: &str, fallback: &str) -> String {
    content
        .lines()
        .find(|line| line.starts_with("# "))
        .map(|line| line.trim_start_matches("# ").trim().to_string())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| fallback.to_string())
}

impl BacklinksIndex {
    pub(crate) fn new() -> Self {
        Self {
            inner: RwLock::new(State::default()),
            ready: AtomicBool::new(false),
            build: Mutex::new(None),
        }
    }

    pub(crate) fn is_ready(&self) -> bool {
        self.ready.load(Ordering::Acquire)
    }

    fn mark_ready(&self) {
        self.ready.store(true, Ordering::Release);
    }

    /// Walk daily + weekly + standalone trees and populate the index.
    /// Errors are logged, not panicked.
    pub(crate) fn rebuild_from_disk(&self) {
        self.rebuild_from(crate::paths::get_notes_dir);
    }

    /// Make sure the index has been built before a query reads it. A build
    /// already in progress is waited for rather than repeated, and a build
    /// that failed is not retried until [`FAILED_BUILD_RETRY_AFTER`] passes,
    /// so the query answers from whatever the index holds.
    pub(crate) fn ensure_built(&self) {
        self.ensure_built_from(crate::paths::get_notes_dir);
    }

    fn rebuild_from(&self, notes_dir: impl FnOnce() -> Result<PathBuf, String>) {
        let mut last_failure = self.build.lock().unwrap_or_else(PoisonError::into_inner);
        self.rebuild_locked(&mut last_failure, notes_dir);
    }

    fn ensure_built_from(&self, notes_dir: impl FnOnce() -> Result<PathBuf, String>) {
        if self.is_ready() {
            return;
        }
        let mut last_failure = self.build.lock().unwrap_or_else(PoisonError::into_inner);
        let failed_recently =
            last_failure.is_some_and(|at| at.elapsed() < FAILED_BUILD_RETRY_AFTER);
        if self.is_ready() || failed_recently {
            return;
        }
        self.rebuild_locked(&mut last_failure, notes_dir);
    }

    fn rebuild_locked(
        &self,
        last_failure: &mut Option<Instant>,
        notes_dir: impl FnOnce() -> Result<PathBuf, String>,
    ) {
        let mut files: Vec<(String, String)> = Vec::new();

        let root = match notes_dir() {
            Ok(root) => root,
            Err(error) => {
                log::warn!("backlinks index rebuild skipped: {error}");
                *last_failure = Some(Instant::now());
                return;
            }
        };
        collect_md_files_flat(&root.join("daily"), "daily", &mut files);
        collect_md_files_flat(&root.join("weekly"), "weekly", &mut files);
        collect_md_files_recursive(&root.join("notes"), "notes", &mut files);

        {
            let mut state = match self.inner.write() {
                Ok(g) => g,
                Err(poisoned) => {
                    log::warn!("backlinks index lock poisoned during rebuild; recovering");
                    poisoned.into_inner()
                }
            };
            state.by_target.clear();
            state.outbound.clear();
        }

        for (path, content) in files {
            self.update_note_with(&path, &content, &default_resolver);
        }

        *last_failure = None;
        self.mark_ready();
    }

    /// `path` is Forge-relative, e.g. `notes/A/plan.md`. Uses the real on-disk resolver.
    pub(crate) fn update_note(&self, path: &str, content: &str) {
        self.update_note_with(path, content, &default_resolver);
    }

    /// Same as `update_note` but allows injecting a resolver for tests.
    pub(crate) fn update_note_with(&self, path: &str, content: &str, resolver: &Resolver) {
        let filename = leaf(path);
        let title = extract_title(content, filename);
        let link_names = parse_wiki_links(content);

        // Resolve targets and compute contexts (both slug-style and raw-name keys).
        let mut new_targets: HashSet<String> = HashSet::new();
        let mut new_entries: Vec<(String, Entry)> = Vec::new();

        for raw in &link_names {
            let resolved = resolver(raw);
            let context = get_link_context(content, raw);

            let entry = Entry {
                from_path: path.to_string(),
                from_note: filename.to_string(),
                from_title: title.clone(),
                context,
            };

            if !resolved.is_empty() {
                new_targets.insert(resolved.clone());
                new_entries.push((resolved, entry.clone()));
            }

            // Also key by the raw name stem (e.g. "Meeting Notes") so that
            // consumers searching by bare note-name stem can find entries
            // even when the target isn't resolvable on disk yet.
            let stem_key = format!("__stem__:{}", raw);
            new_entries.push((stem_key, entry));
        }

        let mut state = match self.inner.write() {
            Ok(g) => g,
            Err(poisoned) => {
                log::warn!("backlinks index lock poisoned during update; recovering");
                poisoned.into_inner()
            }
        };

        remove_from_by_target(&mut state.by_target, path);
        state.outbound.remove(path);

        for (key, entry) in new_entries {
            state.by_target.entry(key).or_default().push(entry);
        }
        state.outbound.insert(path.to_string(), new_targets);
    }

    pub(crate) fn remove_note(&self, path: &str) {
        let mut state = match self.inner.write() {
            Ok(g) => g,
            Err(poisoned) => {
                log::warn!("backlinks index lock poisoned during remove; recovering");
                poisoned.into_inner()
            }
        };
        remove_from_by_target(&mut state.by_target, path);
        state.outbound.remove(path);
    }

    /// `old` and `new` are Forge-relative paths.
    pub(crate) fn rename_note(&self, old: &str, new: &str, new_content: &str) {
        {
            let mut state = match self.inner.write() {
                Ok(g) => g,
                Err(poisoned) => {
                    log::warn!("backlinks index lock poisoned during rename; recovering");
                    poisoned.into_inner()
                }
            };
            if let Some(entries) = state.by_target.remove(leaf(old)) {
                state
                    .by_target
                    .entry(leaf(new).to_string())
                    .or_default()
                    .extend(entries);
            }
        }
        self.remove_note(old);
        self.update_note(new, new_content);
    }

    /// Re-keys sources under `old_prefix` (e.g. `notes/A`). Filenames are
    /// unchanged, so no target moves.
    pub(crate) fn move_folder(&self, old_prefix: &str, new_prefix: &str) {
        let old_dir = format!("{}/", old_prefix.trim_end_matches('/'));
        let new_dir = format!("{}/", new_prefix.trim_end_matches('/'));
        let moved = |path: &str| {
            path.strip_prefix(&old_dir)
                .map(|rest| format!("{new_dir}{rest}"))
        };
        let mut state = match self.inner.write() {
            Ok(g) => g,
            Err(poisoned) => {
                log::warn!("backlinks index lock poisoned during folder move; recovering");
                poisoned.into_inner()
            }
        };
        for entries in state.by_target.values_mut() {
            for entry in entries.iter_mut() {
                if let Some(path) = moved(&entry.from_path) {
                    entry.from_path = path;
                }
            }
        }
        state.outbound = std::mem::take(&mut state.outbound)
            .into_iter()
            .map(|(path, targets)| (moved(&path).unwrap_or(path), targets))
            .collect();
    }

    pub(crate) fn remove_all(&self) {
        let mut state = match self.inner.write() {
            Ok(g) => g,
            Err(poisoned) => {
                log::warn!("backlinks index lock poisoned during clear; recovering");
                poisoned.into_inner()
            }
        };
        state.by_target.clear();
        state.outbound.clear();
    }

    /// Get backlinks for a target, one per source path. `note_stem` is the raw
    /// display name (without .md) so we can also match entries that linked
    /// by display name even if the file didn't exist at link time.
    pub(crate) fn get(&self, target_filename: &str, note_stem: &str) -> Vec<BacklinkInfo> {
        let state = match self.inner.read() {
            Ok(g) => g,
            Err(poisoned) => {
                log::warn!("backlinks index lock poisoned during read; recovering");
                poisoned.into_inner()
            }
        };

        let mut seen: HashSet<String> = HashSet::new();
        let mut out: Vec<BacklinkInfo> = Vec::new();

        let push = |entries: &[Entry], seen: &mut HashSet<String>, out: &mut Vec<BacklinkInfo>| {
            for e in entries {
                // Don't include self-links
                if e.from_note == target_filename {
                    continue;
                }
                if seen.insert(e.from_path.clone()) {
                    out.push(BacklinkInfo {
                        from_path: e.from_path.clone(),
                        from_note: e.from_note.clone(),
                        from_title: e.from_title.clone(),
                        context: e.context.clone(),
                    });
                }
            }
        };

        if let Some(entries) = state.by_target.get(target_filename) {
            push(entries, &mut seen, &mut out);
        }
        let stem_key = format!("__stem__:{}", note_stem);
        if let Some(entries) = state.by_target.get(&stem_key) {
            push(entries, &mut seen, &mut out);
        }

        out
    }
}

fn remove_from_by_target(by_target: &mut HashMap<String, Vec<Entry>>, from_path: &str) {
    let mut empty_keys: Vec<String> = Vec::new();
    for (k, v) in by_target.iter_mut() {
        v.retain(|e| e.from_path != from_path);
        if v.is_empty() {
            empty_keys.push(k.clone());
        }
    }
    for k in empty_keys {
        by_target.remove(&k);
    }
}

fn collect_md_files_flat(dir: &Path, rel_dir: &str, out: &mut Vec<(String, String)>) {
    if !dir.exists() {
        return;
    }
    let entries = match fs::read_dir(dir) {
        Ok(e) => e,
        Err(err) => {
            log::warn!("backlinks index: failed to read {:?}: {}", dir, err);
            return;
        }
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if fs::symlink_metadata(&path)
            .map(|m| m.file_type().is_symlink())
            .unwrap_or(true)
        {
            continue;
        }
        if !path.is_file()
            || path.extension().and_then(|s| s.to_str()) != Some("md")
            || crate::cloud_forge::is_evicted(&path)
        {
            continue;
        }
        let Some(filename) = path
            .file_name()
            .and_then(|s| s.to_str())
            .map(|s| s.to_string())
        else {
            continue;
        };
        match fs::read_to_string(&path) {
            Ok(content) => {
                let body = crate::frontmatter::parse_note(&content).body;
                out.push((format!("{rel_dir}/{filename}"), body));
            }
            Err(err) => log::warn!("backlinks index: failed to read {:?}: {}", path, err),
        }
    }
}

fn collect_md_files_recursive(dir: &Path, rel_dir: &str, out: &mut Vec<(String, String)>) {
    if !dir.exists() {
        return;
    }
    let entries = match fs::read_dir(dir) {
        Ok(e) => e,
        Err(err) => {
            log::warn!("backlinks index: failed to read {:?}: {}", dir, err);
            return;
        }
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if fs::symlink_metadata(&path)
            .map(|m| m.file_type().is_symlink())
            .unwrap_or(false)
        {
            continue;
        }
        if path.is_dir() {
            let name = path.file_name().and_then(|s| s.to_str()).unwrap_or("");
            if name.starts_with('.') {
                continue;
            }
            collect_md_files_recursive(&path, &format!("{rel_dir}/{name}"), out);
        } else if path.is_file()
            && path.extension().and_then(|s| s.to_str()) == Some("md")
            && !crate::cloud_forge::is_evicted(&path)
        {
            let Some(filename) = path
                .file_name()
                .and_then(|s| s.to_str())
                .map(|s| s.to_string())
            else {
                continue;
            };
            match fs::read_to_string(&path) {
                Ok(content) => {
                    let body = crate::frontmatter::parse_note(&content).body;
                    out.push((format!("{rel_dir}/{filename}"), body));
                }
                Err(err) => log::warn!("backlinks index: failed to read {:?}: {}", path, err),
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Test resolver that slugifies using the same rule as `note_name_to_filename`.
    fn slug_resolver(name: &str) -> String {
        let slug = name
            .to_lowercase()
            .trim()
            .replace(' ', "-")
            .replace(|c: char| !c.is_alphanumeric() && c != '-', "");
        format!("{}.md", slug)
    }

    #[test]
    fn a_failed_build_is_not_repeated_by_every_query() {
        let idx = BacklinksIndex::new();
        let attempts = std::cell::Cell::new(0);
        for _ in 0..3 {
            idx.ensure_built_from(|| {
                attempts.set(attempts.get() + 1);
                Err("no Forge".to_string())
            });
        }
        assert_eq!(attempts.get(), 1);
        assert!(!idx.is_ready());
        assert!(idx.get("target.md", "Target").is_empty());
    }

    #[test]
    fn a_query_waits_for_the_running_build_instead_of_starting_another() {
        let idx = std::sync::Arc::new(BacklinksIndex::new());
        let empty_forge = std::env::temp_dir().join(format!(
            "moldavite-backlinks-wait-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let (started_tx, started_rx) = std::sync::mpsc::channel();
        let builder = {
            let idx = idx.clone();
            std::thread::spawn(move || {
                idx.rebuild_from(|| {
                    started_tx.send(()).unwrap();
                    std::thread::sleep(Duration::from_millis(100));
                    Ok(empty_forge)
                })
            })
        };
        started_rx.recv().unwrap();

        idx.ensure_built_from(|| panic!("a second build started while one was running"));

        assert!(idx.is_ready());
        builder.join().unwrap();
    }

    #[test]
    fn update_note_indexes_outgoing_links() {
        let idx = BacklinksIndex::new();
        idx.update_note_with(
            "source.md",
            "# Source\nSee [[Meeting Notes]] and [[Project Plan]].",
            &slug_resolver,
        );

        let links = idx.get("meeting-notes.md", "Meeting Notes");
        assert_eq!(links.len(), 1);
        assert_eq!(links[0].from_note, "source.md");
        assert_eq!(links[0].from_title, "Source");
        assert!(links[0].context.contains("Meeting Notes"));

        let links = idx.get("project-plan.md", "Project Plan");
        assert_eq!(links.len(), 1);
        assert_eq!(links[0].from_note, "source.md");
    }

    #[test]
    fn update_note_replaces_previous_entries() {
        let idx = BacklinksIndex::new();
        idx.update_note_with("a.md", "# A\n[[Target]]", &slug_resolver);
        assert_eq!(idx.get("target.md", "Target").len(), 1);

        // Rewrite source to no longer link to Target.
        idx.update_note_with("a.md", "# A\nno links here", &slug_resolver);
        assert_eq!(idx.get("target.md", "Target").len(), 0);
    }

    #[test]
    fn remove_note_drops_entries() {
        let idx = BacklinksIndex::new();
        idx.update_note_with("a.md", "# A\n[[Target]]", &slug_resolver);
        idx.update_note_with("b.md", "# B\n[[Target]]", &slug_resolver);
        assert_eq!(idx.get("target.md", "Target").len(), 2);

        idx.remove_note("a.md");
        let remaining = idx.get("target.md", "Target");
        assert_eq!(remaining.len(), 1);
        assert_eq!(remaining[0].from_note, "b.md");
    }

    #[test]
    fn rename_note_rekeys_incoming_and_outgoing() {
        let idx = BacklinksIndex::new();
        // `a.md` is linked to by `b.md`.
        idx.update_note_with("b.md", "# B\n[[a]]", &slug_resolver);
        assert_eq!(idx.get("a.md", "a").len(), 1);

        // Rename a.md -> renamed.md. b.md still has [[a]] so by_target key `a.md`
        // gets re-keyed to `renamed.md`.
        idx.rename_note("a.md", "renamed.md", "# Renamed\n");
        assert_eq!(idx.get("renamed.md", "renamed").len(), 1);
        assert_eq!(idx.get("a.md", "a").len(), 1); // stem key __stem__:a still has b.md's entry
    }

    #[test]
    fn get_deduplicates_by_from_note() {
        let idx = BacklinksIndex::new();
        // Same source links to the same target twice.
        idx.update_note_with(
            "a.md",
            "# A\n[[Target]] and again [[Target]]",
            &slug_resolver,
        );
        let links = idx.get("target.md", "Target");
        assert_eq!(links.len(), 1);
    }

    #[test]
    fn self_links_are_excluded() {
        let idx = BacklinksIndex::new();
        idx.update_note_with("a.md", "# A\n[[a]]", &slug_resolver);
        assert_eq!(idx.get("a.md", "a").len(), 0);
    }

    #[cfg(unix)]
    #[test]
    fn security_regression_flat_scan_never_follows_a_symlink() {
        // The recursive standalone walk already skipped symlinks; the flat
        // daily/weekly walk used `is_file()`, which follows them, so a link
        // planted in `daily/` pulled a file from outside the Forge into the
        // index (filename, title and a context snippet of its contents).
        use std::os::unix::fs::symlink;

        let root = std::env::temp_dir().join(format!(
            "moldavite-backlinks-symlink-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let daily = root.join("daily");
        fs::create_dir_all(&daily).unwrap();
        let outside = root.join("outside.md");
        fs::write(&outside, "# Outside\nnot a note in this Forge\n").unwrap();
        symlink(&outside, daily.join("2026-01-01.md")).unwrap();
        fs::write(daily.join("2026-01-02.md"), "# Real\n").unwrap();

        let mut files = Vec::new();
        collect_md_files_flat(&daily, "daily", &mut files);

        let names: Vec<&str> = files.iter().map(|(name, _)| name.as_str()).collect();
        assert_eq!(names, ["daily/2026-01-02.md"]);

        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn same_named_notes_in_different_folders_keep_their_own_links() {
        let root = std::env::temp_dir().join(format!(
            "moldavite-backlinks-same-name-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir_all(root.join("notes/A")).unwrap();
        fs::create_dir_all(root.join("notes/B")).unwrap();
        fs::create_dir_all(root.join("daily")).unwrap();
        fs::write(root.join("notes/A/plan.md"), "# Plan A\n[[Target]]\n").unwrap();
        fs::write(root.join("notes/B/plan.md"), "# Plan B\n[[Target]]\n").unwrap();
        fs::write(root.join("daily/2026-01-01.md"), "# Daily\n[[Target]]\n").unwrap();
        fs::write(
            root.join("notes/2026-01-01.md"),
            "# Standalone\n[[Target]]\n",
        )
        .unwrap();

        let idx = BacklinksIndex::new();
        idx.rebuild_from(|| Ok(root.clone()));

        assert_eq!(
            sources(&idx),
            [
                "daily/2026-01-01.md",
                "notes/2026-01-01.md",
                "notes/A/plan.md",
                "notes/B/plan.md"
            ]
        );

        idx.update_note_with("notes/A/plan.md", "# Plan A\nno links", &slug_resolver);
        idx.remove_note("daily/2026-01-01.md");
        assert_eq!(sources(&idx), ["notes/2026-01-01.md", "notes/B/plan.md"]);
        let links = idx.get("target.md", "Target");
        let plan = links.iter().find(|l| l.from_note == "plan.md").unwrap();
        assert_eq!(plan.from_path, "notes/B/plan.md");
        assert_eq!(plan.from_title, "Plan B");

        let _ = fs::remove_dir_all(&root);
    }

    fn sources(idx: &BacklinksIndex) -> Vec<String> {
        let mut paths: Vec<String> = idx
            .get("target.md", "Target")
            .into_iter()
            .map(|link| link.from_path)
            .collect();
        paths.sort();
        paths
    }

    #[test]
    fn moving_a_folder_rekeys_only_the_sources_inside_it() {
        let idx = BacklinksIndex::new();
        idx.update_note_with("notes/A/plan.md", "[[Target]]", &slug_resolver);
        idx.update_note_with("notes/A/Deep/plan.md", "[[Target]]", &slug_resolver);
        idx.update_note_with("notes/AB/plan.md", "[[Target]]", &slug_resolver);

        idx.move_folder("notes/A", "notes/Archive/A");

        assert_eq!(
            sources(&idx),
            [
                "notes/AB/plan.md",
                "notes/Archive/A/Deep/plan.md",
                "notes/Archive/A/plan.md"
            ]
        );
        idx.update_note_with("notes/Archive/A/plan.md", "no links", &slug_resolver);
        idx.remove_note("notes/Archive/A/Deep/plan.md");
        assert_eq!(sources(&idx), ["notes/AB/plan.md"]);
    }

    #[test]
    fn indexed_paths_match_what_a_rebuild_scans() {
        assert!(is_indexed_path("daily/2026-01-01.md"));
        assert!(is_indexed_path("weekly/2026-W01.md"));
        assert!(is_indexed_path("notes/A/B/plan.md"));
        assert!(!is_indexed_path("daily/nested/2026-01-01.md"));
        assert!(!is_indexed_path("notes/.hidden/plan.md"));
        assert!(!is_indexed_path("templates/plan.md"));
        assert!(!is_indexed_path("notes/plan.md.locked"));
        assert!(!is_indexed_path("plan.md"));
    }

    #[test]
    fn remove_all_clears_state() {
        let idx = BacklinksIndex::new();
        idx.update_note_with("a.md", "# A\n[[Target]]", &slug_resolver);
        idx.remove_all();
        assert_eq!(idx.get("target.md", "Target").len(), 0);
    }
}

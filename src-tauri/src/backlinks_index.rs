//! Shared in-memory backlinks index.
//!
//! Maintains an inverted index from target filename -> list of notes
//! that link to it, plus an outbound map from source filename -> set of
//! targets it currently references. This replaces O(n) full-disk scans
//! on every `get_backlinks` call.

use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::RwLock;

use crate::paths::{get_daily_dir, get_standalone_dir, get_weekly_dir};
use crate::types::BacklinkInfo;
use crate::wiki::{get_link_context, note_exists, note_name_to_filename, parse_wiki_links};

#[derive(Debug, Clone)]
pub(crate) struct Entry {
    pub(crate) from_note: String,
    pub(crate) from_title: String,
    pub(crate) context: String,
}

#[derive(Default)]
struct State {
    /// Keyed by resolved target filename (e.g. "meeting-notes.md").
    by_target: HashMap<String, Vec<Entry>>,
    /// Keyed by source filename; value is set of target filenames it links to.
    outbound: HashMap<String, HashSet<String>>,
}

pub(crate) struct BacklinksIndex {
    inner: RwLock<State>,
    ready: AtomicBool,
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
        let mut files: Vec<(String, String)> = Vec::new();

        let daily = get_daily_dir();
        collect_md_files_flat(&daily, &mut files);
        let weekly = get_weekly_dir();
        collect_md_files_flat(&weekly, &mut files);
        let standalone = get_standalone_dir();
        collect_md_files_recursive(&standalone, &mut files);

        // Reset state.
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

        for (filename, content) in files {
            self.update_note_with(&filename, &content, &default_resolver);
        }

        self.mark_ready();
    }

    /// Update (or insert) entries originating from `filename` based on
    /// `content`. Uses the real on-disk resolver.
    pub(crate) fn update_note(&self, filename: &str, content: &str) {
        self.update_note_with(filename, content, &default_resolver);
    }

    /// Same as `update_note` but allows injecting a resolver for tests.
    pub(crate) fn update_note_with(
        &self,
        filename: &str,
        content: &str,
        resolver: &Resolver,
    ) {
        let title = extract_title(content, filename);
        let link_names = parse_wiki_links(content);

        // Resolve targets and compute contexts (both slug-style and raw-name keys).
        let mut new_targets: HashSet<String> = HashSet::new();
        let mut new_entries: Vec<(String, Entry)> = Vec::new();

        for raw in &link_names {
            let resolved = resolver(raw);
            let context = get_link_context(content, raw);

            let entry = Entry {
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

        // Remove existing entries originating from this filename.
        remove_from_by_target(&mut state.by_target, filename);
        state.outbound.remove(filename);

        // Insert new entries.
        for (key, entry) in new_entries {
            state.by_target.entry(key).or_default().push(entry);
        }
        state.outbound.insert(filename.to_string(), new_targets);
    }

    pub(crate) fn remove_note(&self, filename: &str) {
        let mut state = match self.inner.write() {
            Ok(g) => g,
            Err(poisoned) => {
                log::warn!("backlinks index lock poisoned during remove; recovering");
                poisoned.into_inner()
            }
        };
        remove_from_by_target(&mut state.by_target, filename);
        state.outbound.remove(filename);
    }

    pub(crate) fn rename_note(&self, old: &str, new: &str, new_content: &str) {
        // First, re-key any entries whose target key equals `old` to `new`.
        {
            let mut state = match self.inner.write() {
                Ok(g) => g,
                Err(poisoned) => {
                    log::warn!("backlinks index lock poisoned during rename; recovering");
                    poisoned.into_inner()
                }
            };
            if let Some(entries) = state.by_target.remove(old) {
                state.by_target.entry(new.to_string()).or_default().extend(entries);
            }
        }
        // Drop old outbound / entries originating from old and re-insert under new.
        self.remove_note(old);
        self.update_note(new, new_content);
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

    /// Snapshot of the outbound link graph as (source, target) filename
    /// pairs. Only edges where the target resolved to a concrete filename
    /// (not a `__stem__:…` placeholder) are returned. The result is used
    /// to drive the graph-view overlay.
    pub(crate) fn outbound_edges(&self) -> Vec<(String, String)> {
        let state = match self.inner.read() {
            Ok(g) => g,
            Err(poisoned) => {
                log::warn!("backlinks index lock poisoned during edges read; recovering");
                poisoned.into_inner()
            }
        };

        let mut edges: Vec<(String, String)> = Vec::new();
        for (source, targets) in state.outbound.iter() {
            for target in targets {
                edges.push((source.clone(), target.clone()));
            }
        }
        edges
    }

    /// Get deduplicated backlinks for a target. `note_stem` is the raw
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
                if seen.insert(e.from_note.clone()) {
                    out.push(BacklinkInfo {
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

fn remove_from_by_target(
    by_target: &mut HashMap<String, Vec<Entry>>,
    from_note: &str,
) {
    let mut empty_keys: Vec<String> = Vec::new();
    for (k, v) in by_target.iter_mut() {
        v.retain(|e| e.from_note != from_note);
        if v.is_empty() {
            empty_keys.push(k.clone());
        }
    }
    for k in empty_keys {
        by_target.remove(&k);
    }
}

fn collect_md_files_flat(dir: &Path, out: &mut Vec<(String, String)>) {
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
        if !path.is_file() || path.extension().and_then(|s| s.to_str()) != Some("md") {
            continue;
        }
        let Some(filename) = path.file_name().and_then(|s| s.to_str()).map(|s| s.to_string())
        else {
            continue;
        };
        match fs::read_to_string(&path) {
            Ok(content) => {
                let body = crate::frontmatter::parse_note(&content).body;
                out.push((filename, body));
            }
            Err(err) => log::warn!("backlinks index: failed to read {:?}: {}", path, err),
        }
    }
}

fn collect_md_files_recursive(dir: &Path, out: &mut Vec<(String, String)>) {
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
            collect_md_files_recursive(&path, out);
        } else if path.is_file() && path.extension().and_then(|s| s.to_str()) == Some("md") {
            let Some(filename) =
                path.file_name().and_then(|s| s.to_str()).map(|s| s.to_string())
            else {
                continue;
            };
            match fs::read_to_string(&path) {
                Ok(content) => {
                let body = crate::frontmatter::parse_note(&content).body;
                out.push((filename, body));
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

    #[test]
    fn remove_all_clears_state() {
        let idx = BacklinksIndex::new();
        idx.update_note_with("a.md", "# A\n[[Target]]", &slug_resolver);
        idx.remove_all();
        assert_eq!(idx.get("target.md", "Target").len(), 0);
    }
}

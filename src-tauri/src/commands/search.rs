//! Bounded full-text search over visible, unlocked Markdown notes.
//!
//! Scans never follow symlinks or enter trash/internal directories. Results keep
//! the frontend addressing contract: daily and weekly notes use bare filenames,
//! while standalone notes retain their `notes/`-relative folder path. Snippets
//! are Unicode-boundary safe and result counts are capped by the caller's limit.

use std::fs;
use std::path::Path;
use walkdir::WalkDir;

use crate::paths::{get_notes_dir, get_trash_dir};
use crate::search_index::{self, SearchIndexStatus};
use crate::types::ContentMatch;

pub(crate) fn classify_note_path(
    notes_dir: &Path,
    file_path: &Path,
) -> Option<(String, bool, bool, Option<String>)> {
    let rel = file_path.strip_prefix(notes_dir).ok()?;
    let rel_str = rel.to_string_lossy().replace('\\', "/");
    let mut parts = rel_str.splitn(2, '/');
    let top = parts.next()?;
    let rest = parts.next().unwrap_or("");
    match top {
        "daily" => Some((rel_str.clone(), true, false, None)),
        "weekly" => Some((rel_str.clone(), false, true, None)),
        "notes" => {
            if rest.contains('/') {
                let folder = rest.rsplit_once('/').map(|(f, _)| f.to_string());
                Some((rel_str, false, false, folder))
            } else {
                Some((rel_str, false, false, None))
            }
        }
        _ => None,
    }
}

pub(crate) fn build_snippet(line: &str, term_lower: &str, max_width: usize) -> String {
    let line_lower = line.to_lowercase();
    let idx = line_lower.find(term_lower).unwrap_or(0);
    let half = max_width / 2;
    let start_byte = {
        let mut s = idx.saturating_sub(half);
        while !line.is_char_boundary(s) && s > 0 {
            s -= 1;
        }
        s
    };
    let end_target = (idx + term_lower.len() + half).min(line.len());
    let end_byte = {
        let mut e = end_target;
        while e < line.len() && !line.is_char_boundary(e) {
            e += 1;
        }
        e
    };
    let prefix = if start_byte > 0 { "…" } else { "" };
    let suffix = if end_byte < line.len() { "…" } else { "" };
    format!("{}{}{}", prefix, &line[start_byte..end_byte], suffix)
}

/// Snippet, 1-based line number and occurrence count for one note body.
///
/// Both search engines call this: the scan on the file it just read, the
/// persistent index on the body it stored. That is what makes a hit look
/// byte-identical whichever engine produced it. `term_lower` must already be
/// lowercased and non-empty; `None` means the term never occurs.
pub(crate) fn content_match_fields(
    content: &str,
    term_lower: &str,
) -> Option<(String, usize, u32)> {
    let content_lower = content.to_lowercase();
    if !content_lower.contains(term_lower) {
        return None;
    }
    let mut match_count: u32 = 0;
    let mut first_line_number: usize = 0;
    let mut first_snippet: Option<String> = None;
    // Reuse the already-lowercased content instead of lowercasing each
    // matched line again; `to_lowercase()` never inserts or removes line
    // breaks, so the two iterators stay aligned line-for-line.
    for (idx, (line, line_lower)) in content.lines().zip(content_lower.lines()).enumerate() {
        let occurrences = line_lower.matches(term_lower).count() as u32;
        if occurrences == 0 {
            continue;
        }
        if first_snippet.is_none() {
            first_line_number = idx + 1;
            first_snippet = Some(build_snippet(line, term_lower, 120));
        }
        match_count = match_count.saturating_add(occurrences);
    }
    first_snippet.map(|snippet| (snippet, first_line_number, match_count))
}

/// Ask the persistent index first, fall back to the live scan.
///
/// The index answers in single-digit milliseconds but is only trusted once it
/// has been reconciled against disk; an unbuilt, stale, locked or erroring
/// index returns `None` and a hit-less answer is retried against the scan, so
/// the pre-index behaviour always stays reachable.
pub(crate) fn search_notes_content_in(
    notes_dir: &Path,
    trash_dir: &Path,
    query: &str,
    max_results: u32,
) -> Vec<ContentMatch> {
    if let Some(hits) = search_index::query(notes_dir, notes_dir, query, max_results) {
        if !hits.is_empty() {
            return hits;
        }
    }
    scan_notes_content_in(notes_dir, trash_dir, query, max_results)
}

/// The original engine: walk the Forge and substring-match every note body.
pub(crate) fn scan_notes_content_in(
    notes_dir: &Path,
    trash_dir: &Path,
    query: &str,
    max_results: u32,
) -> Vec<ContentMatch> {
    let query = query.trim();
    if query.is_empty() {
        return Vec::new();
    }
    let term_lower = query.to_lowercase();
    let cap = max_results.clamp(1, 500) as usize;
    let mut results: Vec<ContentMatch> = Vec::new();

    let walker = WalkDir::new(notes_dir)
        .follow_links(false)
        .into_iter()
        .filter_entry(|entry| {
            // Skip the trash directory entirely
            if entry.path() == trash_dir {
                return false;
            }
            // Skip every hidden directory below the root (`.trash`,
            // `.index`, `.plugins`, …) — internal state must never
            // surface in search results.
            if entry.depth() > 0
                && entry.file_type().is_dir()
                && entry.file_name().to_string_lossy().starts_with('.')
            {
                return false;
            }
            true
        });

    for entry in walker.flatten() {
        if !entry.file_type().is_file() {
            continue;
        }
        let path = entry.path();
        let filename = match path.file_name().and_then(|n| n.to_str()) {
            Some(n) => n,
            None => continue,
        };
        // Only unlocked markdown files
        if filename.ends_with(".md.locked") {
            continue;
        }
        if !filename.ends_with(".md") {
            continue;
        }

        let Ok(raw) = fs::read_to_string(path) else {
            continue;
        };
        // Don't search YAML frontmatter — it would surface "color: red" as a
        // hit when the user searches for "red".
        let content = crate::frontmatter::parse_note(&raw).body;
        let Some((snippet, first_line_number, match_count)) =
            content_match_fields(&content, &term_lower)
        else {
            continue;
        };
        let Some((rel_path, is_daily, is_weekly, folder_path)) =
            classify_note_path(notes_dir, path)
        else {
            continue;
        };

        results.push(ContentMatch {
            filename: filename.to_string(),
            path: rel_path,
            snippet,
            line_number: first_line_number,
            match_count,
            is_daily,
            is_weekly,
            folder_path,
        });
    }

    results.sort_by(|a, b| {
        b.match_count
            .cmp(&a.match_count)
            .then_with(|| a.filename.cmp(&b.filename))
    });
    results.truncate(cap);
    results
}

/// Full-text search across all unlocked markdown notes.
///
/// Case-insensitive substring match. Skips `.md.locked` files and the
/// internal `.trash` directory. Results are sorted by match count desc.
#[tauri::command]
pub(crate) fn search_notes_content(
    query: String,
    max_results: u32,
) -> Result<Vec<ContentMatch>, String> {
    let notes_dir = get_notes_dir();
    let trash_dir = get_trash_dir();
    Ok(search_notes_content_in(
        &notes_dir,
        &trash_dir,
        &query,
        max_results,
    ))
}

/// Report the persistent keyword index for the active Forge.
#[tauri::command]
pub(crate) fn search_index_status() -> SearchIndexStatus {
    search_index::status(&get_notes_dir())
}

/// Throw the active Forge's keyword index away and build it again from disk.
/// Returns as soon as the work is queued; poll `search_index_status` for
/// `building`.
#[tauri::command]
pub(crate) fn search_index_rebuild() -> Result<(), String> {
    search_index::spawn_rebuild(get_notes_dir());
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp_notes_dir(tag: &str) -> std::path::PathBuf {
        let base = std::env::temp_dir().join(format!(
            "moldavite-search-{tag}-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir_all(base.join("notes")).unwrap();
        base
    }

    #[test]
    fn case_insensitive_match_keeps_the_original_case_in_the_snippet() {
        let base = tmp_notes_dir("case-insensitive-snippet");
        fs::write(
            base.join("notes/alpha.md"),
            "intro line\nThe Quick Brown Fox jumps\n",
        )
        .unwrap();

        let results = search_notes_content_in(&base, &base.join(".trash"), "quick brown", 10);
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].match_count, 1);
        // The snippet must preserve the note's original casing, not the
        // lowercased text used to find the match.
        assert!(results[0].snippet.contains("Quick Brown"));

        let _ = fs::remove_dir_all(&base);
    }
}

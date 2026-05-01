//! Full-text search over unlocked notes.

use std::fs;
use std::path::Path;
use walkdir::WalkDir;

use crate::paths::{get_notes_dir, get_trash_dir};
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

pub(crate) fn search_notes_content_in(
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
            entry.path() != trash_dir
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

        let Ok(raw) = fs::read_to_string(path) else { continue };
        // Don't search YAML frontmatter — it would surface "color: red" as a
        // hit when the user searches for "red".
        let content = crate::frontmatter::parse_note(&raw).body;
        let content_lower = content.to_lowercase();
        if !content_lower.contains(&term_lower) {
            continue;
        }

        let mut match_count: u32 = 0;
        let mut first_line_number: usize = 0;
        let mut first_snippet: Option<String> = None;
        for (idx, line) in content.lines().enumerate() {
            let line_lower = line.to_lowercase();
            let occurrences = line_lower.matches(&term_lower).count() as u32;
            if occurrences == 0 {
                continue;
            }
            if first_snippet.is_none() {
                first_line_number = idx + 1;
                first_snippet = Some(build_snippet(line, &term_lower, 120));
            }
            match_count = match_count.saturating_add(occurrences);
        }

        let Some(snippet) = first_snippet else { continue };
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
pub(crate) fn search_notes_content(query: String, max_results: u32) -> Result<Vec<ContentMatch>, String> {
    let notes_dir = get_notes_dir();
    let trash_dir = get_trash_dir();
    Ok(search_notes_content_in(
        &notes_dir,
        &trash_dir,
        &query,
        max_results,
    ))
}

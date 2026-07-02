//! Wiki link parsing and resolution helpers.

use lazy_static::lazy_static;
use regex::Regex;

use crate::paths::get_notes_dir;

// Wiki Link Regex
lazy_static! {
    // Matches [[Note Name]] or [[Display|note-name]]
    static ref WIKI_LINK_REGEX: Regex = Regex::new(r"\[\[([^\]|]+)(?:\|([^\]]+))?\]\]").unwrap();
}

pub(crate) fn parse_wiki_links(content: &str) -> Vec<String> {
    let mut links = Vec::new();

    for cap in WIKI_LINK_REGEX.captures_iter(content) {
        // Get the target (second capture group if exists, otherwise first)
        let target = cap
            .get(2)
            .or_else(|| cap.get(1))
            .map(|m| m.as_str().to_string())
            .unwrap_or_default();

        if !target.is_empty() {
            links.push(target);
        }
    }

    links
}

pub(crate) fn note_name_to_filename(note_name: &str) -> String {
    // Convert "Meeting Notes" -> "meeting-notes.md". Unicode-aware and NFC-
    // normalized so "Café" keeps its accent and resolves identically in the
    // frontend (which applies the same rule in slugifyNoteName).
    use unicode_normalization::UnicodeNormalization;
    let normalized: String = note_name.nfc().collect();
    let slug = normalized
        .to_lowercase()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join("-")
        .replace(|c: char| !c.is_alphanumeric() && c != '-', "");

    if slug.is_empty() {
        return "untitled.md".to_string();
    }
    format!("{}.md", slug)
}

pub(crate) fn note_exists(note_name: &str) -> Result<(bool, String), String> {
    let notes_dir = get_notes_dir();

    // Try as standalone note first
    let filename = note_name_to_filename(note_name);
    let standalone_path = notes_dir.join("notes").join(&filename);

    if standalone_path.exists() {
        return Ok((true, filename));
    }

    // Try as daily note (YYYY-MM-DD format)
    let daily_filename = if note_name.ends_with(".md") {
        note_name.to_string()
    } else {
        format!("{}.md", note_name)
    };
    let daily_path = notes_dir.join("daily").join(&daily_filename);
    if daily_path.exists() {
        return Ok((true, daily_filename));
    }

    Ok((false, filename))
}

/// Rewrite wiki-link targets that resolve to `old_stem` (a filename without
/// the `.md` extension) so they point at `new_stem` instead. Display text in
/// `[[Display|target]]` links is left untouched. Returns `Some(rewritten)`
/// when at least one link changed, `None` when the content is untouched.
pub(crate) fn rewrite_links_for_rename(
    content: &str,
    old_stem: &str,
    new_stem: &str,
) -> Option<String> {
    let old_slug = note_name_to_filename(old_stem);
    let mut changed = false;
    let result = WIKI_LINK_REGEX.replace_all(content, |caps: &regex::Captures| {
        let display = caps.get(1).map(|m| m.as_str()).unwrap_or("");
        let target = caps.get(2).map(|m| m.as_str());
        let effective = target.unwrap_or(display).trim();
        // A link matches if it names the old file directly or slugifies to it,
        // mirroring how links are resolved when clicked.
        let matches = !effective.is_empty()
            && (effective == old_stem || note_name_to_filename(effective) == old_slug);
        if matches {
            changed = true;
            match target {
                Some(_) => format!("[[{}|{}]]", display, new_stem),
                None => format!("[[{}]]", new_stem),
            }
        } else {
            caps.get(0).map(|m| m.as_str().to_string()).unwrap_or_default()
        }
    });
    if changed {
        Some(result.into_owned())
    } else {
        None
    }
}

pub(crate) fn get_link_context(content: &str, link_text: &str) -> String {
    // Try both with and without pipe syntax
    let search_patterns = vec![
        format!("[[{}]]", link_text),
        format!("[[{}|", link_text),
    ];

    for search in search_patterns {
        if let Some(pos) = content.find(&search) {
            let start = pos.saturating_sub(50);
            let end = (pos + search.len() + 50).min(content.len());

            // Find the actual end of the link
            let actual_end = if search.ends_with('|') {
                // Find the closing ]]
                content[pos..]
                    .find("]]")
                    .map(|p| (pos + p + 2 + 50).min(content.len()))
                    .unwrap_or(end)
            } else {
                end
            };

            let context = &content[start..actual_end];

            // Add ellipsis if truncated
            let mut result = String::new();
            if start > 0 {
                result.push_str("...");
            }
            result.push_str(context);
            if actual_end < content.len() {
                result.push_str("...");
            }

            return result;
        }
    }

    String::new()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_wiki_links_plain() {
        let links = parse_wiki_links("See [[Meeting Notes]] and [[Project Plan]].");
        assert_eq!(links, vec!["Meeting Notes", "Project Plan"]);
    }

    #[test]
    fn parse_wiki_links_with_display_alias() {
        // [[Display|target]] — the target (after the pipe) wins.
        let links = parse_wiki_links("Check [[click me|actual-target]] now.");
        assert_eq!(links, vec!["actual-target"]);
    }

    #[test]
    fn parse_wiki_links_ignores_empty_target() {
        // `[[]]` has an empty capture and must be dropped.
        let links = parse_wiki_links("Start [[]] then [[Real]] end.");
        assert_eq!(links, vec!["Real"]);
    }

    #[test]
    fn parse_wiki_links_does_not_panic_on_unclosed_brackets() {
        // Unclosed or garbled input must not panic; we don't over-specify
        // which links come back from greedy matching.
        let _ = parse_wiki_links("[[unclosed and [[ok]]");
    }

    #[test]
    fn parse_wiki_links_handles_none() {
        assert!(parse_wiki_links("plain text with no links").is_empty());
    }

    #[test]
    fn note_name_to_filename_slugifies() {
        assert_eq!(note_name_to_filename("Meeting Notes"), "meeting-notes.md");
        assert_eq!(note_name_to_filename("  Padded  "), "padded.md");
        // Special chars stripped; spaces become hyphens.
        assert_eq!(note_name_to_filename("Q1 / Q2 plan!"), "q1--q2-plan.md");
    }

    #[test]
    fn note_name_to_filename_preserves_unicode() {
        // Accents survive (no more Café/Cafe collision) and NFC-normalization
        // makes decomposed input equal to precomposed.
        assert_eq!(note_name_to_filename("Café"), "café.md");
        assert_eq!(note_name_to_filename("Cafe\u{0301}"), "café.md");
        assert_eq!(note_name_to_filename("日本語ノート"), "日本語ノート.md");
    }

    #[test]
    fn note_name_to_filename_falls_back_when_slug_is_empty() {
        assert_eq!(note_name_to_filename("!!!"), "untitled.md");
        assert_eq!(note_name_to_filename("   "), "untitled.md");
    }

    #[test]
    fn rewrite_links_updates_plain_links_matching_by_slug() {
        let content = "See [[Meeting Notes]] and [[Other]].";
        let out = rewrite_links_for_rename(content, "meeting-notes", "q3-planning").unwrap();
        assert_eq!(out, "See [[q3-planning]] and [[Other]].");
    }

    #[test]
    fn rewrite_links_updates_exact_stem_matches() {
        let content = "Daily ref [[2026-07-01]] here.";
        let out = rewrite_links_for_rename(content, "2026-07-01", "2026-07-02").unwrap();
        assert_eq!(out, "Daily ref [[2026-07-02]] here.");
    }

    #[test]
    fn rewrite_links_preserves_display_text_in_piped_links() {
        let content = "Check [[the plan|meeting-notes]] now.";
        let out = rewrite_links_for_rename(content, "meeting-notes", "q3-planning").unwrap();
        assert_eq!(out, "Check [[the plan|q3-planning]] now.");
    }

    #[test]
    fn rewrite_links_returns_none_when_nothing_matches() {
        assert!(rewrite_links_for_rename("See [[Unrelated]].", "meeting-notes", "x").is_none());
        assert!(rewrite_links_for_rename("no links", "meeting-notes", "x").is_none());
    }

    #[test]
    fn rewrite_links_does_not_touch_other_slugs_sharing_a_prefix() {
        let content = "See [[meeting-notes-archive]].";
        assert!(rewrite_links_for_rename(content, "meeting-notes", "x").is_none());
    }

    #[test]
    fn get_link_context_returns_surrounding_chars() {
        let content = "Some intro text before [[Target Note]] and some more stuff after it.";
        let context = get_link_context(content, "Target Note");
        assert!(context.contains("[[Target Note]]"));
        assert!(context.contains("before"));
        assert!(context.contains("after"));
    }

    #[test]
    fn get_link_context_supports_alias_syntax() {
        let content = "Start [[label|actual-target]] end.";
        let context = get_link_context(content, "label");
        assert!(context.contains("[[label|actual-target]]"));
    }

    #[test]
    fn get_link_context_returns_empty_when_missing() {
        assert_eq!(get_link_context("no matches here", "Nowhere"), "");
    }
}

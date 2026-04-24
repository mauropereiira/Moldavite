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
    // Convert "Meeting Notes" -> "meeting-notes.md"
    let slug = note_name
        .to_lowercase()
        .trim()
        .replace(' ', "-")
        .replace(|c: char| !c.is_alphanumeric() && c != '-', "");

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

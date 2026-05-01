//! YAML frontmatter parsing and serialization for notes.
//!
//! Notes can carry a leading YAML frontmatter block, fenced by `---` lines.
//! Currently only the `color` field is consumed by Moldavite, but the parser
//! preserves any additional keys so external tools (Obsidian, scripts) can
//! safely add their own metadata without it being clobbered on save.
//!
//! ```text
//! ---
//! color: blue
//! ---
//! Note body starts here.
//! ```

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

/// Parsed view of a note file: structured frontmatter (if any) + body.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct ParsedNote {
    /// Color id (e.g. "blue"). `None` means the note carries no color.
    pub color: Option<String>,
    /// All other frontmatter keys, preserved verbatim so we don't drop
    /// metadata written by external tools when we re-serialize.
    pub extra: BTreeMap<String, serde_yaml::Value>,
    /// The note body (everything after the closing `---`), with the leading
    /// newline that follows the fence stripped.
    pub body: String,
}

#[derive(Debug, Serialize, Deserialize, Default)]
struct RawFrontmatter {
    #[serde(skip_serializing_if = "Option::is_none")]
    color: Option<String>,
    #[serde(flatten)]
    extra: BTreeMap<String, serde_yaml::Value>,
}

/// Detect a leading `---` fence, allowing for an optional UTF-8 BOM.
fn strip_bom(input: &str) -> &str {
    input.strip_prefix('\u{FEFF}').unwrap_or(input)
}

/// Parse a note's raw text into frontmatter + body. If the text does not
/// begin with a `---` fence, the entire text is returned as the body.
pub fn parse_note(raw: &str) -> ParsedNote {
    let text = strip_bom(raw);

    // Frontmatter must start at the very beginning of the file.
    if !text.starts_with("---") {
        return ParsedNote {
            color: None,
            extra: BTreeMap::new(),
            body: text.to_string(),
        };
    }

    // Skip the opening fence. We accept "---\n" and "---\r\n".
    let after_open = match text.strip_prefix("---\r\n") {
        Some(rest) => rest,
        None => match text.strip_prefix("---\n") {
            Some(rest) => rest,
            None => {
                // Malformed (no newline after the fence) — treat as body.
                return ParsedNote {
                    color: None,
                    extra: BTreeMap::new(),
                    body: text.to_string(),
                };
            }
        },
    };

    // Find the closing fence on its own line.
    let mut end_idx: Option<usize> = None;
    let mut cursor = 0usize;
    for line in after_open.split_inclusive('\n') {
        let trimmed = line.trim_end_matches(['\r', '\n']);
        if trimmed == "---" || trimmed == "..." {
            end_idx = Some(cursor);
            break;
        }
        cursor += line.len();
    }

    let Some(end) = end_idx else {
        // No closing fence — treat the whole thing as body.
        return ParsedNote {
            color: None,
            extra: BTreeMap::new(),
            body: text.to_string(),
        };
    };

    let yaml_block = &after_open[..end];
    // Skip past the closing fence line (and its trailing newline).
    let after_close_start = end;
    let after_close = &after_open[after_close_start..];
    let body_start = after_close
        .strip_prefix("---\r\n")
        .or_else(|| after_close.strip_prefix("---\n"))
        .or_else(|| after_close.strip_prefix("...\r\n"))
        .or_else(|| after_close.strip_prefix("...\n"))
        .unwrap_or("");

    let parsed: RawFrontmatter = serde_yaml::from_str(yaml_block).unwrap_or_default();
    ParsedNote {
        color: parsed.color.filter(|s| !s.is_empty()),
        extra: parsed.extra,
        body: body_start.to_string(),
    }
}

/// Serialize a note back to disk format. If `color` is `None` and `extra` is
/// empty, the frontmatter block is omitted entirely so we don't pollute every
/// file.
pub fn serialize_note(color: Option<&str>, extra: &BTreeMap<String, serde_yaml::Value>, body: &str) -> String {
    let has_color = color.is_some_and(|c| !c.is_empty());
    if !has_color && extra.is_empty() {
        return body.to_string();
    }

    let raw = RawFrontmatter {
        color: color.filter(|s| !s.is_empty()).map(|s| s.to_string()),
        extra: extra.clone(),
    };
    let yaml = serde_yaml::to_string(&raw).unwrap_or_default();
    let yaml = yaml.trim_end_matches('\n');
    format!("---\n{}\n---\n{}", yaml, body)
}

/// Convenience: build a note string from just a color + body, preserving any
/// extra keys discovered in the existing on-disk content (so external metadata
/// survives round-trips).
pub fn write_with_color(existing_raw: &str, color: Option<&str>, body: &str) -> String {
    let existing = parse_note(existing_raw);
    serialize_note(color, &existing.extra, body)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_no_frontmatter() {
        let p = parse_note("hello world\n");
        assert_eq!(p.color, None);
        assert!(p.extra.is_empty());
        assert_eq!(p.body, "hello world\n");
    }

    #[test]
    fn parses_color_only() {
        let p = parse_note("---\ncolor: blue\n---\nhello\n");
        assert_eq!(p.color.as_deref(), Some("blue"));
        assert_eq!(p.body, "hello\n");
    }

    #[test]
    fn preserves_extra_keys() {
        let p = parse_note("---\ncolor: red\ntags: [a, b]\n---\nbody\n");
        assert_eq!(p.color.as_deref(), Some("red"));
        assert!(p.extra.contains_key("tags"));
        assert_eq!(p.body, "body\n");
    }

    #[test]
    fn round_trip_preserves_extra() {
        let original = "---\ncolor: blue\ntags:\n- one\n- two\n---\nthe body\n";
        let parsed = parse_note(original);
        let written = serialize_note(parsed.color.as_deref(), &parsed.extra, &parsed.body);
        let reparsed = parse_note(&written);
        assert_eq!(reparsed.color.as_deref(), Some("blue"));
        assert_eq!(reparsed.body, "the body\n");
        assert!(reparsed.extra.contains_key("tags"));
    }

    #[test]
    fn omits_frontmatter_when_no_color_or_extras() {
        let s = serialize_note(None, &BTreeMap::new(), "just body");
        assert_eq!(s, "just body");
    }

    #[test]
    fn malformed_fence_is_treated_as_body() {
        let raw = "---no newline";
        let p = parse_note(raw);
        assert_eq!(p.color, None);
        assert_eq!(p.body, raw);
    }

    #[test]
    fn missing_close_fence_is_treated_as_body() {
        let raw = "---\ncolor: blue\nthis never closes\n";
        let p = parse_note(raw);
        assert_eq!(p.color, None);
        assert_eq!(p.body, raw);
    }

    #[test]
    fn write_with_color_strips_existing_color() {
        let existing = "---\ncolor: blue\ntags: [x]\n---\nhi\n";
        let parsed = parse_note(existing);
        let out = serialize_note(None, &parsed.extra, &parsed.body);
        let reparsed = parse_note(&out);
        assert_eq!(reparsed.color, None);
        assert!(reparsed.extra.contains_key("tags"));
    }

    #[test]
    fn write_with_color_drops_frontmatter_when_nothing_left() {
        let existing = "---\ncolor: blue\n---\njust body\n";
        let out = write_with_color(existing, None, "just body\n");
        // No remaining metadata at all → no frontmatter.
        assert_eq!(out, "just body\n");
    }

    #[test]
    fn handles_bom() {
        let raw = "\u{FEFF}---\ncolor: green\n---\nx";
        let p = parse_note(raw);
        assert_eq!(p.color.as_deref(), Some("green"));
        assert_eq!(p.body, "x");
    }

    #[test]
    fn empty_color_treated_as_none() {
        let p = parse_note("---\ncolor: \n---\nbody");
        assert_eq!(p.color, None);
    }
}

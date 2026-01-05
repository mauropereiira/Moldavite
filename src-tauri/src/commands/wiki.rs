//! Wiki link operations
//!
//! This module handles wiki link-related Tauri commands including:
//! - Scanning note content for wiki links
//! - Finding backlinks (notes that link to a given note)
//! - Creating notes from wiki links
//!
//! # Wiki Link Syntax
//! - `[[Note Name]]` - link to "note-name.md"
//! - `[[Display Text|note-name]]` - link with custom display text

use crate::utils::get_notes_dir;
use lazy_static::lazy_static;
use regex::Regex;
use serde::{Deserialize, Serialize};

// =============================================================================
// DATA STRUCTURES
// =============================================================================

/// A wiki link found in note content
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct WikiLink {
    /// The display text of the link
    pub text: String,
    /// The target filename
    pub target: String,
    /// Whether the target note exists
    pub exists: bool,
}

/// Information about a backlink
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct BacklinkInfo {
    /// The filename of the note containing the link
    pub from_note: String,
    /// The title of the source note
    pub from_title: String,
    /// Context around the link
    pub context: String,
}

/// Link index entry (for future use)
#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LinkIndex {
    /// The note filename
    pub note: String,
    /// List of notes this one links to
    pub links_to: Vec<String>,
}

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

lazy_static! {
    /// Regex to match [[Note Name]] or [[Display|note-name]]
    pub static ref WIKI_LINK_REGEX: Regex =
        Regex::new(r"\[\[([^\]|]+)(?:\|([^\]]+))?\]\]").unwrap();
}

/// Parse wiki links from content
pub fn parse_wiki_links(content: &str) -> Vec<String> {
    let mut links = Vec::new();

    for cap in WIKI_LINK_REGEX.captures_iter(content) {
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

/// Convert a note name to a filename
pub fn note_name_to_filename(note_name: &str) -> String {
    let slug = note_name
        .to_lowercase()
        .trim()
        .replace(' ', "-")
        .replace(|c: char| !c.is_alphanumeric() && c != '-', "");

    format!("{}.md", slug)
}

/// Check if a note exists (returns (exists, filename))
pub fn note_exists(note_name: &str) -> Result<(bool, String), String> {
    let notes_dir = get_notes_dir();

    // Try as standalone note first
    let filename = note_name_to_filename(note_name);
    let standalone_path = notes_dir.join("notes").join(&filename);

    if standalone_path.exists() {
        return Ok((true, filename));
    }

    // Try as daily note
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

/// Get context around a link in content
pub fn get_link_context(content: &str, link_text: &str) -> String {
    let search_patterns = vec![format!("[[{}]]", link_text), format!("[[{}|", link_text)];

    for search in search_patterns {
        if let Some(pos) = content.find(&search) {
            let start = pos.saturating_sub(50);
            let end = (pos + search.len() + 50).min(content.len());

            let actual_end = if search.ends_with('|') {
                content[pos..]
                    .find("]]")
                    .map(|p| (pos + p + 2 + 50).min(content.len()))
                    .unwrap_or(end)
            } else {
                end
            };

            let context = &content[start..actual_end];

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

// =============================================================================
// TAURI COMMANDS
// =============================================================================

// Note: The actual Tauri command implementations remain in lib.rs for now.
// This module defines the shared types and helper functions.
//
// Commands to be migrated here:
// - scan_note_links
// - get_backlinks
// - create_note_from_link

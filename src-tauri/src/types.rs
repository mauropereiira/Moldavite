//! Serializable data structures shared across domains.

use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct NoteFile {
    pub(crate) name: String,
    pub(crate) path: String,
    pub(crate) is_daily: bool,
    pub(crate) is_weekly: bool,
    pub(crate) date: Option<String>,
    pub(crate) week: Option<String>,
    pub(crate) is_locked: bool,
    pub(crate) folder_path: Option<String>,
    /// Unix timestamp (seconds) of last filesystem modification, if known.
    pub(crate) modified_at: Option<i64>,
}

// Folder System Data Structures

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub(crate) struct FolderInfo {
    pub(crate) name: String,
    pub(crate) path: String,
    pub(crate) children: Vec<FolderInfo>,
}

// Trash System Data Structures

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TrashedNote {
    pub(crate) id: String,
    pub(crate) filename: String,
    pub(crate) original_path: String,
    pub(crate) is_daily: bool,
    pub(crate) is_folder: bool,
    pub(crate) contained_files: Vec<String>,
    pub(crate) trashed_at: i64,
    pub(crate) days_remaining: i32,
}

#[derive(Debug, Serialize, Deserialize, Default)]
pub(crate) struct TrashMetadata {
    pub(crate) items: Vec<TrashedNoteMetadata>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub(crate) struct TrashedNoteMetadata {
    pub(crate) id: String,
    pub(crate) filename: String,
    pub(crate) original_path: String,
    pub(crate) is_daily: bool,
    #[serde(default)]
    pub(crate) is_folder: bool,
    #[serde(default)]
    pub(crate) contained_files: Vec<String>,
    pub(crate) trashed_at: i64,
}

// Template System Data Structures

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Template {
    pub(crate) id: String,
    pub(crate) name: String,
    pub(crate) description: String,
    pub(crate) icon: String,
    pub(crate) is_default: bool,
    pub(crate) content: String,
}

#[derive(Debug, Deserialize)]
pub(crate) struct SaveTemplateInput {
    pub(crate) name: String,
    pub(crate) description: String,
    pub(crate) icon: String,
    pub(crate) content: String,
}

// Wiki Link System Data Structures

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub(crate) struct WikiLink {
    pub(crate) text: String,
    pub(crate) target: String,
    pub(crate) exists: bool,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub(crate) struct BacklinkInfo {
    pub(crate) from_note: String,
    pub(crate) from_title: String,
    pub(crate) context: String,
}

// App Configuration for custom notes directory + multi-Forge support.
//
// `forges_root` is the parent directory that holds one or more Forge
// directories. `active_forge` is the directory name (immediate child of
// `forges_root`) that should be treated as the live Forge.
//
// `notes_directory` is deprecated and retained for one release as a
// fallback for users upgrading from single-Forge layouts. New code reads
// `forges_root` + `active_forge`; the migration on startup wraps the
// legacy directory into a Forge and clears the deprecated field.
#[derive(Debug, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AppConfig {
    pub(crate) notes_directory: Option<String>,
    pub(crate) forges_root: Option<String>,
    pub(crate) active_forge: Option<String>,
}

// Public-facing struct returned by the `list_forges` command.
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ForgeInfo {
    pub(crate) name: String,
    pub(crate) path: String,
    pub(crate) is_active: bool,
}

// Export/Import Result structures
#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ImportResult {
    pub(crate) daily_notes: u32,
    pub(crate) standalone_notes: u32,
    pub(crate) templates: u32,
    pub(crate) images: u32,
}

/// Read result for a note: body content with frontmatter stripped, plus the
/// color (if any) parsed from frontmatter.
#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct NoteRead {
    pub(crate) content: String,
    pub(crate) color: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ContentMatch {
    pub(crate) filename: String,
    pub(crate) path: String,
    pub(crate) snippet: String,
    pub(crate) line_number: usize,
    pub(crate) match_count: u32,
    pub(crate) is_daily: bool,
    pub(crate) is_weekly: bool,
    pub(crate) folder_path: Option<String>,
}

//! Note graph command — scans the same visible Markdown trees as the
//! backlinks index and returns path-addressed nodes plus wiki-link edges.
//!
//! Existing notes use their Forge-relative path as the stable node id
//! (`daily/...`, `weekly/...`, or `notes/...`). Broken wiki-links use a
//! `missing:` id, so a missing target can never collide with a real note.

use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::Path;

use serde::Serialize;

use crate::paths::get_notes_dir;
use crate::wiki::{note_name_to_filename, parse_wiki_links};

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct GraphNode {
    /// Forge-relative note path, or `missing:<filename>` for a broken link.
    pub(crate) id: String,
    /// Human-readable label. Folder notes include their folder path.
    pub(crate) name: String,
    pub(crate) is_missing: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct GraphEdge {
    pub(crate) source: String,
    pub(crate) target: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct NoteGraph {
    pub(crate) nodes: Vec<GraphNode>,
    pub(crate) edges: Vec<GraphEdge>,
}

struct GraphFile {
    id: String,
    filename: String,
    name: String,
    body: String,
}

fn display_name(id: &str) -> String {
    id.strip_prefix("notes/")
        .or_else(|| id.strip_prefix("daily/"))
        .or_else(|| id.strip_prefix("weekly/"))
        .unwrap_or(id)
        .strip_suffix(".md")
        .unwrap_or(id)
        .to_string()
}

fn relative_id(root: &Path, path: &Path) -> Option<String> {
    path.strip_prefix(root)
        .ok()
        .map(|relative| relative.to_string_lossy().replace('\\', "/"))
}

fn read_graph_file(root: &Path, path: &Path) -> Option<GraphFile> {
    if path.extension().and_then(|ext| ext.to_str()) != Some("md") {
        return None;
    }
    let id = relative_id(root, path)?;
    let filename = path.file_name()?.to_str()?.to_string();
    match fs::read_to_string(path) {
        Ok(raw) => Some(GraphFile {
            name: display_name(&id),
            id,
            filename,
            body: crate::frontmatter::parse_note(&raw).body,
        }),
        Err(error) => {
            log::warn!("graph: failed to read {:?}: {}", path, error);
            None
        }
    }
}

fn collect_flat(root: &Path, dir: &Path, files: &mut Vec<GraphFile>) {
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if fs::symlink_metadata(&path)
            .map(|metadata| metadata.file_type().is_symlink())
            .unwrap_or(false)
        {
            continue;
        }
        if path.is_file() {
            if let Some(file) = read_graph_file(root, &path) {
                files.push(file);
            }
        }
    }
}

fn collect_recursive(root: &Path, dir: &Path, files: &mut Vec<GraphFile>) {
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if fs::symlink_metadata(&path)
            .map(|metadata| metadata.file_type().is_symlink())
            .unwrap_or(false)
        {
            continue;
        }
        if path.is_dir() {
            let name = path
                .file_name()
                .and_then(|part| part.to_str())
                .unwrap_or("");
            if !name.starts_with('.') {
                collect_recursive(root, &path, files);
            }
        } else if let Some(file) = read_graph_file(root, &path) {
            files.push(file);
        }
    }
}

fn collect_graph_files(root: &Path) -> Vec<GraphFile> {
    let mut files = Vec::new();
    collect_flat(root, &root.join("daily"), &mut files);
    collect_flat(root, &root.join("weekly"), &mut files);
    collect_recursive(root, &root.join("notes"), &mut files);
    files.sort_by(|a, b| a.id.cmp(&b.id));
    files
}

/// Match the established wiki-link lookup preference: a standalone root note,
/// then daily, weekly, and finally a nested standalone note. The latter two
/// extend the old backlinks resolver, which did not find those visible notes.
fn resolution_rank(id: &str) -> (u8, &str) {
    let rank = if id.starts_with("notes/") && !id["notes/".len()..].contains('/') {
        0
    } else if id.starts_with("daily/") {
        1
    } else if id.starts_with("weekly/") {
        2
    } else {
        3
    };
    (rank, id)
}

fn resolve_target(
    raw_target: &str,
    by_filename: &HashMap<String, Vec<&GraphFile>>,
) -> Option<String> {
    let trimmed = raw_target.trim();
    if trimmed.is_empty() {
        return None;
    }
    let direct = if trimmed.ends_with(".md") {
        trimmed.to_string()
    } else {
        format!("{trimmed}.md")
    };
    let slug = target_filename(trimmed);

    for candidate in [direct, slug] {
        if let Some(matches) = by_filename.get(&candidate) {
            if let Some(found) = matches.iter().min_by_key(|file| resolution_rank(&file.id)) {
                return Some(found.id.clone());
            }
        }
    }
    None
}

fn target_filename(raw_target: &str) -> String {
    note_name_to_filename(
        raw_target
            .trim()
            .strip_suffix(".md")
            .unwrap_or(raw_target.trim()),
    )
}

fn build_note_graph(root: &Path) -> NoteGraph {
    let files = collect_graph_files(root);
    let mut by_filename: HashMap<String, Vec<&GraphFile>> = HashMap::new();
    for file in &files {
        by_filename
            .entry(file.filename.clone())
            .or_default()
            .push(file);
    }

    let mut nodes: Vec<GraphNode> = files
        .iter()
        .map(|file| GraphNode {
            id: file.id.clone(),
            name: file.name.clone(),
            is_missing: false,
        })
        .collect();
    let mut missing_nodes: HashMap<String, GraphNode> = HashMap::new();
    let mut edges: HashSet<GraphEdge> = HashSet::new();

    for file in &files {
        for raw_target in parse_wiki_links(&file.body) {
            let target = resolve_target(&raw_target, &by_filename).unwrap_or_else(|| {
                let filename = target_filename(&raw_target);
                let id = format!("missing:{filename}");
                missing_nodes
                    .entry(id.clone())
                    .or_insert_with(|| GraphNode {
                        id: id.clone(),
                        name: filename
                            .strip_suffix(".md")
                            .unwrap_or(&filename)
                            .to_string(),
                        is_missing: true,
                    });
                id
            });
            if file.id != target {
                edges.insert(GraphEdge {
                    source: file.id.clone(),
                    target,
                });
            }
        }
    }

    nodes.extend(missing_nodes.into_values());
    nodes.sort_by(|a, b| a.id.cmp(&b.id));
    let mut edges: Vec<GraphEdge> = edges.into_iter().collect();
    edges.sort_by(|a, b| a.source.cmp(&b.source).then(a.target.cmp(&b.target)));

    NoteGraph { nodes, edges }
}

#[tauri::command]
pub(crate) fn get_note_graph() -> Result<NoteGraph, String> {
    Ok(build_note_graph(&get_notes_dir()))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_vault() -> std::path::PathBuf {
        let root = std::env::temp_dir().join(format!(
            "moldavite-graph-test-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        for dir in [
            "daily",
            "weekly",
            "notes/Projects",
            "notes/.index",
            ".trash",
        ] {
            fs::create_dir_all(root.join(dir)).unwrap();
        }
        root
    }

    fn node_ids(graph: &NoteGraph) -> HashSet<&str> {
        graph.nodes.iter().map(|node| node.id.as_str()).collect()
    }

    #[test]
    fn includes_nested_notes_and_broken_links_but_excludes_hidden_trees() {
        let root = make_vault();
        fs::write(
            root.join("notes/source.md"),
            "[[Nested Target]] [[2026-W28]] [[Ghost Note.md]]",
        )
        .unwrap();
        fs::write(root.join("notes/Projects/nested-target.md"), "# Nested").unwrap();
        fs::write(root.join("weekly/2026-W28.md"), "# Week").unwrap();
        fs::write(root.join("notes/.index/hidden.md"), "[[Ghost Note]]").unwrap();
        fs::write(root.join(".trash/trashed.md"), "[[Ghost Note]]").unwrap();

        let graph = build_note_graph(&root);
        let ids = node_ids(&graph);
        assert!(ids.contains("notes/Projects/nested-target.md"));
        assert!(ids.contains("weekly/2026-W28.md"));
        assert!(ids.contains("missing:ghost-note.md"));
        assert!(!ids.contains("notes/.index/hidden.md"));
        assert!(!ids.contains(".trash/trashed.md"));
        assert!(graph.edges.contains(&GraphEdge {
            source: "notes/source.md".to_string(),
            target: "notes/Projects/nested-target.md".to_string(),
        }));
        assert!(graph.edges.contains(&GraphEdge {
            source: "notes/source.md".to_string(),
            target: "weekly/2026-W28.md".to_string(),
        }));
        fs::remove_dir_all(root).ok();
    }

    #[test]
    fn path_ids_keep_same_named_notes_distinct_and_choose_a_stable_target() {
        let root = make_vault();
        fs::write(root.join("daily/shared.md"), "# Daily").unwrap();
        fs::write(root.join("notes/Projects/shared.md"), "# Project").unwrap();
        fs::write(root.join("notes/source.md"), "[[shared]]").unwrap();

        let graph = build_note_graph(&root);
        let ids = node_ids(&graph);
        assert!(ids.contains("daily/shared.md"));
        assert!(ids.contains("notes/Projects/shared.md"));
        assert!(graph.edges.contains(&GraphEdge {
            source: "notes/source.md".to_string(),
            target: "daily/shared.md".to_string(),
        }));
        fs::remove_dir_all(root).ok();
    }

    #[test]
    fn rebuilding_reflects_renames_without_stale_index_nodes() {
        let root = make_vault();
        fs::write(root.join("notes/old-name.md"), "# Old").unwrap();
        fs::write(root.join("notes/source.md"), "[[old-name]]").unwrap();
        assert!(node_ids(&build_note_graph(&root)).contains("notes/old-name.md"));

        fs::rename(
            root.join("notes/old-name.md"),
            root.join("notes/new-name.md"),
        )
        .unwrap();
        fs::write(root.join("notes/source.md"), "[[new-name]]").unwrap();
        let graph = build_note_graph(&root);
        let ids = node_ids(&graph);
        assert!(!ids.contains("notes/old-name.md"));
        assert!(ids.contains("notes/new-name.md"));
        assert!(graph.edges.contains(&GraphEdge {
            source: "notes/source.md".to_string(),
            target: "notes/new-name.md".to_string(),
        }));
        fs::remove_dir_all(root).ok();
    }
}

//! Note graph command — returns nodes (notes) and edges (wiki-links) for
//! the graph-view overlay.
//!
//! Node set is the union of:
//!   * every note currently known to the backlinks index (i.e. every note
//!     that's been indexed on disk), and
//!   * every edge target, even if the target note doesn't exist on disk
//!     yet — so broken links still surface as placeholder nodes.
//!
//! Edges are deduplicated (source, target) pairs and self-loops are
//! filtered out so the force layout doesn't blow up.

use std::collections::{HashMap, HashSet};
use std::sync::Arc;

use serde::Serialize;
use tauri::State;

use crate::backlinks_index::BacklinksIndex;
use crate::paths::{get_daily_dir, get_standalone_dir, get_weekly_dir};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct GraphNode {
    /// Filename including `.md` extension — stable identifier.
    pub(crate) id: String,
    /// Display name (filename without extension).
    pub(crate) name: String,
}

#[derive(Debug, Serialize)]
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

fn display_name(filename: &str) -> String {
    filename.strip_suffix(".md").unwrap_or(filename).to_string()
}

fn collect_note_filenames() -> HashSet<String> {
    let mut set: HashSet<String> = HashSet::new();
    for dir in [get_daily_dir(), get_weekly_dir(), get_standalone_dir()] {
        collect_md_filenames(&dir, &mut set);
    }
    set
}

fn collect_md_filenames(dir: &std::path::Path, out: &mut HashSet<String>) {
    if !dir.exists() {
        return;
    }
    let entries = match std::fs::read_dir(dir) {
        Ok(e) => e,
        Err(_) => return,
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if std::fs::symlink_metadata(&path)
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
            collect_md_filenames(&path, out);
        } else if path.is_file() && path.extension().and_then(|s| s.to_str()) == Some("md") {
            if let Some(filename) = path.file_name().and_then(|s| s.to_str()) {
                out.insert(filename.to_string());
            }
        }
    }
}

#[tauri::command]
pub(crate) fn get_note_graph(index: State<'_, Arc<BacklinksIndex>>) -> Result<NoteGraph, String> {
    if !index.is_ready() {
        index.rebuild_from_disk();
    }

    let edges_raw = index.outbound_edges();

    // Build node set from on-disk files plus every edge endpoint.
    let mut nodes_set: HashSet<String> = collect_note_filenames();
    for (src, tgt) in &edges_raw {
        nodes_set.insert(src.clone());
        nodes_set.insert(tgt.clone());
    }

    // Deduplicate edges and drop self-loops.
    let mut edge_set: HashSet<(String, String)> = HashSet::new();
    for (src, tgt) in edges_raw {
        if src == tgt {
            continue;
        }
        edge_set.insert((src, tgt));
    }

    // Stable, deterministic ordering (keeps tests and the client-side
    // layout from flickering run-to-run).
    let mut nodes: Vec<GraphNode> = nodes_set
        .into_iter()
        .map(|id| GraphNode {
            name: display_name(&id),
            id,
        })
        .collect();
    nodes.sort_by(|a, b| a.id.cmp(&b.id));

    let mut edges: Vec<GraphEdge> = edge_set
        .into_iter()
        .map(|(source, target)| GraphEdge { source, target })
        .collect();
    edges.sort_by(|a, b| a.source.cmp(&b.source).then(a.target.cmp(&b.target)));

    // Drop edges whose endpoints aren't in the node set (defensive; should
    // never happen because we inserted endpoints above).
    let node_ids: HashMap<&String, ()> = nodes.iter().map(|n| (&n.id, ())).collect();
    edges.retain(|e| node_ids.contains_key(&e.source) && node_ids.contains_key(&e.target));

    Ok(NoteGraph { nodes, edges })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn display_name_strips_md_suffix() {
        assert_eq!(display_name("meeting-notes.md"), "meeting-notes");
        assert_eq!(display_name("no-extension"), "no-extension");
    }
}

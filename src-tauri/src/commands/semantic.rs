//! Semantic (vector) search commands.
//!
//! `semantic_set_enabled(true)` is the single consent point: it persists the
//! flag and spawns the one-time model download followed by a full index
//! build. Progress is streamed to the frontend via `semantic:progress`
//! events (`{ phase: "downloading" | "indexing", done, total }`) and the
//! flow finishes with `semantic:ready` (`{ indexedCount }`) or
//! `semantic:error` (`{ error }`).
//! Disabling cancels in-flight work and removes the per-Forge index; model
//! changes invalidate vectors built with the previous model. The service module
//! owns embedding and persistence, while this module owns consent and Tauri events.

use std::sync::Arc;

use serde::Serialize;
use tauri::{AppHandle, Emitter};

use crate::paths::get_notes_dir;
use crate::persist::{read_config, write_config};
use crate::semantic::{self, Embedder, ModelInfo, Phase, SemanticHit, CANCELLED};

/// Snapshot of the semantic-search lifecycle for the frontend.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SemanticStatus {
    pub(crate) enabled: bool,
    pub(crate) model_ready: bool,
    pub(crate) indexed_count: usize,
    /// "disabled" | "downloading" | "indexing" | "ready" | "error"
    pub(crate) state: String,
    pub(crate) error: Option<String>,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct SemanticProgress {
    phase: &'static str,
    done: usize,
    total: usize,
}

fn semantic_enabled_in_config() -> bool {
    read_config().semantic_enabled.unwrap_or(false)
}

#[tauri::command]
pub(crate) fn semantic_status() -> SemanticStatus {
    let svc = semantic::service();
    let phase = svc.phase();
    let model_id = semantic::configured_model_id();
    SemanticStatus {
        enabled: semantic_enabled_in_config(),
        model_ready: svc.embedder().is_some() || semantic::model_files_cached(&model_id),
        indexed_count: svc.indexed_count(),
        state: phase.as_str().to_string(),
        error: match phase {
            Phase::Error(e) => Some(e),
            _ => None,
        },
    }
}

/// Curated local embedding models, including which configured id is active.
#[tauri::command]
pub(crate) fn semantic_models() -> Vec<ModelInfo> {
    semantic::models()
}

/// Persist a curated model selection. When semantic search is enabled, a
/// genuine change unloads the old model and starts a full rebuild with the
/// new one (including a one-time download when it is not cached yet).
#[tauri::command]
pub(crate) fn semantic_set_model(id: String, app: AppHandle) -> Result<(), String> {
    semantic::model_info(&id)?;
    let mut cfg = read_config();
    let previous = cfg
        .semantic_model
        .clone()
        .unwrap_or_else(|| semantic::DEFAULT_MODEL_ID.to_string());
    if previous == id {
        return Ok(());
    }
    if cfg.semantic_enabled.unwrap_or(false) && semantic::service().is_building() {
        return Err("Wait for the current semantic index build to finish before changing models"
            .to_string());
    }
    cfg.semantic_model = Some(id);
    let enabled = cfg.semantic_enabled.unwrap_or(false);
    write_config(&cfg)?;
    if enabled {
        semantic::service().disable();
        spawn_semantic_build(app, true);
    }
    Ok(())
}

/// Toggle semantic search. First enable triggers the one-time model
/// download and a full index build (both async — watch the events).
/// Disabling frees the model and the in-memory vectors; the on-disk index
/// is kept so a later re-enable only re-embeds notes that changed.
#[tauri::command]
pub(crate) fn semantic_set_enabled(enabled: bool, app: AppHandle) -> Result<(), String> {
    let mut cfg = read_config();
    cfg.semantic_enabled = Some(enabled);
    write_config(&cfg)?;
    if enabled {
        spawn_semantic_build(app, false);
    } else {
        semantic::service().disable();
    }
    Ok(())
}

/// Embed the query locally and return the `limit` most similar notes.
#[tauri::command]
pub(crate) fn semantic_search(query: String, limit: u32) -> Result<Vec<SemanticHit>, String> {
    semantic::service().search(&query, limit as usize)
}

/// Nearest neighbours of an indexed note (by forge-relative path such as
/// `notes/Projects/foo.md`), excluding the note itself.
#[tauri::command]
pub(crate) fn semantic_related(path: String, limit: u32) -> Result<Vec<SemanticHit>, String> {
    semantic::service().related(&path, limit as usize)
}

/// Discard the current index and re-embed every note from scratch.
#[tauri::command]
pub(crate) fn semantic_reindex(app: AppHandle) -> Result<(), String> {
    if !semantic_enabled_in_config() {
        return Err("Semantic search is disabled".to_string());
    }
    spawn_semantic_build(app, true);
    Ok(())
}

/// Called by `set_active_forge`: the in-memory vectors belong to the old
/// vault, so drop them and (if the feature is on) build/load the new
/// Forge's index in the background.
pub(crate) fn on_forge_switched(app: AppHandle) {
    semantic::service().reset_for_forge_switch();
    if semantic_enabled_in_config() {
        spawn_semantic_build(app, false);
    }
}

/// Spawn the (single) background build task: ensure the model is loaded
/// (downloading it if this is the first enable), then reconcile the index
/// against the vault. `force` ignores the existing index and re-embeds
/// everything.
pub(crate) fn spawn_semantic_build(app: AppHandle, force: bool) {
    let svc = semantic::service();
    if !svc.try_begin_build() {
        return;
    }
    tauri::async_runtime::spawn_blocking(move || {
        let result = run_build(&app, force);
        let svc = semantic::service();
        svc.end_build();
        match result {
            Ok(indexed_count) => {
                svc.set_phase(Phase::Ready);
                let _ = app.emit(
                    "semantic:ready",
                    serde_json::json!({ "indexedCount": indexed_count }),
                );
            }
            Err(e) if e == CANCELLED => {
                // User disabled (or switched Forge) mid-build — not an error.
            }
            Err(e) => {
                svc.set_phase(Phase::Error(e.clone()));
                let _ = app.emit("semantic:error", serde_json::json!({ "error": e }));
            }
        }
    });
}

fn emit_progress(app: &AppHandle, phase: &'static str, done: usize, total: usize) {
    let _ = app.emit("semantic:progress", SemanticProgress { phase, done, total });
}

fn run_build(app: &AppHandle, force: bool) -> Result<usize, String> {
    let svc = semantic::service();
    let model_id = semantic::configured_model_id();
    semantic::model_info(&model_id)?;

    // Phase 1: model. Only reachable through the explicit enable flow (or a
    // restart with the feature already enabled), so downloading here is
    // always user-consented. fastembed's download is all-or-nothing, so
    // progress is indeterminate: 0/0 while running, 1/1 when done.
    let embedder: Arc<dyn Embedder> = match svc.embedder() {
        Some(e) => e,
        None => {
            svc.set_phase(Phase::Downloading);
            emit_progress(app, "downloading", 0, 0);
            let e: Arc<dyn Embedder> =
                Arc::new(semantic::init_fastembed_embedder(&model_id)?);
            svc.set_embedder(e.clone());
            emit_progress(app, "downloading", 1, 1);
            e
        }
    };
    if matches!(svc.phase(), Phase::Disabled) {
        return Err(CANCELLED.to_string());
    }

    // Phase 2: index build/reconcile.
    svc.set_phase(Phase::Indexing);
    let forge_root = get_notes_dir();
    let existing = if force {
        Vec::new()
    } else {
        semantic::load_index(&forge_root, &model_id).unwrap_or_default()
    };
    let entries = semantic::reconcile_index(
        &forge_root,
        embedder.as_ref(),
        &existing,
        |done, total| {
            // Throttle events on big vaults; always emit the final one.
            let step = (total / 50).max(1);
            if done % step == 0 || done == total {
                emit_progress(app, "indexing", done, total);
            }
            // `disable()` flips the phase; abort instead of finishing a
            // build the user just turned off.
            !matches!(semantic::service().phase(), Phase::Disabled)
        },
    )?;
    // A Forge switch mid-build means these entries belong to the old vault.
    if get_notes_dir() != forge_root {
        return Err(CANCELLED.to_string());
    }
    semantic::save_index(&forge_root, &entries, &model_id)?;
    let indexed_count = entries.len();
    semantic::service().replace_entries(entries);
    Ok(indexed_count)
}

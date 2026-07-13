/**
 * IPC wrappers for the local semantic (vector) search backend.
 *
 * Semantic search is opt-in: `setSemanticEnabled(true)` is the single consent
 * point — the first enable downloads the selected embedding model (one-time,
 * from HuggingFace, cached in the app data dir) and then builds a per-Forge
 * vector index. Everything afterwards runs fully offline; note content never
 * leaves the machine.
 * This module owns only typed IPC shapes and limits; lifecycle event subscription
 * and UI state reconciliation belong to `stores/semanticStore.ts`.
 *
 * Progress streams via Tauri events (subscribed in `semanticStore`):
 * - `semantic:progress` — `{ phase: "downloading" | "indexing", done, total }`
 *   (the download is all-or-nothing, so its progress is indeterminate: 0/0
 *   while running, 1/1 when done)
 * - `semantic:ready`    — `{ indexedCount }`
 * - `semantic:error`    — `{ error }`
 */

import { safeInvoke as invoke } from './ipc';

/** Lifecycle state reported by the backend `semantic_status` command. */
export type SemanticState = 'disabled' | 'downloading' | 'indexing' | 'ready' | 'error';

/** Shape of the Rust `SemanticStatus` struct (camelCase over IPC). */
export interface SemanticStatus {
  enabled: boolean;
  modelReady: boolean;
  indexedCount: number;
  state: SemanticState;
  error: string | null;
}

/** One curated local embedding model returned by `semantic_models`. */
export interface SemanticModelInfo {
  id: string;
  label: string;
  downloadSizeMb: number;
  dims: number;
  description: string;
  active: boolean;
}

/** One hit from `semantic_search` / `semantic_related`. */
export interface SemanticHit {
  /** Forge-relative path, e.g. "notes/Projects/foo.md" or "daily/2026-07-12.md". */
  path: string;
  title: string;
  /** Cosine similarity in [0, 1] — higher is closer. */
  score: number;
}

/** Payload of the `semantic:progress` event. */
export interface SemanticProgress {
  phase: 'downloading' | 'indexing';
  done: number;
  total: number;
}

/** Default number of hits requested for a semantic search query. */
export const SEMANTIC_SEARCH_LIMIT = 20;
/** Default number of "Related notes" shown for the current note. */
export const SEMANTIC_RELATED_LIMIT = 5;

/** Snapshot of the semantic-search lifecycle. */
export function getSemanticStatus(): Promise<SemanticStatus> {
  return invoke<SemanticStatus>('semantic_status');
}

/** Curated embedding models, with the configured selection marked active. */
export function getSemanticModels(): Promise<SemanticModelInfo[]> {
  return invoke<SemanticModelInfo[]>('semantic_models');
}

/** Persist a model selection and rebuild immediately when the feature is on. */
export function setSemanticModel(id: string): Promise<void> {
  return invoke<void>('semantic_set_model', { id });
}

/**
 * Toggle the feature. Enabling for the first time triggers the one-time
 * model download followed by a full index build (both async — watch the
 * events). Disabling frees the model and in-memory vectors; the on-disk
 * index is kept so re-enabling only re-embeds changed notes.
 */
export function setSemanticEnabled(enabled: boolean): Promise<void> {
  return invoke<void>('semantic_set_enabled', { enabled });
}

/** Embed `query` locally and return the most similar notes. */
export function semanticSearch(
  query: string,
  limit: number = SEMANTIC_SEARCH_LIMIT
): Promise<SemanticHit[]> {
  return invoke<SemanticHit[]>('semantic_search', { query, limit });
}

/**
 * Nearest neighbours of an indexed note (by forge-relative path such as
 * `notes/Projects/foo.md`), excluding the note itself.
 */
export function semanticRelated(
  path: string,
  limit: number = SEMANTIC_RELATED_LIMIT
): Promise<SemanticHit[]> {
  return invoke<SemanticHit[]>('semantic_related', { path, limit });
}

/** Discard the current index and re-embed every note from scratch. */
export function semanticReindex(): Promise<void> {
  return invoke<void>('semantic_reindex');
}

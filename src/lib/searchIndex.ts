/**
 * IPC wrappers for the persistent keyword search index backend.
 *
 * This index is separate from semantic search: it's a plain keyword index
 * kept on disk so search doesn't have to rescan the vault on every query.
 * A rebuild runs in the background — `building` stays true in the status
 * until it finishes.
 */

import { safeInvoke as invoke } from './ipc';

/** Shape of the Rust `search_index_status` command response (camelCase over IPC). */
export interface SearchIndexStatus {
  ready: boolean;
  building: boolean;
  noteCount: number;
  lastReconcileMs: number | null;
  indexPath: string;
}

/** Snapshot of the keyword search index's build state. */
export function getSearchIndexStatus(): Promise<SearchIndexStatus> {
  return invoke<SearchIndexStatus>('search_index_status');
}

/** Start a full rebuild of the keyword search index in the background. */
export function rebuildSearchIndex(): Promise<void> {
  return invoke<void>('search_index_rebuild');
}

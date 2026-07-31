/**
 * A seam for settling the debounced autosave from outside React.
 *
 * `useAutoSave` owns the pending write, but a Forge switch tears the window
 * down with `window.location.reload()`, which never runs React cleanup — so the
 * hook's own unmount flush cannot save us there. Registering the flush here
 * lets non-React code (stores, shutdown paths) await it before the page goes.
 */

type Flush = () => Promise<void>;
type PendingProbe = () => string | null;
type ResetBaseline = (noteId: string, content: string) => void;

let flush: Flush | null = null;
let pendingProbe: PendingProbe | null = null;
let resetBaseline: ResetBaseline | null = null;

/** Register the active flush. Returns an unregister function for cleanup. */
export function registerAutosaveFlush(fn: Flush): () => void {
  flush = fn;
  return () => {
    if (flush === fn) flush = null;
  };
}

/** Settle any pending autosave. Resolves immediately when nothing is owed. */
export async function flushPendingAutosave(): Promise<void> {
  try {
    await flush?.();
  } catch (error) {
    // Never block navigation on a failed write; the hook already surfaces it.
    console.error('[autosaveFlush] flush failed:', error);
  }
}

export function registerAutosavePendingProbe(fn: PendingProbe): () => void {
  pendingProbe = fn;
  return () => {
    if (pendingProbe === fn) pendingProbe = null;
  };
}

export function getPendingAutosaveNoteId(): string | null {
  return pendingProbe?.() ?? null;
}

export function registerAutosaveBaselineReset(fn: ResetBaseline): () => void {
  resetBaseline = fn;
  return () => {
    if (resetBaseline === fn) resetBaseline = null;
  };
}

export function resetAutosaveBaseline(noteId: string, content: string): void {
  resetBaseline?.(noteId, content);
}

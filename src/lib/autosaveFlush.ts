/**
 * A seam for settling the debounced autosave from outside React.
 *
 * `useAutoSave` owns the pending write, but a Forge switch tears the window
 * down with `window.location.reload()`, which never runs React cleanup — so the
 * hook's own unmount flush cannot save us there. Registering the flush here
 * lets non-React code (stores, shutdown paths) await it before the page goes.
 */

type Flush = () => Promise<void>;

let flush: Flush | null = null;

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

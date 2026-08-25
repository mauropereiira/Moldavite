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
interface PathChangeController {
  begin: (noteId: string) => void;
  commit: (oldId: string, newId: string) => Promise<void>;
  abort: (noteId: string) => Promise<void>;
}
interface AutosaveCloseWindow {
  onCloseRequested: (
    handler: (event: { preventDefault: () => void }) => void | Promise<void>
  ) => Promise<() => void>;
  destroy: () => Promise<void>;
}

let flush: Flush | null = null;
let pendingProbe: PendingProbe | null = null;
let resetBaseline: ResetBaseline | null = null;
let pathChangeController: PathChangeController | null = null;
let structuralChangeTail = Promise.resolve();

/** Serialize operations that temporarily change or remove a note's disk address. */
export async function acquireAutosavePathChange(): Promise<() => void> {
  let release!: () => void;
  const previous = structuralChangeTail;
  structuralChangeTail = new Promise<void>((resolve) => {
    release = resolve;
  });
  await previous;
  return release;
}

/** Prevent native close until structural work and every owed write have settled. */
export function registerAutosaveCloseGuard(appWindow: AutosaveCloseWindow): Promise<() => void> {
  let closing = false;
  return appWindow.onCloseRequested(async (event) => {
    event.preventDefault();
    if (closing) return;
    closing = true;
    try {
      while (true) {
        const observedTail = structuralChangeTail;
        await observedTail;
        await flushPendingAutosave();
        if (observedTail !== structuralChangeTail) continue;
        if (getPendingAutosaveNoteId() === null) {
          await appWindow.destroy();
        }
        break;
      }
    } finally {
      closing = false;
    }
  });
}

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

export function registerAutosavePathChange(controller: PathChangeController): () => void {
  pathChangeController = controller;
  return () => {
    if (pathChangeController === controller) pathChangeController = null;
  };
}

/** Hold edits under an address while a structural move is in flight. */
export function beginAutosavePathChange(noteId: string): void {
  pathChangeController?.begin(noteId);
}

/** Readdress and persist any edit made while the file was moving. */
export async function commitAutosavePathChange(oldId: string, newId: string): Promise<void> {
  await pathChangeController?.commit(oldId, newId);
}

/** Resume the old address and persist held edits after a failed move. */
export async function abortAutosavePathChange(noteId: string): Promise<void> {
  await pathChangeController?.abort(noteId);
}

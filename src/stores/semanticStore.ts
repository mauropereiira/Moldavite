import { create } from 'zustand';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import {
  getSemanticModels,
  getSemanticStatus,
  setSemanticEnabled,
  setSemanticModel,
  semanticReindex,
  type SemanticModelInfo,
  type SemanticProgress,
  type SemanticState,
} from '@/lib/semantic';

/**
 * Semantic-search lifecycle state, mirrored from the backend.
 *
 * `initialize()` (called once from App) fetches the initial status and
 * subscribes to the `semantic:*` events so downloads/index builds stream
 * live progress into the store. All mutations go through the backend —
 * this store never invents state, it reflects it.
 */
interface SemanticStoreState {
  /** User consent flag (persisted backend-side in the app config). */
  enabled: boolean;
  /** "disabled" | "downloading" | "indexing" | "ready" | "error" */
  state: SemanticState;
  modelReady: boolean;
  /** Curated model registry; exactly one entry is active. */
  models: SemanticModelInfo[];
  /** Number of notes in the vector index (meaningful when ready). */
  indexedCount: number;
  /** Live progress while downloading/indexing; null otherwise. */
  progress: SemanticProgress | null;
  error: string | null;

  /** Fetch status + subscribe to backend events. Idempotent. */
  initialize: () => Promise<void>;
  /** Re-fetch `semantic_status` and mirror it into the store. */
  refreshStatus: () => Promise<void>;
  /** Enable (consent point — triggers model download + index build) or disable. */
  setEnabled: (enabled: boolean) => Promise<void>;
  /** Select a model; an enabled feature downloads/reindexes backend-side. */
  setModel: (id: string) => Promise<void>;
  /** Re-embed every note from scratch. */
  rebuildIndex: () => Promise<void>;
}

// Subscription bookkeeping lives outside Zustand state so it isn't serialized.
let initialized = false;
const unlistenFns: UnlistenFn[] = [];

export const useSemanticStore = create<SemanticStoreState>((set, get) => ({
  enabled: false,
  state: 'disabled',
  modelReady: false,
  models: [],
  indexedCount: 0,
  progress: null,
  error: null,

  initialize: async () => {
    if (initialized) return;
    initialized = true;

    try {
      const offProgress = await listen<SemanticProgress>('semantic:progress', (event) => {
        set({ state: event.payload.phase, progress: event.payload, error: null });
      });
      const offReady = await listen<{ indexedCount: number }>('semantic:ready', (event) => {
        set({
          state: 'ready',
          modelReady: true,
          indexedCount: event.payload.indexedCount,
          progress: null,
          error: null,
        });
      });
      const offError = await listen<{ error: string }>('semantic:error', (event) => {
        set({ state: 'error', progress: null, error: event.payload.error });
      });
      unlistenFns.push(offProgress, offReady, offError);
    } catch (error) {
      console.error('[semanticStore] event subscription failed:', error);
    }

    await get().refreshStatus();
  },

  refreshStatus: async () => {
    try {
      const [status, models] = await Promise.all([getSemanticStatus(), getSemanticModels()]);
      set({
        enabled: status.enabled,
        state: status.state,
        modelReady: status.modelReady,
        models,
        indexedCount: status.indexedCount,
        error: status.error,
        // A build in flight keeps streaming progress events; anything else
        // has no meaningful progress to show.
        progress:
          status.state === 'downloading' || status.state === 'indexing' ? get().progress : null,
      });
    } catch (error) {
      console.error('[semanticStore] semantic_status failed:', error);
    }
  },

  setEnabled: async (enabled) => {
    await setSemanticEnabled(enabled);
    if (enabled) {
      // The backend spawned the build; reflect the expected first phase
      // immediately so the UI reacts before the first progress event lands.
      set({
        enabled: true,
        state: get().modelReady ? 'indexing' : 'downloading',
        progress: null,
        error: null,
      });
    } else {
      set({ enabled: false, state: 'disabled', progress: null, error: null });
    }
  },

  setModel: async (id) => {
    const current = get().models.find((model) => model.active);
    if (current?.id === id) return;
    await setSemanticModel(id);
    set({
      models: get().models.map((model) => ({ ...model, active: model.id === id })),
      modelReady: false,
      ...(get().enabled
        ? {
            state: 'downloading' as const,
            indexedCount: 0,
            progress: null,
            error: null,
          }
        : {}),
    });
  },

  rebuildIndex: async () => {
    await semanticReindex();
    set({ state: 'indexing', progress: null, error: null });
  },
}));

/** Test-only: reset module-level subscription state between tests. */
export function __resetSemanticStoreForTests(): void {
  initialized = false;
  for (const off of unlistenFns.splice(0)) off();
  useSemanticStore.setState({
    enabled: false,
    state: 'disabled',
    modelReady: false,
    models: [],
    indexedCount: 0,
    progress: null,
    error: null,
  });
}

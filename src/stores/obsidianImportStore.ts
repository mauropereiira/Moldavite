/** Transient wizard state for analyzing and importing one Obsidian vault. */

import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { create } from 'zustand';
import {
  OBSIDIAN_IMPORT_PROGRESS_EVENT,
  analyzeObsidianVault,
  forgeNameFromVaultPath,
  getForgeNameError,
  importObsidianVault,
  type ObsidianImportProgress,
  type ObsidianImportReport,
  type ObsidianVaultPreview,
} from '@/lib/obsidianImport';

export type ObsidianImportStage =
  | 'idle'
  | 'analyzing'
  | 'preview'
  | 'importing'
  | 'summary'
  | 'error';

interface ObsidianImportState {
  stage: ObsidianImportStage;
  sourcePath: string | null;
  forgeName: string;
  preview: ObsidianVaultPreview | null;
  progress: ObsidianImportProgress | null;
  report: ObsidianImportReport | null;
  error: string | null;
  initialize: () => Promise<void>;
  analyze: (path: string) => Promise<void>;
  setForgeName: (name: string) => void;
  startImport: () => Promise<ObsidianImportReport>;
  reset: () => void;
}

const initialState = {
  stage: 'idle' as ObsidianImportStage,
  sourcePath: null as string | null,
  forgeName: '',
  preview: null as ObsidianVaultPreview | null,
  progress: null as ObsidianImportProgress | null,
  report: null as ObsidianImportReport | null,
  error: null as string | null,
};

let initialized = false;
const unlistenFns: UnlistenFn[] = [];

export const useObsidianImportStore = create<ObsidianImportState>((set, get) => ({
  ...initialState,

  initialize: async () => {
    if (initialized) return;
    initialized = true;
    try {
      const unlisten = await listen<ObsidianImportProgress>(
        OBSIDIAN_IMPORT_PROGRESS_EVENT,
        (event) => {
          if (get().stage === 'importing') set({ progress: event.payload });
        }
      );
      unlistenFns.push(unlisten);
    } catch (error) {
      // Event delivery is an enhancement; the import report remains authoritative.
      console.error('[obsidianImportStore] progress subscription failed:', error);
    }
  },

  analyze: async (path) => {
    const sourcePath = path.trim();
    set({
      ...initialState,
      stage: 'analyzing',
      sourcePath,
      forgeName: forgeNameFromVaultPath(sourcePath),
    });
    await get().initialize();
    try {
      const preview = await analyzeObsidianVault(sourcePath);
      set({ stage: 'preview', preview, error: null });
    } catch (error) {
      set({ stage: 'error', error: error instanceof Error ? error.message : String(error) });
      throw error;
    }
  },

  setForgeName: (forgeName) => set({ forgeName, error: null }),

  startImport: async () => {
    const { sourcePath, forgeName } = get();
    if (!sourcePath) throw new Error('Choose an Obsidian vault first');
    const nameError = getForgeNameError(forgeName);
    if (nameError) {
      set({ error: nameError });
      throw new Error(nameError);
    }
    set({ stage: 'importing', progress: { current: 0, total: 0 }, error: null });
    try {
      const report = await importObsidianVault(sourcePath, forgeName);
      set({ stage: 'summary', report, progress: null, error: null });
      return report;
    } catch (error) {
      set({
        stage: 'preview',
        progress: null,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  },

  reset: () => set(initialState),
}));

/** Test-only reset for module-level Tauri event subscription bookkeeping. */
export function __resetObsidianImportStoreForTests(): void {
  initialized = false;
  for (const unlisten of unlistenFns.splice(0)) unlisten();
  useObsidianImportStore.setState(initialState);
}

/**
 * Multi-Forge state — the list of available Forges and the active one.
 *
 * This store holds nothing across reloads. The backend is the source of
 * truth for which Forges exist and which one is active; calling
 * `loadForges` rehydrates from the backend on startup.
 * The synchronous active-Forge cache is updated only after backend selection so
 * namespaced stores never lead the durable configuration.
 */
import { create } from 'zustand';
import { safeInvoke } from '@/lib/ipc';
import { rememberActiveForge } from '@/lib/forgeStorage';
import { flushPendingAutosave, getPendingAutosaveNoteId } from '@/lib/autosaveFlush';

export interface Forge {
  id?: string;
  isSynced?: boolean;
  name: string;
  path: string;
  isActive: boolean;
}

interface ForgeState {
  forges: Forge[];
  active: string | null;
  forgesRoot: string | null;
  loading: boolean;
  loadForges: () => Promise<void>;
  switchTo: (name: string) => Promise<void>;
  createForge: (name: string) => Promise<Forge>;
  renameForge: (oldName: string, newName: string) => Promise<Forge>;
  deleteForge: (name: string) => Promise<void>;
  setForgesRoot: (path: string) => Promise<string>;
  setSyncedForge: (enabled: boolean) => Promise<void>;
}

async function runForgeTransition<T>(transition: () => Promise<T>): Promise<T> {
  await flushPendingAutosave();
  const pendingNoteId = getPendingAutosaveNoteId();
  if (pendingNoteId) {
    throw new Error(`Forge change cancelled because ${pendingNoteId} could not be saved`);
  }

  const result = await transition();
  if (typeof window !== 'undefined') {
    window.location.reload();
  }
  return result;
}

export const useForgeStore = create<ForgeState>((set, get) => ({
  forges: [],
  active: null,
  forgesRoot: null,
  loading: false,

  loadForges: async () => {
    set({ loading: true });
    try {
      const [forges, root] = await Promise.all([
        safeInvoke<Forge[]>('list_forges'),
        safeInvoke<string>('get_forges_root_path'),
      ]);
      const selected = forges.find((f) => f.isActive);
      const active = selected?.id ?? selected?.name ?? null;
      rememberActiveForge(active);
      set({ forges, active, forgesRoot: root, loading: false });
    } catch (e) {
      // List failure is non-fatal — UI just shows an empty switcher.
      set({ loading: false });
      throw e;
    }
  },

  switchTo: async (name) => {
    if (get().active === name) return;
    // The reload below never runs React cleanup, so a debounced edit would be
    // destroyed by the switch. Settle it first.
    await runForgeTransition(() => safeInvoke<string>('set_active_forge', { name }));
  },

  createForge: async (name) => {
    const created = await safeInvoke<Forge>('create_forge', { name });
    await get().loadForges();
    return created;
  },

  renameForge: async (oldName, newName) => {
    const updated = await safeInvoke<Forge>('rename_forge', {
      oldName,
      newName,
    });
    await get().loadForges();
    return updated;
  },

  deleteForge: async (name) => {
    await safeInvoke<void>('delete_forge', { name });
    await get().loadForges();
  },

  setSyncedForge: async (enabled) => {
    await runForgeTransition(() => safeInvoke<string>('set_synced_forge_enabled', { enabled }));
  },

  setForgesRoot: async (path) => {
    return await runForgeTransition(() => safeInvoke<string>('set_forges_root', { path }));
  },
}));

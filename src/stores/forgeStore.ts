/**
 * Multi-Forge state — the list of available Forges and the active one.
 *
 * This store holds nothing across reloads. The backend is the source of
 * truth for which Forges exist and which one is active; calling
 * `loadForges` rehydrates from the backend on startup.
 */
import { create } from 'zustand';
import { safeInvoke } from '@/lib/ipc';
import { rememberActiveForge } from '@/lib/forgeStorage';

export interface Forge {
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
      const active = forges.find((f) => f.isActive)?.name ?? null;
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
    await safeInvoke<string>('set_active_forge', { name });
    // Page reload mirrors the existing `set_notes_directory` flow: it's
    // the simplest way to ensure every store/cache is rehydrated against
    // the new Forge root.
    if (typeof window !== 'undefined') {
      window.location.reload();
    }
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

  setForgesRoot: async (path) => {
    const resolved = await safeInvoke<string>('set_forges_root', { path });
    await get().loadForges();
    return resolved;
  },
}));

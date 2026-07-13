/**
 * Runtime registry for commands contributed by loaded plugin workers.
 * Command ids are namespaced by plugin, registrations are process-only, and unloading
 * a plugin must remove all its handlers so stale UI cannot invoke a terminated worker.
 */

import { create } from 'zustand';
import { useToastStore } from './toastStore';

export interface PluginCommandEntry {
  pluginId: string;
  /** Namespaced id: `${pluginId}:${localId}`. */
  id: string;
  label: string;
  handler: () => void | Promise<void>;
}

interface PluginCommandState {
  commands: PluginCommandEntry[];
  addCommand: (entry: PluginCommandEntry) => void;
  removeByPlugin: (pluginId: string) => void;
  clear: () => void;
  execute: (id: string) => Promise<void>;
}

export const usePluginCommandStore = create<PluginCommandState>((set, get) => ({
  commands: [],
  addCommand: (entry) =>
    set((s) => ({ commands: [...s.commands.filter((c) => c.id !== entry.id), entry] })),
  removeByPlugin: (pluginId) =>
    set((s) => ({ commands: s.commands.filter((c) => c.pluginId !== pluginId) })),
  clear: () => set({ commands: [] }),
  execute: async (id) => {
    const cmd = get().commands.find((c) => c.id === id);
    if (!cmd) return;
    try {
      await cmd.handler();
    } catch (err) {
      console.error(`[plugin:${cmd.pluginId}] command "${id}" failed:`, err);
      useToastStore.getState().addToast('error', `Plugin command failed: ${cmd.label}`);
    }
  },
}));

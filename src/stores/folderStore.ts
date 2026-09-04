/**
 * Standalone-note folder metadata and sidebar expansion/collapse preferences.
 * The backend owns folder existence; persisted UI state may reference missing paths
 * and must remain harmless until the next folder-list refresh.
 */

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import {
  forgeNamespacedStorageWithLegacyFallback,
  onActiveForgeChange,
  readNamespacedWithLegacyFallback,
} from '@/lib/forgeStorage';
import type { FolderInfo } from '@/types';

const FOLDER_STORAGE_KEY = 'moldavite-folders';

const defaultSectionsCollapsed = {
  notes: false,
  folders: false,
  daily: true,
  tags: false,
  backlinks: false,
};

interface FolderState {
  folders: FolderInfo[];
  expandedFolders: string[];
  sectionsCollapsed: {
    notes: boolean;
    folders: boolean;
    daily: boolean;
    tags: boolean;
    backlinks: boolean;
  };

  // Actions
  setFolders: (folders: FolderInfo[]) => void;
  toggleFolder: (path: string) => void;
  expandFolder: (path: string) => void;
  collapseFolder: (path: string) => void;
  toggleSection: (section: 'notes' | 'folders' | 'daily' | 'tags' | 'backlinks') => void;
  setExpandedFolders: (paths: string[]) => void;
}

export const useFolderStore = create<FolderState>()(
  persist(
    (set) => ({
      folders: [],
      expandedFolders: [],
      sectionsCollapsed: defaultSectionsCollapsed,

      setFolders: (folders) => set({ folders }),

      toggleFolder: (path) =>
        set((state) => {
          const isExpanded = state.expandedFolders.includes(path);
          return {
            expandedFolders: isExpanded
              ? state.expandedFolders.filter((p) => p !== path)
              : [...state.expandedFolders, path],
          };
        }),

      expandFolder: (path) =>
        set((state) => {
          if (state.expandedFolders.includes(path)) {
            return state;
          }
          return { expandedFolders: [...state.expandedFolders, path] };
        }),

      collapseFolder: (path) =>
        set((state) => ({
          expandedFolders: state.expandedFolders.filter((p) => p !== path),
        })),

      toggleSection: (section) =>
        set((state) => ({
          sectionsCollapsed: {
            ...state.sectionsCollapsed,
            [section]: !state.sectionsCollapsed[section],
          },
        })),

      setExpandedFolders: (paths) => set({ expandedFolders: paths }),
    }),
    {
      // The key is namespaced by `forgeNamespacedStorageWithLegacyFallback` on
      // every access, not baked in here: this module is imported before the
      // active Forge is known.
      name: FOLDER_STORAGE_KEY,
      storage: createJSONStorage(() => forgeNamespacedStorageWithLegacyFallback),
      version: 0, // Hook for future migrations; no shape changes yet.
      partialize: (state) => ({
        expandedFolders: state.expandedFolders,
        sectionsCollapsed: state.sectionsCollapsed,
      }),
    }
  )
);

// Hydration ran at import time, when the cache could still name the Forge we
// just switched away from. Re-read under the corrected key as soon as the
// real active Forge is known — and reset to defaults when that Forge (and its
// legacy flat key) has no slice yet, because expanded-folder state must never
// leak from one Forge to another.
onActiveForgeChange(() => {
  if (readNamespacedWithLegacyFallback(FOLDER_STORAGE_KEY) === null) {
    useFolderStore.setState({
      expandedFolders: [],
      sectionsCollapsed: defaultSectionsCollapsed,
    });
    return;
  }
  void useFolderStore.persist.rehydrate();
});

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { FolderInfo } from '@/types';

interface FolderState {
  folders: FolderInfo[];
  expandedFolders: string[];
  sectionsCollapsed: {
    notes: boolean;
    folders: boolean;
    tags: boolean;
  };

  // Actions
  setFolders: (folders: FolderInfo[]) => void;
  toggleFolder: (path: string) => void;
  expandFolder: (path: string) => void;
  collapseFolder: (path: string) => void;
  toggleSection: (section: 'notes' | 'folders' | 'tags') => void;
  setExpandedFolders: (paths: string[]) => void;
}

export const useFolderStore = create<FolderState>()(
  persist(
    (set) => ({
      folders: [],
      expandedFolders: [],
      sectionsCollapsed: {
        notes: false,
        folders: false,
        tags: false,
      },

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
      name: 'notomattic-folders',
      partialize: (state) => ({
        expandedFolders: state.expandedFolders,
        sectionsCollapsed: state.sectionsCollapsed,
      }),
    }
  )
);

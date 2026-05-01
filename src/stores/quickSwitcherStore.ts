import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

const MAX_RECENT_SEARCHES = 5;

interface QuickSwitcherState {
  isOpen: boolean;
  /** Last successful queries the user actually executed (most-recent first). */
  recentSearches: string[];
  /** Note ids the user has pinned for quick access. */
  pinnedNoteIds: string[];

  open: () => void;
  close: () => void;
  toggle: () => void;

  /** Push a query onto the recent-searches stack (dedup, capped at 5). */
  addRecentSearch: (query: string) => void;
  /** Forget every remembered search. */
  clearRecentSearches: () => void;

  /** Add or remove a note id from the pinned list. */
  togglePinned: (noteId: string) => void;
  isPinned: (noteId: string) => boolean;
}

export const useQuickSwitcherStore = create<QuickSwitcherState>()(
  persist(
    (set, get) => ({
      isOpen: false,
      recentSearches: [],
      pinnedNoteIds: [],

      open: () => set({ isOpen: true }),
      close: () => set({ isOpen: false }),
      toggle: () => set((state) => ({ isOpen: !state.isOpen })),

      addRecentSearch: (query) => {
        const trimmed = query.trim();
        if (!trimmed) return;
        set((state) => {
          const without = state.recentSearches.filter(
            (q) => q.toLowerCase() !== trimmed.toLowerCase(),
          );
          return {
            recentSearches: [trimmed, ...without].slice(0, MAX_RECENT_SEARCHES),
          };
        });
      },

      clearRecentSearches: () => set({ recentSearches: [] }),

      togglePinned: (noteId) =>
        set((state) => {
          if (state.pinnedNoteIds.includes(noteId)) {
            return {
              pinnedNoteIds: state.pinnedNoteIds.filter((id) => id !== noteId),
            };
          }
          return { pinnedNoteIds: [...state.pinnedNoteIds, noteId] };
        }),

      isPinned: (noteId) => get().pinnedNoteIds.includes(noteId),
    }),
    {
      name: 'moldavite-quick-switcher',
      storage: createJSONStorage(() => localStorage),
      // Don't persist transient UI state.
      partialize: (state) => ({
        recentSearches: state.recentSearches,
        pinnedNoteIds: state.pinnedNoteIds,
      }),
    },
  ),
);

export const QUICK_SWITCHER_RECENT_SEARCH_LIMIT = MAX_RECENT_SEARCHES;

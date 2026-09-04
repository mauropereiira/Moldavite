/**
 * Quick-switcher visibility, recent queries, and pinned note ids.
 * History and pins are persisted per Forge, bounded, and keyed by stable note address;
 * open/closed state is transient.
 */

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { forgeNamespacedStorage, onActiveForgeChange, readNamespaced } from '@/lib/forgeStorage';
import { useOverlayStore } from './overlayStore';

const MAX_RECENT_SEARCHES = 5;
const QUICK_SWITCHER_KEY = 'moldavite-quick-switcher';

interface QuickSwitcherState {
  /** Mirror of `useOverlayStore`'s `search` surface — never set it directly. */
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
  renamePinnedNote: (oldId: string, newId: string) => void;
  /**
   * Move a pin to a new position. The order is the user's, like browser tabs —
   * the one you reach for most belongs where you can hit it without looking.
   */
  movePinnedNote: (from: number, to: number) => void;
}

export const useQuickSwitcherStore = create<QuickSwitcherState>()(
  persist(
    (set, get) => ({
      isOpen: false,
      recentSearches: [],
      pinnedNoteIds: [],

      // Search is one of the exclusive navigation surfaces: opening it has to
      // dismiss whatever else was up, and re-opening it has to close it rather
      // than refocus a switcher that is already on screen.
      open: () => useOverlayStore.getState().openSurface('search'),
      close: () => useOverlayStore.getState().closeSurface('search'),
      toggle: () => useOverlayStore.getState().toggleSurface('search'),

      addRecentSearch: (query) => {
        const trimmed = query.trim();
        if (!trimmed) return;
        set((state) => {
          const without = state.recentSearches.filter(
            (q) => q.toLowerCase() !== trimmed.toLowerCase()
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
      renamePinnedNote: (oldId, newId) =>
        set((state) => ({
          pinnedNoteIds: state.pinnedNoteIds.map((id) => (id === oldId ? newId : id)),
        })),

      movePinnedNote: (from, to) =>
        set((state) => {
          const ids = state.pinnedNoteIds;
          // Out-of-range indices come from a drop that landed nowhere useful.
          // Silently keeping the current order is the right answer: the user
          // sees the pin snap back rather than jump somewhere they did not aim.
          if (from === to || from < 0 || to < 0 || from >= ids.length || to >= ids.length) {
            return state;
          }
          const next = [...ids];
          const [moved] = next.splice(from, 1);
          next.splice(to, 0, moved);
          return { pinnedNoteIds: next };
        }),
    }),
    {
      // The key is namespaced by `forgeNamespacedStorage` on every access, not
      // baked in here: this module is imported before the active Forge is known.
      name: QUICK_SWITCHER_KEY,
      storage: createJSONStorage(() => forgeNamespacedStorage),
      version: 0, // Hook for future migrations; no shape changes yet.
      // Don't persist transient UI state.
      partialize: (state) => ({
        recentSearches: state.recentSearches,
        pinnedNoteIds: state.pinnedNoteIds,
      }),
    }
  )
);

// This store owns its persisted history and pins, so it can't be a plain
// `createSurfaceStore` mirror — mirror just the visibility half instead.
useOverlayStore.subscribe(({ activeOverlay }) => {
  const isOpen = activeOverlay === 'search';
  if (useQuickSwitcherStore.getState().isOpen !== isOpen) {
    useQuickSwitcherStore.setState({ isOpen });
  }
});

// Hydration ran at import time, when the cache could still name the Forge we
// just switched away from. Re-read under the corrected key the moment the real
// active Forge is known — pins are Forge-relative note paths, so keeping the
// previous Forge's list would point them at notes that don't exist here.
onActiveForgeChange(() => {
  if (readNamespaced(QUICK_SWITCHER_KEY) === null) {
    useQuickSwitcherStore.setState({ recentSearches: [], pinnedNoteIds: [] });
    return;
  }
  void useQuickSwitcherStore.persist.rehydrate();
});

export const QUICK_SWITCHER_RECENT_SEARCH_LIMIT = MAX_RECENT_SEARCHES;

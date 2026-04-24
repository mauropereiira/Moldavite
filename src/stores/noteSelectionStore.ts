import { create } from 'zustand';

/**
 * Bulk selection state for the sidebar notes list.
 *
 * Tracks which notes (by path / id) the user has selected via shift-click
 * (range) or cmd/ctrl-click (toggle). Consumers should read `selectedIds`
 * with a narrow selector so React re-renders stay scoped to items that
 * actually change state.
 *
 * The store is deliberately lightweight: it holds no note metadata, only
 * the ids. Callers resolve ids → notes from `useNoteStore` when acting
 * on the selection (move, trash).
 */
export interface NoteSelectionState {
  selectedIds: Set<string>;
  /** Toggle a single id in/out of the selection. */
  toggle: (id: string) => void;
  /** Replace the selection with the given range (shift-click result). */
  selectRange: (ids: string[]) => void;
  /** Replace the selection wholesale with a specific list. */
  replace: (ids: string[]) => void;
  /** Drop everything. */
  clear: () => void;
}

export const useNoteSelectionStore = create<NoteSelectionState>((set) => ({
  selectedIds: new Set<string>(),
  toggle: (id) =>
    set((state) => {
      const next = new Set(state.selectedIds);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return { selectedIds: next };
    }),
  selectRange: (ids) => set({ selectedIds: new Set(ids) }),
  replace: (ids) => set({ selectedIds: new Set(ids) }),
  clear: () => {
    // Avoid re-allocating an empty Set if already empty — keeps referential
    // equality so memoized selectors don't fire needlessly.
    set((state) =>
      state.selectedIds.size === 0
        ? state
        : { selectedIds: new Set<string>() },
    );
  },
}));

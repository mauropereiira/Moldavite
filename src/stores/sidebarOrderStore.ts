/**
 * The order the user dragged the sidebar into, for standalone notes and folders.
 *
 * One flat array per kind, holding ids in the arrangement the user chose. Every
 * list in the sidebar (unfiled notes, one folder's notes, one folder's child
 * folders) ranks only its own members against each other, so where one list's
 * block of ids sits relative to another's never matters — which is what lets a
 * single array serve the whole tree. Daily notes are deliberately absent: they
 * are ordered by date and nothing else.
 *
 * Persisted per Forge, because every id here is a Forge-relative path.
 */

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { forgeNamespacedStorage, onActiveForgeChange, readNamespaced } from '@/lib/forgeStorage';

const SIDEBAR_ORDER_KEY = 'moldavite-sidebar-order';

interface SidebarOrderState {
  /** Note paths (`notes/…`) in user order. */
  noteOrder: string[];
  /** Folder paths in user order. */
  folderOrder: string[];

  /** Put `dragged` before or after `target` among `siblings` (their current display order). */
  moveNote: (dragged: string, target: string, siblings: string[], place: DropPlace) => void;
  moveFolder: (dragged: string, target: string, siblings: string[], place: DropPlace) => void;
  /** Preserve a note's manual rank when its path changes. */
  renameNote: (oldId: string, newId: string) => void;

  /** Give an empty arrangement a starting point. Ignored once one exists. */
  seedNotes: (ids: string[]) => void;
}

/** Which side of the row the pointer was on when it let go. */
export type DropPlace = 'before' | 'after';

/**
 * Rewrite `stored` so that within `siblings`, `dragged` sits immediately before
 * or after `target`.
 *
 * Both sides are needed, not just "before": with only "before", the last row in
 * a list is the one position nothing can ever be dragged into.
 *
 * The siblings are lifted out and re-appended as a block. That looks lossy and
 * isn't: ranking is only ever done between members of one list, so the block's
 * position among the other lists' ids carries no meaning. It also seeds the
 * order on the very first drag, when `stored` is still empty.
 */
export function reorderIds(
  stored: string[],
  siblings: string[],
  dragged: string,
  target: string,
  place: DropPlace = 'before'
): string[] {
  if (dragged === target) return stored;
  const group = new Set(siblings);
  const next = siblings.filter((id) => id !== dragged);
  const found = next.indexOf(target);
  const at = found === -1 ? next.length : found + (place === 'after' ? 1 : 0);
  next.splice(at, 0, dragged);
  return [...stored.filter((id) => !group.has(id)), ...next];
}

/**
 * Sort `items` into the user's arrangement. Anything they never placed — a note
 * created since, or one that has never been dragged — keeps its incoming order
 * and lands after everything they did place.
 */
export function applyManualOrder<T>(items: T[], id: (item: T) => string, order: string[]): T[] {
  if (order.length === 0) return items;
  const rank = new Map(order.map((value, index) => [value, index]));
  // MAX_SAFE_INTEGER rather than Infinity: two unplaced items would compare
  // `Infinity - Infinity`, which is NaN, and a NaN comparator scrambles the
  // list instead of leaving it alone.
  const rankOf = (item: T) => rank.get(id(item)) ?? Number.MAX_SAFE_INTEGER;
  return [...items].sort((a, b) => rankOf(a) - rankOf(b));
}

export const useSidebarOrderStore = create<SidebarOrderState>()(
  persist(
    (set) => ({
      noteOrder: [],
      folderOrder: [],

      moveNote: (dragged, target, siblings, place) =>
        set((state) => ({
          noteOrder: reorderIds(state.noteOrder, siblings, dragged, target, place),
        })),

      moveFolder: (dragged, target, siblings, place) =>
        set((state) => ({
          folderOrder: reorderIds(state.folderOrder, siblings, dragged, target, place),
        })),

      renameNote: (oldId, newId) =>
        set((state) => ({
          noteOrder: state.noteOrder.map((id) => (id === oldId ? newId : id)),
        })),

      seedNotes: (ids) => set((state) => (state.noteOrder.length > 0 ? state : { noteOrder: ids })),
    }),
    {
      // Namespaced on every access rather than baked in here: this module is
      // imported before the active Forge is known.
      name: SIDEBAR_ORDER_KEY,
      storage: createJSONStorage(() => forgeNamespacedStorage),
    }
  )
);

// Hydration ran at import time, when the cache could still name the Forge we
// just switched away from. Every id here is a path into one Forge, so re-read
// under the corrected key as soon as the real active Forge is known.
onActiveForgeChange(() => {
  if (readNamespaced(SIDEBAR_ORDER_KEY) === null) {
    useSidebarOrderStore.setState({ noteOrder: [], folderOrder: [] });
    return;
  }
  void useSidebarOrderStore.persist.rehydrate();
});

/**
 * Notes whose last save did not reach disk, by note id, with the reason. The note
 * shows a warning while it is listed (`SaveFailedBanner`); the next save of it that
 * reaches disk clears it (`noteStore.markNoteSaved`), as does deleting the note.
 */

import { create } from 'zustand';

interface SaveFailureState {
  failures: Record<string, string>;
  markSaveFailed: (noteId: string, reason: string) => void;
  clearSaveFailure: (noteId: string) => void;
  /** Follow a rename or move. */
  moveSaveFailure: (oldId: string, newId: string) => void;
}

export const useSaveFailureStore = create<SaveFailureState>((set) => ({
  failures: {},
  markSaveFailed: (noteId, reason) =>
    set((state) =>
      state.failures[noteId] === reason
        ? state
        : { failures: { ...state.failures, [noteId]: reason } }
    ),
  clearSaveFailure: (noteId) =>
    set((state) => {
      if (!(noteId in state.failures)) return state;
      const failures = { ...state.failures };
      delete failures[noteId];
      return { failures };
    }),
  moveSaveFailure: (oldId, newId) =>
    set((state) => {
      if (!(oldId in state.failures) || oldId === newId) return state;
      const failures = { ...state.failures, [newId]: state.failures[oldId] };
      delete failures[oldId];
      return { failures };
    }),
}));

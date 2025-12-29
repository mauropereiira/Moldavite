import { create } from 'zustand';
import type { TrashedNote } from '@/types';

interface TrashState {
  trashedNotes: TrashedNote[];
  isLoading: boolean;

  // Actions
  setTrashedNotes: (notes: TrashedNote[]) => void;
  setLoading: (loading: boolean) => void;
  removeFromTrash: (trashId: string) => void;
}

export const useTrashStore = create<TrashState>()((set) => ({
  trashedNotes: [],
  isLoading: false,

  setTrashedNotes: (notes) => set({ trashedNotes: notes }),

  setLoading: (loading) => set({ isLoading: loading }),

  removeFromTrash: (trashId) =>
    set((state) => ({
      trashedNotes: state.trashedNotes.filter((note) => note.id !== trashId),
    })),
}));

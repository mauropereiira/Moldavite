import { create } from 'zustand';
import type { Note, NoteFile } from '@/types';

interface NoteState {
  notes: NoteFile[];
  currentNote: Note | null;
  isLoading: boolean;
  isSaving: boolean;
  selectedDate: Date;

  // Actions
  setNotes: (notes: NoteFile[]) => void;
  setCurrentNote: (note: Note | null) => void;
  setIsLoading: (loading: boolean) => void;
  setIsSaving: (saving: boolean) => void;
  setSelectedDate: (date: Date) => void;
  updateNoteContent: (content: string) => void;
}

export const useNoteStore = create<NoteState>((set) => ({
  notes: [],
  currentNote: null,
  isLoading: false,
  isSaving: false,
  selectedDate: new Date(),

  /**
   * Replaces the entire notes list.
   * @param notes - New list of note files
   */
  setNotes: (notes) => {
    set({ notes });
  },

  /**
   * Sets the currently loaded note in the editor.
   * @param note - The note to load, or null to clear
   */
  setCurrentNote: (note) => {
    set({ currentNote: note });
  },

  /**
   * Sets the loading state for note operations.
   * @param loading - True when loading notes
   */
  setIsLoading: (loading) => set({ isLoading: loading }),

  /**
   * Sets the saving state for auto-save operations.
   * @param saving - True when saving notes
   */
  setIsSaving: (saving) => set({ isSaving: saving }),

  /**
   * Sets the selected date for daily note navigation.
   * @param date - The date to select
   */
  setSelectedDate: (date) => set({ selectedDate: date }),

  /**
   * Updates the content of the current note without saving to disk.
   * Used by the editor to track content changes before auto-save.
   * @param content - The new HTML content
   */
  updateNoteContent: (content) =>
    set((state) => {
      return {
        currentNote: state.currentNote
          ? { ...state.currentNote, content, updatedAt: new Date() }
          : null,
      };
    }),
}));

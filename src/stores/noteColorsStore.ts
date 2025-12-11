import { create } from 'zustand';
import { getAllNoteColors, setNoteColor } from '@/lib';
import type { NoteColorId } from '@/components/ui/NoteColorPicker';

interface NoteColorsState {
  colors: Record<string, string>;
  isLoading: boolean;
  loadColors: () => Promise<void>;
  getColor: (notePath: string) => NoteColorId;
  setColor: (notePath: string, colorId: NoteColorId) => Promise<void>;
}

export const useNoteColorsStore = create<NoteColorsState>((set, get) => ({
  colors: {},
  isLoading: true,

  loadColors: async () => {
    try {
      const allColors = await getAllNoteColors();
      set({ colors: allColors, isLoading: false });
    } catch (error) {
      console.error('[noteColorsStore] Failed to load colors:', error);
      set({ isLoading: false });
    }
  },

  getColor: (notePath: string): NoteColorId => {
    return (get().colors[notePath] as NoteColorId) || 'default';
  },

  setColor: async (notePath: string, colorId: NoteColorId) => {
    try {
      // Optimistic update - update state immediately for responsiveness
      if (colorId === 'default') {
        const { [notePath]: _, ...rest } = get().colors;
        set({ colors: rest });
      } else {
        set({ colors: { ...get().colors, [notePath]: colorId } });
      }

      // Persist to backend
      await setNoteColor(notePath, colorId === 'default' ? null : colorId);
    } catch (error) {
      console.error('[noteColorsStore] Failed to set color:', error);
      // Revert on error by reloading
      const freshColors = await getAllNoteColors();
      set({ colors: freshColors });
    }
  },
}));

/**
 * Helper to build the note path identifier.
 */
export function buildNotePath(filename: string, isDaily: boolean): string {
  return isDaily ? `daily/${filename}` : `notes/${filename}`;
}

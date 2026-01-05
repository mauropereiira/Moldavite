import { create } from 'zustand';

interface TagState {
  // All tags with their counts (tag -> count)
  allTags: Map<string, number>;
  // Currently selected tag for filtering (null = no filter)
  selectedTag: string | null;

  // Actions
  setAllTags: (tags: Map<string, number>) => void;
  setSelectedTag: (tag: string | null) => void;
  clearFilter: () => void;
}

/**
 * Store for managing tags across all notes.
 * Tags are extracted from note content and aggregated here.
 */
export const useTagStore = create<TagState>((set) => ({
  allTags: new Map(),
  selectedTag: null,

  /**
   * Updates the complete tag list with counts.
   * @param tags - Map of tag name to count
   */
  setAllTags: (tags) => set({ allTags: tags }),

  /**
   * Sets the currently selected tag for filtering.
   * @param tag - Tag name to filter by, or null to clear
   */
  setSelectedTag: (tag) => set({ selectedTag: tag }),

  /**
   * Clears the current tag filter.
   */
  clearFilter: () => set({ selectedTag: null }),
}));

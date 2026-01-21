import { create } from 'zustand';

interface TagState {
  // All tags with their counts (tag -> count)
  allTags: Map<string, number>;
  // Currently selected tags for filtering (empty = no filter)
  selectedTags: string[];
  // Legacy: single selected tag (for backwards compatibility)
  selectedTag: string | null;
  // Search query for filtering tag list
  tagSearchQuery: string;

  // Actions
  setAllTags: (tags: Map<string, number>) => void;
  setSelectedTag: (tag: string | null) => void;
  toggleTag: (tag: string) => void;
  addTag: (tag: string) => void;
  removeTag: (tag: string) => void;
  clearFilter: () => void;
  setTagSearchQuery: (query: string) => void;
}

/**
 * Store for managing tags across all notes.
 * Tags are extracted from note content and aggregated here.
 * Supports multi-tag filtering.
 */
export const useTagStore = create<TagState>((set, get) => ({
  allTags: new Map(),
  selectedTags: [],
  selectedTag: null,
  tagSearchQuery: '',

  /**
   * Updates the complete tag list with counts.
   * @param tags - Map of tag name to count
   */
  setAllTags: (tags) => set({ allTags: tags }),

  /**
   * Sets a single selected tag (legacy support).
   * Also updates selectedTags array.
   * @param tag - Tag name to filter by, or null to clear
   */
  setSelectedTag: (tag) => set({
    selectedTag: tag,
    selectedTags: tag ? [tag] : [],
  }),

  /**
   * Toggles a tag in the selection (for multi-select).
   * @param tag - Tag name to toggle
   */
  toggleTag: (tag) => {
    const { selectedTags } = get();
    const isSelected = selectedTags.includes(tag);
    const newTags = isSelected
      ? selectedTags.filter(t => t !== tag)
      : [...selectedTags, tag];
    set({
      selectedTags: newTags,
      selectedTag: newTags.length === 1 ? newTags[0] : newTags.length === 0 ? null : get().selectedTag,
    });
  },

  /**
   * Adds a tag to the selection.
   * @param tag - Tag name to add
   */
  addTag: (tag) => {
    const { selectedTags } = get();
    if (!selectedTags.includes(tag)) {
      const newTags = [...selectedTags, tag];
      set({
        selectedTags: newTags,
        selectedTag: newTags.length === 1 ? tag : get().selectedTag,
      });
    }
  },

  /**
   * Removes a tag from the selection.
   * @param tag - Tag name to remove
   */
  removeTag: (tag) => {
    const { selectedTags } = get();
    const newTags = selectedTags.filter(t => t !== tag);
    set({
      selectedTags: newTags,
      selectedTag: newTags.length === 1 ? newTags[0] : newTags.length === 0 ? null : get().selectedTag,
    });
  },

  /**
   * Clears all tag filters.
   */
  clearFilter: () => set({
    selectedTag: null,
    selectedTags: [],
  }),

  /**
   * Sets the search query for filtering the tag list.
   * @param query - Search string
   */
  setTagSearchQuery: (query) => set({ tagSearchQuery: query }),
}));

/**
 * Transient tag counts and sidebar filter selection.
 * Counts are rebuilt from note content, selected tags use AND semantics, and the legacy
 * single selection stays synchronized for consumers not yet using multi-select.
 */

import { create } from 'zustand';

interface TagState {
  allTags: Map<string, number>;
  // Currently selected tags for filtering (empty = no filter)
  selectedTags: string[];
  // Legacy: single selected tag (for backwards compatibility)
  selectedTag: string | null;
  tagSearchQuery: string;

  setAllTags: (tags: Map<string, number>) => void;
  setSelectedTag: (tag: string | null) => void;
  toggleTag: (tag: string) => void;
  addTag: (tag: string) => void;
  removeTag: (tag: string) => void;
  clearFilter: () => void;
  setTagSearchQuery: (query: string) => void;
}

export const useTagStore = create<TagState>((set, get) => ({
  allTags: new Map(),
  selectedTags: [],
  selectedTag: null,
  tagSearchQuery: '',

  setAllTags: (tags) => set({ allTags: tags }),

  /**
   * Sets a single selected tag (legacy support).
   * Also updates selectedTags array.
   * @param tag - Tag name to filter by, or null to clear
   */
  setSelectedTag: (tag) =>
    set({
      selectedTag: tag,
      selectedTags: tag ? [tag] : [],
    }),

  toggleTag: (tag) => {
    const { selectedTags } = get();
    const isSelected = selectedTags.includes(tag);
    const newTags = isSelected ? selectedTags.filter((t) => t !== tag) : [...selectedTags, tag];
    set({
      selectedTags: newTags,
      selectedTag:
        newTags.length === 1 ? newTags[0] : newTags.length === 0 ? null : get().selectedTag,
    });
  },

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

  removeTag: (tag) => {
    const { selectedTags } = get();
    const newTags = selectedTags.filter((t) => t !== tag);
    set({
      selectedTags: newTags,
      selectedTag:
        newTags.length === 1 ? newTags[0] : newTags.length === 0 ? null : get().selectedTag,
    });
  },

  clearFilter: () =>
    set({
      selectedTag: null,
      selectedTags: [],
    }),

  setTagSearchQuery: (query) => set({ tagSearchQuery: query }),
}));

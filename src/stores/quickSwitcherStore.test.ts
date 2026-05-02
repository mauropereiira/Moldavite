import { describe, it, expect, beforeEach } from 'vitest';
import {
  useQuickSwitcherStore,
  QUICK_SWITCHER_RECENT_SEARCH_LIMIT,
} from './quickSwitcherStore';

describe('quickSwitcherStore', () => {
  beforeEach(() => {
    // Reset to a known clean slate. localStorage is jsdom-backed in tests,
    // so we wipe the persisted slice too for hermetic runs.
    localStorage.removeItem('moldavite-quick-switcher:default');
    useQuickSwitcherStore.setState({
      isOpen: false,
      recentSearches: [],
      pinnedNoteIds: [],
    });
  });

  describe('recent searches', () => {
    it('adds queries newest-first and deduplicates case-insensitively', () => {
      const { addRecentSearch } = useQuickSwitcherStore.getState();
      addRecentSearch('alpha');
      addRecentSearch('beta');
      addRecentSearch('Alpha'); // same as 'alpha'
      expect(useQuickSwitcherStore.getState().recentSearches).toEqual([
        'Alpha',
        'beta',
      ]);
    });

    it('caps the list at the configured limit', () => {
      const { addRecentSearch } = useQuickSwitcherStore.getState();
      const limit = QUICK_SWITCHER_RECENT_SEARCH_LIMIT;
      // Push limit+2 distinct queries.
      for (let i = 0; i < limit + 2; i++) addRecentSearch(`q-${i}`);
      const recents = useQuickSwitcherStore.getState().recentSearches;
      expect(recents).toHaveLength(limit);
      // Most recent first.
      expect(recents[0]).toBe(`q-${limit + 1}`);
    });

    it('persists recent searches to localStorage', () => {
      useQuickSwitcherStore.getState().addRecentSearch('persisted');
      const raw = localStorage.getItem('moldavite-quick-switcher:default');
      expect(raw).toBeTruthy();
      const parsed = JSON.parse(raw ?? '{}');
      expect(parsed.state.recentSearches).toContain('persisted');
    });

    it('ignores empty / whitespace queries', () => {
      const { addRecentSearch } = useQuickSwitcherStore.getState();
      addRecentSearch('');
      addRecentSearch('   ');
      expect(useQuickSwitcherStore.getState().recentSearches).toEqual([]);
    });
  });

  describe('pinned notes', () => {
    it('toggles a note id on and off', () => {
      const { togglePinned, isPinned } = useQuickSwitcherStore.getState();

      togglePinned('notes/foo.md');
      expect(useQuickSwitcherStore.getState().pinnedNoteIds).toEqual([
        'notes/foo.md',
      ]);
      expect(isPinned('notes/foo.md')).toBe(true);

      togglePinned('notes/foo.md');
      expect(useQuickSwitcherStore.getState().pinnedNoteIds).toEqual([]);
      // `isPinned` is bound to a snapshot, so re-read from getState.
      expect(useQuickSwitcherStore.getState().isPinned('notes/foo.md')).toBe(
        false,
      );
    });

    it('appends new pins without disturbing existing ones', () => {
      const { togglePinned } = useQuickSwitcherStore.getState();
      togglePinned('a.md');
      togglePinned('b.md');
      togglePinned('c.md');
      expect(useQuickSwitcherStore.getState().pinnedNoteIds).toEqual([
        'a.md',
        'b.md',
        'c.md',
      ]);
    });
  });
});

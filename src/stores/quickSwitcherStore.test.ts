/** Quick-switcher bounds, deduplication, pin, and persistence tests. */

import { describe, it, expect, beforeEach } from 'vitest';
import { useQuickSwitcherStore, QUICK_SWITCHER_RECENT_SEARCH_LIMIT } from './quickSwitcherStore';
import { rememberActiveForge } from '@/lib/forgeStorage';

/** Persist rehydration settles in microtasks with synchronous storage. */
const flushMicrotasks = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('quickSwitcherStore', () => {
  beforeEach(() => {
    // Reset to a known clean slate. localStorage is jsdom-backed in tests,
    // so we wipe the persisted slices (and the Forge cache) for hermetic runs.
    localStorage.clear();
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
      expect(useQuickSwitcherStore.getState().recentSearches).toEqual(['Alpha', 'beta']);
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
      const raw = localStorage.getItem('moldavite-quick-switcher:Default');
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
      expect(useQuickSwitcherStore.getState().pinnedNoteIds).toEqual(['notes/foo.md']);
      expect(isPinned('notes/foo.md')).toBe(true);

      togglePinned('notes/foo.md');
      expect(useQuickSwitcherStore.getState().pinnedNoteIds).toEqual([]);
      // `isPinned` is bound to a snapshot, so re-read from getState.
      expect(useQuickSwitcherStore.getState().isPinned('notes/foo.md')).toBe(false);
    });

    it('appends new pins without disturbing existing ones', () => {
      const { togglePinned } = useQuickSwitcherStore.getState();
      togglePinned('a.md');
      togglePinned('b.md');
      togglePinned('c.md');
      expect(useQuickSwitcherStore.getState().pinnedNoteIds).toEqual(['a.md', 'b.md', 'c.md']);
    });
  });

  describe('per-Forge isolation', () => {
    it('writes pins under the Forge that is active at write time', () => {
      rememberActiveForge('Alpha');
      useQuickSwitcherStore.getState().togglePinned('notes/alpha.md');
      rememberActiveForge('Beta');
      useQuickSwitcherStore.getState().togglePinned('notes/beta.md');

      const alpha = JSON.parse(localStorage.getItem('moldavite-quick-switcher:Alpha') ?? '{}');
      const beta = JSON.parse(localStorage.getItem('moldavite-quick-switcher:Beta') ?? '{}');
      expect(alpha.state.pinnedNoteIds).toEqual(['notes/alpha.md']);
      expect(beta.state.pinnedNoteIds).toContain('notes/beta.md');
    });

    it("re-reads the correct Forge's pins once the active Forge is known", async () => {
      localStorage.setItem(
        'moldavite-quick-switcher:Beta',
        JSON.stringify({ state: { recentSearches: ['beta-search'], pinnedNoteIds: ['b.md'] } })
      );
      // Stand in for the stale slice hydration loaded under the previous Forge.
      useQuickSwitcherStore.setState({ recentSearches: ['alpha-search'], pinnedNoteIds: ['a.md'] });

      rememberActiveForge('Beta');
      await flushMicrotasks();

      expect(useQuickSwitcherStore.getState().pinnedNoteIds).toEqual(['b.md']);
      expect(useQuickSwitcherStore.getState().recentSearches).toEqual(['beta-search']);
    });

    it('drops the previous Forge state when the new Forge has none', async () => {
      useQuickSwitcherStore.setState({ recentSearches: ['alpha-search'], pinnedNoteIds: ['a.md'] });

      rememberActiveForge('Empty');
      await flushMicrotasks();

      expect(useQuickSwitcherStore.getState().pinnedNoteIds).toEqual([]);
      expect(useQuickSwitcherStore.getState().recentSearches).toEqual([]);
    });
  });
});

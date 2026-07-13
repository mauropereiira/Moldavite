/** Tab/current-note synchronization and pinned-tab invariant tests. */

import { describe, it, expect, beforeEach } from 'vitest';
import { useNoteStore } from './noteStore';
import type { Note } from '@/types';

const makeNote = (id: string, overrides: Partial<Note> = {}): Note => ({
  id,
  title: id,
  content: `<p>${id}</p>`,
  createdAt: new Date(0),
  updatedAt: new Date(0),
  isDaily: false,
  isWeekly: false,
  ...overrides,
});

describe('noteStore - pinned tabs', () => {
  beforeEach(() => {
    localStorage.removeItem('moldavite-pinned-tabs');
    useNoteStore.setState({
      notes: [],
      openTabs: [],
      activeTabId: null,
      currentNote: null,
      isLoading: false,
      isSaving: false,
    });
  });

  it('opens sidebar note in a new tab when active tab is pinned (does not replace pinned tab)', () => {
    const { openTab, pinTab, setCurrentNote } = useNoteStore.getState();

    // Open first note as preview tab
    const a = makeNote('a');
    openTab(a, false);
    expect(useNoteStore.getState().openTabs).toHaveLength(1);

    // Pin the active tab
    const result = pinTab('a');
    expect(result.success).toBe(true);
    expect(useNoteStore.getState().openTabs[0].isPinned).toBe(true);

    // Click another sidebar note (uses setCurrentNote -> openTab(note, false))
    const b = makeNote('b');
    setCurrentNote(b);

    const state = useNoteStore.getState();
    expect(state.openTabs).toHaveLength(2);
    expect(state.openTabs.map((t) => t.id).sort()).toEqual(['a', 'b']);
    expect(state.openTabs.find((t) => t.id === 'a')?.isPinned).toBe(true);
    expect(state.activeTabId).toBe('b');
  });

  it('replaces active tab when it is unpinned (preview-mode behavior)', () => {
    const { openTab } = useNoteStore.getState();

    openTab(makeNote('a'), false);
    openTab(makeNote('b'), false);

    const state = useNoteStore.getState();
    expect(state.openTabs).toHaveLength(1);
    expect(state.openTabs[0].id).toBe('b');
    expect(state.activeTabId).toBe('b');
  });

  it('preserves multiple pinned tabs across sidebar navigation', () => {
    const { openTab, pinTab } = useNoteStore.getState();

    openTab(makeNote('a'), true);
    pinTab('a');
    openTab(makeNote('b'), true);
    pinTab('b');

    expect(useNoteStore.getState().openTabs.filter((t) => t.isPinned)).toHaveLength(2);

    // Simulate sidebar click on a third note
    openTab(makeNote('c'), false);

    const state = useNoteStore.getState();
    expect(state.openTabs).toHaveLength(3);
    expect(state.openTabs.find((t) => t.id === 'a')?.isPinned).toBe(true);
    expect(state.openTabs.find((t) => t.id === 'b')?.isPinned).toBe(true);
    expect(state.activeTabId).toBe('c');

    // Another sidebar click should replace 'c' (unpinned active) — pinned tabs survive
    openTab(makeNote('d'), false);
    const state2 = useNoteStore.getState();
    expect(state2.openTabs).toHaveLength(3);
    expect(state2.openTabs.map((t) => t.id).sort()).toEqual(['a', 'b', 'd']);
  });

  it('switches to existing tab when re-opening an already open pinned note', () => {
    const { openTab, pinTab } = useNoteStore.getState();

    openTab(makeNote('a'), false);
    pinTab('a');
    openTab(makeNote('b'), true);
    expect(useNoteStore.getState().activeTabId).toBe('b');

    // Click pinned note in sidebar
    openTab(makeNote('a'), false);

    const state = useNoteStore.getState();
    expect(state.openTabs).toHaveLength(2);
    expect(state.activeTabId).toBe('a');
  });

  it('keeps tab identity and active/current invariants through rapid churn', () => {
    const store = useNoteStore.getState();
    for (let i = 0; i < 200; i += 1) store.openTab(makeNote(`note-${i}`), true);
    for (let i = 199; i >= 0; i -= 1) {
      if (i % 3 === 0) store.switchTab(`note-${i}`);
      if (i % 2 === 0) store.closeTab(`note-${i}`);
      const state = useNoteStore.getState();
      expect(new Set(state.openTabs.map((tab) => tab.id)).size).toBe(state.openTabs.length);
      expect(state.currentNote?.id ?? null).toBe(state.activeTabId);
      if (state.activeTabId) {
        expect(state.openTabs.some((tab) => tab.id === state.activeTabId)).toBe(true);
      }
    }
    for (const tab of [...useNoteStore.getState().openTabs]) store.closeTab(tab.id);
    expect(useNoteStore.getState()).toMatchObject({
      openTabs: [],
      activeTabId: null,
      currentNote: null,
    });
  });
});

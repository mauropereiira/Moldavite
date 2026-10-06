/** Tab/current-note synchronization and pinned-tab invariant tests. */

import { describe, it, expect, beforeEach } from 'vitest';
import { useNoteStore } from './noteStore';
import { useQuickSwitcherStore } from './quickSwitcherStore';
import { rememberActiveForge } from '@/lib/forgeStorage';
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
  const pin = (id: string) => useQuickSwitcherStore.getState().togglePinned(id);
  const ids = () => useNoteStore.getState().openTabs.map((tab) => tab.id);

  beforeEach(() => {
    localStorage.clear();
    useQuickSwitcherStore.setState({ pinnedNoteIds: [] });
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
    const { openTab, setCurrentNote } = useNoteStore.getState();

    openTab(makeNote('a'), false);
    expect(useNoteStore.getState().openTabs).toHaveLength(1);
    pin('a');

    // Click another sidebar note (uses setCurrentNote -> openTab(note, false))
    setCurrentNote(makeNote('b'));

    const state = useNoteStore.getState();
    expect(ids()).toEqual(['a', 'b']);
    expect(state.activeTabId).toBe('b');
  });

  it('reuses the unpinned preview after opening away from a pinned active tab', () => {
    const { openTab } = useNoteStore.getState();

    openTab(makeNote('pinned'), false);
    pin('pinned');
    openTab(makeNote('preview-one'), false);
    openTab(makeNote('preview-two'), false);

    expect(ids()).toEqual(['pinned', 'preview-two']);
    expect(useNoteStore.getState().activeTabId).toBe('preview-two');
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

  // Clicking a pin in the bar must not cost you the note you were reading.
  it('opens a pinned note beside the preview instead of replacing it', () => {
    const { openTab } = useNoteStore.getState();
    pin('pinned');

    openTab(makeNote('reading'), false);
    openTab(makeNote('pinned'), false);

    expect(ids()).toEqual(['pinned', 'reading']);
    expect(useNoteStore.getState().activeTabId).toBe('pinned');
  });

  it.each([null, 'closed-tab'])(
    'keeps restored loose tabs with no active tab (%s)',
    (activeTabId) => {
      const { openTab, setCurrentNote } = useNoteStore.getState();
      const loose = makeNote('loose:0123456789abcdef0123456789abcdef', {
        loose: {
          looseId: '0123456789abcdef0123456789abcdef',
          name: 'Outside.md',
          dir: '/tmp',
          readOnly: false,
        },
      });
      openTab(loose, true, false);
      expect(useNoteStore.getState().activeTabId).toBeNull();
      useNoteStore.setState({ activeTabId });
      setCurrentNote(makeNote('notes/forge.md'));
      const state = useNoteStore.getState();
      expect(state.openTabs.map((tab) => tab.id)).toEqual([loose.id, 'notes/forge.md']);
      expect(state.currentNote?.id).toBe('notes/forge.md');
      expect(state.savedContent.get(loose.id)).toBe(loose.content);
    }
  );

  it('preserves multiple pinned tabs across sidebar navigation', () => {
    const { openTab } = useNoteStore.getState();

    openTab(makeNote('a'), true);
    pin('a');
    openTab(makeNote('b'), true);
    pin('b');

    openTab(makeNote('c'), false);

    expect(ids()).toEqual(['a', 'b', 'c']);
    expect(useNoteStore.getState().activeTabId).toBe('c');

    // Another sidebar click should replace 'c' (unpinned active) — pinned tabs survive
    openTab(makeNote('d'), false);
    expect(ids()).toEqual(['a', 'b', 'd']);
  });

  it('switches to existing tab when re-opening an already open pinned note', () => {
    const { openTab } = useNoteStore.getState();

    openTab(makeNote('a'), false);
    pin('a');
    openTab(makeNote('b'), true);
    expect(useNoteStore.getState().activeTabId).toBe('b');

    openTab(makeNote('a'), false);

    const state = useNoteStore.getState();
    expect(state.openTabs).toHaveLength(2);
    expect(state.activeTabId).toBe('a');
  });

  it('moves a tab into the pinned group when pinned anywhere, and back out when unpinned', () => {
    const { openTab } = useNoteStore.getState();
    openTab(makeNote('a'), true);
    openTab(makeNote('b'), true);
    openTab(makeNote('c'), true);
    const current = useNoteStore.getState().currentNote;

    pin('c');
    expect(ids()).toEqual(['c', 'a', 'b']);
    pin('b');
    expect(ids()).toEqual(['c', 'b', 'a']);
    // Reordering pins reorders their tabs.
    useQuickSwitcherStore.getState().movePinnedNote(0, 1);
    expect(ids()).toEqual(['b', 'c', 'a']);

    // Unpinning keeps the tab open, as the first ordinary tab.
    pin('c');
    expect(ids()).toEqual(['b', 'c', 'a']);
    pin('b');
    expect(ids()).toEqual(['b', 'c', 'a']);
    // Moving tabs never replaces the tab objects the editor is holding.
    expect(useNoteStore.getState().currentNote).toBe(current);
  });

  it('keeps pinned tabs ahead of the rest when reordering', () => {
    const { openTab, reorderTabs } = useNoteStore.getState();
    openTab(makeNote('a'), true);
    openTab(makeNote('b'), true);
    openTab(makeNote('c'), true);
    pin('a');

    reorderTabs(2, 0);
    expect(ids()).toEqual(['a', 'c', 'b']);
    reorderTabs(1, 2);
    expect(ids()).toEqual(['a', 'b', 'c']);
  });

  it('keeps tab identity and active/current invariants through rapid churn', () => {
    const store = useNoteStore.getState();
    for (let i = 0; i < 200; i += 1) store.openTab(makeNote(`note-${i}`), true);
    for (let i = 199; i >= 0; i -= 1) {
      if (i % 3 === 0) store.switchTab(`note-${i}`);
      if (i % 5 === 0) pin(`note-${i}`);
      if (i % 2 === 0) store.closeTab(`note-${i}`);
      const state = useNoteStore.getState();
      expect(new Set(state.openTabs.map((tab) => tab.id)).size).toBe(state.openTabs.length);
      expect(state.currentNote?.id ?? null).toBe(state.activeTabId);
      if (state.activeTabId) {
        expect(state.openTabs.some((tab) => tab.id === state.activeTabId)).toBe(true);
        expect(state.currentNote).toBe(state.openTabs.find((tab) => tab.id === state.activeTabId));
      }
      const pins = useQuickSwitcherStore.getState().pinnedNoteIds;
      const firstUnpinned = state.openTabs.findIndex((tab) => !pins.includes(tab.id));
      expect(
        state.openTabs.slice(Math.max(firstUnpinned, 0)).every((tab) => !pins.includes(tab.id)) ||
          firstUnpinned < 0
      ).toBe(true);
    }
    for (const tab of [...useNoteStore.getState().openTabs]) store.closeTab(tab.id);
    expect(useNoteStore.getState()).toMatchObject({
      openTabs: [],
      activeTabId: null,
      currentNote: null,
    });
  });
});

describe('noteStore - the old tab pins', () => {
  beforeEach(() => {
    localStorage.clear();
    useQuickSwitcherStore.setState({ pinnedNoteIds: [] });
    useNoteStore.setState({ openTabs: [], activeTabId: null, currentNote: null });
  });

  // `moldavite-pinned-tabs` held "keep this tab" pins that were never restored
  // at launch. They are not merged into the top-bar pins; nothing reads or
  // writes the key any more.
  it('neither reads nor writes the old per-Forge tab pin key', () => {
    rememberActiveForge('Alpha');
    localStorage.setItem('moldavite-pinned-tabs:Alpha', JSON.stringify(['notes/shared.md']));
    const { openTab, closeTab } = useNoteStore.getState();

    openTab(makeNote('notes/shared.md'), true);
    openTab(makeNote('notes/other.md'), true);
    useQuickSwitcherStore.getState().togglePinned('notes/other.md');
    closeTab('notes/other.md');

    expect(useQuickSwitcherStore.getState().pinnedNoteIds).toEqual(['notes/other.md']);
    expect(localStorage.getItem('moldavite-pinned-tabs:Alpha')).toBe('["notes/shared.md"]');
    expect(useNoteStore.getState().openTabs.map((tab) => tab.id)).toEqual(['notes/shared.md']);
  });
});

describe('noteStore - markNoteSaved', () => {
  beforeEach(() => {
    useNoteStore.setState({
      notes: [
        {
          name: 'a.md',
          path: 'a',
          isDaily: false,
          isWeekly: false,
          isLocked: false,
          modifiedAt: 1,
        },
        {
          name: 'b.md',
          path: 'b',
          isDaily: false,
          isWeekly: false,
          isLocked: false,
          modifiedAt: 1,
        },
      ],
      openTabs: [],
      activeTabId: null,
      currentNote: null,
      savedContent: new Map(),
    });
  });

  it("moves the saved note's list time to now, for the Modified sort", () => {
    const before = Math.floor(Date.now() / 1000);
    useNoteStore.getState().openTab(makeNote('a'), false);
    useNoteStore.getState().markNoteSaved('a', '<p>edited</p>');

    const [a, b] = useNoteStore.getState().notes;
    expect(a.modifiedAt).toBeGreaterThanOrEqual(before);
    expect(b.modifiedAt).toBe(1);
    expect(useNoteStore.getState().savedContent.get('a')).toBe('<p>edited</p>');
  });
});

describe('noteStore - selected date and week', () => {
  it('clears the selected week when a date is selected', () => {
    useNoteStore.getState().setSelectedWeek(new Date(2026, 8, 28));
    useNoteStore.getState().setSelectedDate(new Date(2026, 8, 30));

    expect(useNoteStore.getState().selectedWeek).toBeNull();
  });
});

describe('noteStore - reopening an open tab', () => {
  beforeEach(() => {
    useNoteStore.setState({ openTabs: [], activeTabId: null, currentNote: null });
  });

  // A blank editable stand-in would be saved over the real note once iCloud delivers it.
  it('keeps an iCloud placeholder marked as one when its tab is already open', () => {
    const { openTab } = useNoteStore.getState();
    openTab(makeNote('notes/Remote.md'), false);

    openTab({ ...makeNote('notes/Remote.md'), content: '', cloudPending: true }, false);

    expect(useNoteStore.getState().currentNote?.cloudPending).toBe(true);
    expect(useNoteStore.getState().openTabs[0].cloudPending).toBe(true);
  });

  it('clears the placeholder mark when the real note reopens the tab', () => {
    const { openTab } = useNoteStore.getState();
    openTab({ ...makeNote('notes/Remote.md'), content: '', cloudPending: true }, false);

    openTab(makeNote('notes/Remote.md'), false);

    expect(useNoteStore.getState().currentNote?.cloudPending).toBeFalsy();
  });
});

import { fireEvent, render } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  useGraphStore,
  useNoteSelectionStore,
  useNoteStore,
  useOverlayStore,
  useQuickSwitcherStore,
  useSettingsStore,
  useTimelineStore,
} from '@/stores';
import type { Note } from '@/types';
import { ChromeShortcutHost } from './ChromeShortcutHost';

describe('ChromeShortcutHost modes', () => {
  beforeEach(() => {
    useSettingsStore.getState().resetToDefaults();
    useOverlayStore.setState({
      activeOverlay: null,
      isSidebarHidden: false,
      isRightPanelHidden: false,
    });
  });

  it('does nothing for Index and Agenda shortcuts when their modes are off', () => {
    useSettingsStore.setState({ indexMode: 'off', agendaMode: 'off' });
    render(<ChromeShortcutHost />);

    fireEvent.keyDown(window, { key: '\\', code: 'Backslash', metaKey: true });
    fireEvent.keyDown(window, {
      key: '«',
      code: 'Backslash',
      metaKey: true,
      altKey: true,
    });

    expect(useOverlayStore.getState()).toMatchObject({
      activeOverlay: null,
      isSidebarHidden: false,
      isRightPanelHidden: false,
    });
  });

  const agendaShortcut = () =>
    fireEvent.keyDown(window, {
      key: '«',
      code: 'Backslash',
      metaKey: true,
      altKey: true,
    });

  it('uses the selected overlay and pinned forms', () => {
    useSettingsStore.setState({ indexMode: 'overlay', agendaMode: 'pinned' });
    render(<ChromeShortcutHost />);

    fireEvent.keyDown(window, { key: '\\', code: 'Backslash', metaKey: true });
    expect(useOverlayStore.getState().activeOverlay).toBe('index');

    // The Index overlay covers the pinned Agenda column, so the first Agenda
    // press means "show me the Agenda": dismiss the overlay, keep the column.
    agendaShortcut();
    expect(useOverlayStore.getState()).toMatchObject({
      activeOverlay: null,
      isRightPanelHidden: false,
    });

    // With nothing covering it, the pinned form toggles the column itself.
    agendaShortcut();
    expect(useOverlayStore.getState()).toMatchObject({
      activeOverlay: null,
      isRightPanelHidden: true,
    });
  });
});

describe('ChromeShortcutHost surfaces', () => {
  beforeEach(() => {
    useSettingsStore.getState().resetToDefaults();
    useOverlayStore.setState({
      activeOverlay: null,
      isSidebarHidden: false,
      isRightPanelHidden: false,
    });
    useNoteStore.setState({ openTabs: [], activeTabId: null, currentNote: null });
    useNoteSelectionStore.getState().clear();
  });

  const escape = () => fireEvent.keyDown(window, { key: 'Escape', code: 'Escape' });

  const note: Note = {
    id: 'note-1',
    title: 'Note',
    content: '',
    createdAt: new Date(0),
    updatedAt: new Date(0),
    isDaily: false,
    isWeekly: false,
  };

  const openNote = () =>
    useNoteStore.setState({ openTabs: [note], activeTabId: note.id, currentNote: note });

  /** Escape with nothing focused, which is what the browser targets at body. */
  const escapeFromNote = (init: { shiftKey?: boolean } = {}) =>
    fireEvent.keyDown(document.body, { key: 'Escape', code: 'Escape', ...init });

  const surfaces = [
    { name: 'index', open: () => useOverlayStore.getState().openIndex(false) },
    { name: 'agenda', open: () => useOverlayStore.getState().openAgenda(false) },
    { name: 'graph', open: () => useGraphStore.getState().open() },
    { name: 'timeline', open: () => useTimelineStore.getState().open() },
    { name: 'search', open: () => useQuickSwitcherStore.getState().open() },
  ];

  it.each(surfaces)('closes the active $name surface on Escape', ({ open }) => {
    render(<ChromeShortcutHost />);

    open();
    escape();

    expect(useOverlayStore.getState().activeOverlay).toBeNull();
    expect(useGraphStore.getState().isOpen).toBe(false);
    expect(useTimelineStore.getState().isOpen).toBe(false);
    expect(useQuickSwitcherStore.getState().isOpen).toBe(false);
  });

  it('closes the open note on Escape, not the note under an active surface', () => {
    render(<ChromeShortcutHost />);
    openNote();

    // An overlay owns Escape first: the note survives.
    useOverlayStore.getState().openIndex(false);
    escapeFromNote();
    expect(useNoteStore.getState().activeTabId).toBe('note-1');

    escapeFromNote();
    expect(useNoteStore.getState().activeTabId).toBeNull();
    expect(useNoteStore.getState().currentNote).toBeNull();
  });

  it('leaves the note alone while anything else wants Escape', () => {
    render(<ChromeShortcutHost />);

    const cases: Array<[string, () => () => void]> = [
      [
        'a dialog is on screen',
        () => {
          const dialog = document.createElement('div');
          dialog.setAttribute('role', 'dialog');
          document.body.appendChild(dialog);
          return () => dialog.remove();
        },
      ],
      [
        'a bulk selection is waiting to be cleared',
        () => {
          useNoteSelectionStore.getState().replace(['note-1']);
          return () => useNoteSelectionStore.getState().clear();
        },
      ],
    ];

    for (const [, setup] of cases) {
      openNote();
      const teardown = setup();
      escapeFromNote();
      expect(useNoteStore.getState().activeTabId).toBe('note-1');
      teardown();
    }

    // Handled by something closer to the event — ProseMirror marks its own
    // suggestion menus this way.
    openNote();
    const claimEscape = (event: KeyboardEvent) => event.preventDefault();
    document.body.addEventListener('keydown', claimEscape);
    escapeFromNote();
    document.body.removeEventListener('keydown', claimEscape);
    expect(useNoteStore.getState().activeTabId).toBe('note-1');

    // A modifier means it is some other shortcut, not "leave the note".
    escapeFromNote({ shiftKey: true });
    expect(useNoteStore.getState().activeTabId).toBe('note-1');
  });

  it('toggles Search and Graph from the keyboard like their rail buttons', () => {
    render(<ChromeShortcutHost />);

    fireEvent.keyDown(window, { key: 'p', code: 'KeyP', metaKey: true });
    expect(useQuickSwitcherStore.getState().isOpen).toBe(true);

    fireEvent.keyDown(window, { key: 'G', code: 'KeyG', metaKey: true, shiftKey: true });
    expect(useGraphStore.getState().isOpen).toBe(true);
    expect(useQuickSwitcherStore.getState().isOpen).toBe(false);

    fireEvent.keyDown(window, { key: 'G', code: 'KeyG', metaKey: true, shiftKey: true });
    expect(useGraphStore.getState().isOpen).toBe(false);

    fireEvent.keyDown(window, { key: 'p', code: 'KeyP', metaKey: true });
    fireEvent.keyDown(window, { key: 'p', code: 'KeyP', metaKey: true });
    expect(useQuickSwitcherStore.getState().isOpen).toBe(false);
  });
});

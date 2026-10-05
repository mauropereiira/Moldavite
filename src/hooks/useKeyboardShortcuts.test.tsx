import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useNoteStore } from '@/stores/noteStore';
import { useSettingsStore } from '@/stores';

const invokeMock = vi.fn();

vi.mock('@/lib/ipc', () => ({
  safeInvoke: (...args: unknown[]) => invokeMock(...args),
}));

import { useKeyboardShortcuts } from './useKeyboardShortcuts';

beforeEach(() => {
  vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15'
  );
  invokeMock.mockReset();
  invokeMock.mockImplementation(async (command: string) => {
    if (command === 'read_note') {
      return { content: '', color: null, contentHash: 'h' };
    }
    return undefined;
  });
  useNoteStore.setState({ notes: [], currentNote: null, openTabs: [], activeTabId: null });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('useKeyboardShortcuts template creation', () => {
  it('addresses a template note created with no note open by its notes/ path', async () => {
    const hook = renderHook(() => useKeyboardShortcuts({ editor: null }));

    await act(() => hook.result.current.handleTemplateSelect('template-1'));

    const all = useNoteStore.getState().notes;
    const created = all[all.length - 1];
    expect(created).toBeDefined();
    // Standalone notes are addressed by their notes/-relative path everywhere
    // else (useNotes.createNote, listNotes, the Forge watcher). A bare filename
    // leaves the open tab unmatchable by external-change reconciliation.
    expect(created?.path).toBe(`notes/${created?.name}`);
    expect(useNoteStore.getState().currentNote?.id).toBe(`notes/${created?.name}`);
  });
});

describe('useKeyboardShortcuts on a view-only note', () => {
  const lockedNote = {
    id: 'notes/Diary.md',
    title: 'Diary',
    content: '<p>secret</p>',
    isDaily: false,
    isWeekly: false,
  };

  function viewOnlyEditor() {
    return {
      isEditable: false,
      commands: { setContent: vi.fn() },
    } as unknown as Parameters<typeof useKeyboardShortcuts>[0]['editor'];
  }

  function press(key: string) {
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key, metaKey: true, bubbles: true }));
    });
  }

  beforeEach(() => {
    useNoteStore.setState({
      currentNote: lockedNote as never,
      unlockedNotes: new Set([lockedNote.id]),
    });
  });

  it('opens no template picker and applies no template', async () => {
    const editor = viewOnlyEditor();
    const hook = renderHook(() => useKeyboardShortcuts({ editor }));

    press('t');
    expect(hook.result.current.showTemplatePicker).toBe(false);

    await act(() => hook.result.current.handleTemplateSelect('template-1'));
    expect(editor?.commands.setContent).not.toHaveBeenCalled();
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it('does not open the link dialog', () => {
    const onInsertLink = vi.fn();
    renderHook(() => useKeyboardShortcuts({ editor: viewOnlyEditor(), onInsertLink }));

    press('k');
    expect(onInsertLink).not.toHaveBeenCalled();
  });
});

describe('useKeyboardShortcuts on a Mac', () => {
  const press = (init: { key: string; metaKey?: boolean; ctrlKey?: boolean }) =>
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, ...init }));
    });

  it('answers ⌘N and ignores Ctrl+N', () => {
    const onNewNote = vi.fn();
    renderHook(() => useKeyboardShortcuts({ editor: null, onNewNote }));

    press({ key: 'n', ctrlKey: true });
    expect(onNewNote).not.toHaveBeenCalled();

    press({ key: 'n', metaKey: true });
    expect(onNewNote).toHaveBeenCalledTimes(1);
  });
});

describe('useKeyboardShortcuts with ⌥ held', () => {
  const tab = { id: 'notes/a.md', title: 'A', content: '', isDaily: false, isWeekly: false };
  const other = { ...tab, id: 'notes/b.md', title: 'B' };

  function setup() {
    useNoteStore.setState({
      openTabs: [tab, other] as never,
      activeTabId: tab.id,
      currentNote: tab as never,
    });
    useSettingsStore.setState({ isSettingsOpen: false });
    const handlers = { onNewNote: vi.fn(), onToggleTheme: vi.fn(), onInsertLink: vi.fn() };
    const hook = renderHook(() => useKeyboardShortcuts({ editor: {} as never, ...handlers }));
    return { handlers, hook };
  }

  type Chord = {
    key: string;
    metaKey?: boolean;
    ctrlKey?: boolean;
    altKey?: boolean;
    shiftKey?: boolean;
  };

  const press = (init: Chord) =>
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, ...init }));
    });

  const chords: Chord[] = [
    { key: 'n' },
    { key: 'w' },
    { key: 't' },
    { key: 'k' },
    { key: ',' },
    { key: 'l', shiftKey: true },
  ];

  it.each([
    ['⌘⌥', { metaKey: true, altKey: true }],
    ['⌘⌥⇧', { metaKey: true, altKey: true, shiftKey: true }],
  ])('does not fire a base shortcut for %s chords', (_label, modifiers) => {
    const { handlers, hook } = setup();

    for (const chord of chords) press({ ...chord, ...modifiers });

    expect(handlers.onNewNote).not.toHaveBeenCalled();
    expect(handlers.onToggleTheme).not.toHaveBeenCalled();
    expect(handlers.onInsertLink).not.toHaveBeenCalled();
    expect(hook.result.current.showTemplatePicker).toBe(false);
    expect(useSettingsStore.getState().isSettingsOpen).toBe(false);
    expect(useNoteStore.getState().openTabs).toHaveLength(2);
  });

  it('still fires the base shortcuts and the ⌘⌥ arrow tab switch', () => {
    const { handlers, hook } = setup();

    press({ key: 'ArrowRight', metaKey: true, altKey: true });
    expect(useNoteStore.getState().activeTabId).toBe(other.id);
    press({ key: 'ArrowLeft', metaKey: true, altKey: true });
    expect(useNoteStore.getState().activeTabId).toBe(tab.id);

    for (const chord of chords) press({ ...chord, metaKey: true });

    expect(handlers.onNewNote).toHaveBeenCalledTimes(1);
    expect(handlers.onToggleTheme).toHaveBeenCalledTimes(1);
    expect(handlers.onInsertLink).toHaveBeenCalledTimes(1);
    expect(hook.result.current.showTemplatePicker).toBe(true);
    expect(useSettingsStore.getState().isSettingsOpen).toBe(true);
    expect(useNoteStore.getState().openTabs).toHaveLength(1);
  });

  it('does not treat Windows AltGr, reported as Ctrl+Alt, as the primary modifier alone', () => {
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
    );
    const { handlers } = setup();

    press({ key: 'n', ctrlKey: true, altKey: true });
    expect(handlers.onNewNote).not.toHaveBeenCalled();

    press({ key: 'n', ctrlKey: true });
    expect(handlers.onNewNote).toHaveBeenCalledTimes(1);
  });
});

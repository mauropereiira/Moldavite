import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { DependencyList } from 'react';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Editor as TiptapEditor } from '@tiptap/core';
import type { Note } from '@/types';

const tiptapHarness = vi.hoisted(() => ({
  editor: null as TiptapEditor | null,
  setContentCalls: [] as unknown[][],
  setTextSelectionCalls: [] as unknown[][],
  blurCallCount: 0,
  afterSetContent: null as (() => void) | null,
}));

const safeInvoke = vi.hoisted(() => vi.fn());
const convertFileSrc = vi.hoisted(() => vi.fn((path: string) => `asset://${path}`));

vi.mock('@tiptap/react', async () => {
  const actual = await vi.importActual<typeof import('@tiptap/react')>('@tiptap/react');

  return {
    ...actual,
    useEditor: (options: Parameters<typeof actual.useEditor>[0], deps?: DependencyList) => {
      const editor = actual.useEditor(options, deps);
      if (editor && editor !== tiptapHarness.editor) {
        const commandManager = editor as unknown as {
          commandManager: {
            rawCommands: Record<string, (...args: unknown[]) => (props: unknown) => boolean>;
          };
        };
        const rawCommands = commandManager.commandManager.rawCommands;
        const originalSetContent = rawCommands.setContent;
        const originalSetTextSelection = rawCommands.setTextSelection;
        const originalBlur = rawCommands.blur;

        rawCommands.setContent = (...args: unknown[]) => {
          tiptapHarness.setContentCalls.push(args);
          const command = originalSetContent(...args);
          return (props: unknown) => {
            const result = command(props);
            tiptapHarness.afterSetContent?.();
            return result;
          };
        };
        rawCommands.setTextSelection = (...args: unknown[]) => {
          tiptapHarness.setTextSelectionCalls.push(args);
          return originalSetTextSelection(...args);
        };
        rawCommands.blur = (...args: unknown[]) => {
          tiptapHarness.blurCallCount += 1;
          return originalBlur(...args);
        };
      }
      tiptapHarness.editor = editor;
      return editor;
    },
  };
});

vi.mock('@/lib/ipc', () => ({
  safeInvoke: (...args: unknown[]) => safeInvoke(...args),
}));

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn().mockResolvedValue(undefined),
  convertFileSrc: (path: string) => convertFileSrc(path),
}));

// Stable across renders so a test can assert what the shortcut handlers do,
// not merely that they exist.
const shortcutSpies = vi.hoisted(() => ({
  createNote: vi.fn(),
  options: { current: null as null | Record<string, unknown> },
}));

vi.mock('@/hooks', () => ({
  useAutoSave: vi.fn(),
  useKeyboardShortcuts: (options: Record<string, unknown>) => {
    shortcutSpies.options.current = options;
    return {
      showTemplatePicker: false,
      handleTemplateSelect: vi.fn(),
      handleTemplatePickerClose: vi.fn(),
      openTemplatePicker: vi.fn(),
    };
  },
  useNotes: () => ({
    deleteCurrentNote: vi.fn(),
    loadDailyNote: vi.fn(),
    createNote: shortcutSpies.createNote,
    loadNote: vi.fn(),
    renameNote: vi.fn(),
  }),
  useTemplates: () => ({ getTemplateContent: vi.fn() }),
}));

vi.mock('@/hooks/useToast', () => ({
  useToast: () => ({
    success: vi.fn(),
    error: vi.fn(),
  }),
}));

vi.mock('./EditorFooter', () => ({ EditorFooter: () => <footer data-testid="editor-footer" /> }));
vi.mock('./TabBar', () => ({ TabBar: () => <div data-testid="tab-bar" /> }));
vi.mock('./NoteHeader', () => ({ NoteHeader: () => <header data-testid="note-header" /> }));
vi.mock('./SelectionToolbar', () => ({ SelectionToolbar: () => null }));
vi.mock('./ImageToolbar', () => ({ ImageToolbar: () => null }));
vi.mock('./LinkModal', () => ({ LinkModal: () => null }));
vi.mock('./ImageModal', () => ({ ImageModal: () => null }));
// ExternalChangeBanner is deliberately NOT mocked: it renders null unless the
// note is in `externallyChanged`, so it is already inert for every test that
// does not seed one — and the write-consent tests below assert its real output.
vi.mock('@/components/backlinks', () => ({
  BacklinksPanel: () => <aside data-testid="backlinks-panel" />,
}));
vi.mock('@/components/templates/EmptyNoteTemplatePicker', () => ({
  EmptyNoteTemplatePicker: () => null,
}));
vi.mock('@/components/templates/TemplatePickerModal', () => ({
  TemplatePickerModal: () => null,
}));

import { Editor } from './Editor';
import {
  useNoteColorsStore,
  useNoteStore,
  useSettingsStore,
  useTagStore,
  useThemeStore,
  useToastStore,
} from '@/stores';
import { usePluginCommandStore } from '@/stores/pluginCommandStore';
import { registerAutosaveFlush } from '@/lib/autosaveFlush';
import { notifyConflictCopy, readNoteWithMeta, writeNote } from '@/lib';

const rangeGetClientRects = Object.getOwnPropertyDescriptor(
  window.Range.prototype,
  'getClientRects'
);
const rangeGetBoundingClientRect = Object.getOwnPropertyDescriptor(
  window.Range.prototype,
  'getBoundingClientRect'
);

beforeAll(() => {
  Object.defineProperties(window.Range.prototype, {
    getClientRects: {
      configurable: true,
      value: () => [],
    },
    getBoundingClientRect: {
      configurable: true,
      value: () => new DOMRect(),
    },
  });
});

afterAll(() => {
  if (rangeGetClientRects) {
    Object.defineProperty(window.Range.prototype, 'getClientRects', rangeGetClientRects);
  } else {
    Reflect.deleteProperty(window.Range.prototype, 'getClientRects');
  }
  if (rangeGetBoundingClientRect) {
    Object.defineProperty(
      window.Range.prototype,
      'getBoundingClientRect',
      rangeGetBoundingClientRect
    );
  } else {
    Reflect.deleteProperty(window.Range.prototype, 'getBoundingClientRect');
  }
});

function note(id: string, content: string, externalRev?: number): Note {
  return {
    id,
    title: id.replace('.md', ''),
    content,
    createdAt: new Date('2026-08-14T09:00:00Z'),
    updatedAt: new Date('2026-08-14T09:00:00Z'),
    isDaily: false,
    isWeekly: false,
    externalRev,
  };
}

function setOpenNotes(currentNote: Note, otherNotes: Note[] = []) {
  useNoteStore.setState({
    openTabs: [currentNote, ...otherNotes],
    activeTabId: currentNote.id,
    currentNote,
  });
}

async function renderEditor(currentNote: Note, otherNotes: Note[] = []) {
  setOpenNotes(currentNote, otherNotes);
  render(<Editor />);

  await waitFor(() => expect(tiptapHarness.editor).not.toBeNull());
  const editor = tiptapHarness.editor as TiptapEditor;
  const editable = document.querySelector('[contenteditable="true"]');
  const scrollContainer = editable?.closest('.editor-paper');
  if (!(scrollContainer instanceof HTMLElement)) {
    throw new Error('Editor scroll container was not rendered');
  }

  return { editor, scrollContainer };
}

beforeEach(() => {
  tiptapHarness.editor = null;
  tiptapHarness.setContentCalls = [];
  tiptapHarness.setTextSelectionCalls = [];
  tiptapHarness.blurCallCount = 0;
  tiptapHarness.afterSetContent = null;
  safeInvoke.mockReset();
  convertFileSrc.mockClear();
  useNoteStore.setState({
    notes: [],
    openTabs: [],
    activeTabId: null,
    currentNote: null,
    isLoading: false,
    isSaving: false,
    unlockedNotes: new Set(),
    externallyChanged: new Map(),
  });
  useSettingsStore.getState().resetToDefaults();
  useThemeStore.setState({ theme: 'light', baseMode: 'light' });
  useNoteColorsStore.setState({ colors: {}, isLoading: false });
  useTagStore.setState({ allTags: new Map(), selectedTags: [], selectedTag: null });
  usePluginCommandStore.getState().clear();
  useToastStore.setState({ toasts: [] });
});

describe('Editor layout settings', () => {
  it('removes each optional editor chrome surface when disabled', async () => {
    const currentNote = note('notes/first.md', '<p>First note body</p>');
    const secondNote = note('notes/second.md', '<p>Second note body</p>');
    await renderEditor(currentNote, [secondNote]);

    expect(screen.getByTestId('tab-bar')).toBeInTheDocument();
    expect(screen.getByTestId('note-header')).toBeInTheDocument();
    expect(screen.getByTestId('backlinks-panel')).toBeInTheDocument();
    expect(screen.getByTestId('editor-footer')).toBeInTheDocument();

    act(() => {
      useSettingsStore.setState({
        showTabBar: false,
        showNoteHeader: false,
        showBacklinksPanel: false,
        showEditorFooter: false,
      });
    });

    expect(screen.queryByTestId('tab-bar')).not.toBeInTheDocument();
    expect(screen.queryByTestId('note-header')).not.toBeInTheDocument();
    expect(screen.queryByTestId('backlinks-panel')).not.toBeInTheDocument();
    expect(screen.queryByTestId('editor-footer')).not.toBeInTheDocument();
  });

  // ⌘N was wired to `() => { /* Will be handled by parent */ }`. No parent ever
  // did, and the hook calls it as `onNewNote?.()`, so the keypress was consumed
  // and silently discarded — while the welcome screen advertised ⌘N under the
  // wordmark. Asserting the handler exists would have passed against the bug;
  // this asserts it actually creates a note.
  it('wires ⌘N to note creation rather than an empty stub', async () => {
    shortcutSpies.createNote.mockClear();
    await renderEditor(note('notes/first.md', '<p>First note body</p>'));

    const onNewNote = shortcutSpies.options.current?.onNewNote as (() => void) | undefined;
    expect(onNewNote).toBeTypeOf('function');

    onNewNote?.();
    expect(shortcutSpies.createNote).toHaveBeenCalled();
  });

  it('shows the tab bar only when more than one tab needs managing', async () => {
    const currentNote = note('notes/first.md', '<p>First note body</p>');
    await renderEditor(currentNote);

    expect(screen.queryByTestId('tab-bar')).not.toBeInTheDocument();

    act(() => {
      useNoteStore.getState().openTab(note('notes/second.md', '<p>Second note body</p>'), true);
    });

    expect(screen.getByTestId('tab-bar')).toBeInTheDocument();
  });
});

describe('Editor content synchronization', () => {
  it('loads note content without emitting an editor update', async () => {
    const currentNote = note('notes/first.md', '<p>First note body</p>');
    setOpenNotes(currentNote);

    render(<Editor />);

    await waitFor(() => {
      expect(tiptapHarness.setContentCalls).toContainEqual([
        '<p>First note body</p>',
        { emitUpdate: false },
      ]);
      expect(tiptapHarness.editor?.getHTML()).toBe('<p>First note body</p>');
    });
  });

  it('keeps your place when the editor is rebuilt under the same note', async () => {
    const currentNote = note('notes/first.md', '<p>abcdefghi</p>');
    const { editor, scrollContainer } = await renderEditor(currentNote);

    await waitFor(() => expect(editor.getHTML()).toBe('<p>abcdefghi</p>'));
    editor.commands.setTextSelection({ from: 3, to: 7 });
    scrollContainer.scrollTop = 140;

    // Toggling a setting in the useEditor dep list swaps the editor instance.
    // The note and its external revision are unchanged, so this is not a note
    // switch and must not throw the reader back to the top.
    act(() => {
      useSettingsStore.setState({ tagsEnabled: false });
    });

    await waitFor(() => expect(tiptapHarness.editor).not.toBe(editor));
    const rebuilt = tiptapHarness.editor as TiptapEditor;
    await waitFor(() => expect(rebuilt.getHTML()).toBe('<p>abcdefghi</p>'));

    // Scroll lives on a container outside the editor, so it survives the swap.
    // The cursor does not: the effect reads selection from the new instance,
    // and the old one is already gone by then. Scroll is the reported symptom.
    const container = document.querySelector('.editor-paper');
    if (!(container instanceof HTMLElement)) throw new Error('no scroll container');
    expect(container.scrollTop).toBe(140);
  });

  it('preserves scroll position and selection during an external reload', async () => {
    const currentNote = note('notes/first.md', '<p>abcdefghi</p>');
    const { editor, scrollContainer } = await renderEditor(currentNote);

    await waitFor(() => expect(editor.getHTML()).toBe('<p>abcdefghi</p>'));
    editor.commands.setTextSelection({ from: 3, to: 7 });
    scrollContainer.scrollTop = 180;
    tiptapHarness.setTextSelectionCalls = [];
    tiptapHarness.afterSetContent = () => {
      scrollContainer.scrollTop = 0;
    };

    act(() => {
      useNoteStore.getState().applyExternalContent(currentNote.id, '<p>externally changed</p>');
    });

    await waitFor(() => {
      expect(editor.getHTML()).toBe('<p>externally changed</p>');
      expect(scrollContainer.scrollTop).toBe(180);
      expect(editor.state.selection.from).toBe(3);
      expect(editor.state.selection.to).toBe(7);
    });
    expect(tiptapHarness.setTextSelectionCalls).toContainEqual([{ from: 3, to: 7 }]);
  });

  it('resets scroll and does not carry selection to a different note', async () => {
    const firstNote = note('notes/first.md', '<p>abcdefghi</p>');
    const secondNote = note('notes/second.md', '<p>second</p>');
    const { editor, scrollContainer } = await renderEditor(firstNote, [secondNote]);

    await waitFor(() => expect(editor.getHTML()).toBe('<p>abcdefghi</p>'));
    editor.commands.focus();
    await waitFor(() => expect(editor.isFocused).toBe(true));
    editor.commands.setTextSelection({ from: 3, to: 7 });
    scrollContainer.scrollTop = 220;
    tiptapHarness.setTextSelectionCalls = [];
    tiptapHarness.blurCallCount = 0;

    act(() => {
      useNoteStore.getState().switchTab(secondNote.id);
    });

    await waitFor(() => {
      expect(editor.getHTML()).toBe('<p>second</p>');
      expect(scrollContainer.scrollTop).toBe(0);
    });
    expect(tiptapHarness.setTextSelectionCalls).toEqual([]);
    await waitFor(() => {
      expect(tiptapHarness.blurCallCount).toBe(1);
      expect(editor.isFocused).toBe(false);
      expect(window.getSelection()?.rangeCount).toBe(0);
    });
  });
});

describe('Editor external change decisions', () => {
  it('names the attributed agent in the dirty-note prompt', () => {
    const currentNote = note('notes/first.md', '<p>My unsaved edit</p>');
    setOpenNotes(currentNote);
    useNoteStore.setState({
      externallyChanged: new Map([[currentNote.id, 'Claude Code']]),
    });

    render(<Editor />);

    expect(screen.getByRole('dialog')).toHaveTextContent('Claude Code wants to change this note.');
    expect(
      screen.getByText("You have unsaved edits. Accepting replaces them with the agent's version.")
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Accept' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Keep mine' })).toBeInTheDocument();
  });

  it('keeps the generic dirty-note wording when no marker matched', () => {
    const currentNote = note('notes/first.md', '<p>My unsaved edit</p>');
    setOpenNotes(currentNote);
    useNoteStore.setState({
      externallyChanged: new Map([[currentNote.id, null]]),
    });

    render(<Editor />);

    expect(screen.getByRole('dialog')).toHaveTextContent('This note changed on disk.');
    expect(screen.getByRole('button', { name: 'Use disk version' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Keep my version' })).toBeInTheDocument();
  });

  it('keeps mine through the existing autosave path and surfaces its conflict copy', async () => {
    const user = userEvent.setup();
    safeInvoke.mockImplementation(async (command: string) => {
      if (command === 'read_note') {
        return { content: 'disk body', color: null, contentHash: 'disk-hash' };
      }
      if (command === 'write_note') {
        return {
          contentHash: 'mine-hash',
          conflictCopy: 'first (conflict 2026-08-14 1200).md',
        };
      }
      if (command === 'list_notes') return [];
      return undefined;
    });
    await readNoteWithMeta('first.md', false, false);
    const currentNote = note('notes/first.md', '<p>My unsaved edit</p>');
    setOpenNotes(currentNote);
    useNoteStore.setState({
      externallyChanged: new Map([[currentNote.id, 'Claude Code']]),
    });
    const unregisterFlush = registerAutosaveFlush(async () => {
      notifyConflictCopy(await writeNote('first.md', 'My unsaved edit', false, false));
    });
    render(<Editor />);

    await user.click(screen.getByRole('button', { name: 'Keep mine' }));

    await waitFor(() => {
      expect(safeInvoke).toHaveBeenCalledWith('write_note', {
        filename: 'first.md',
        content: 'My unsaved edit',
        isDaily: false,
        isWeekly: false,
        color: null,
        baseHash: 'disk-hash',
      });
    });
    expect(useNoteStore.getState().externallyChanged.has(currentNote.id)).toBe(false);
    expect(useToastStore.getState().toasts[0]).toMatchObject({
      type: 'warning',
      message: expect.stringContaining('first (conflict 2026-08-14 1200).md'),
    });
    unregisterFlush();
  });
});

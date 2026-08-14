import { act, render, waitFor } from '@testing-library/react';
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

vi.mock('@/hooks', () => ({
  useAutoSave: vi.fn(),
  useKeyboardShortcuts: () => ({
    showTemplatePicker: false,
    handleTemplateSelect: vi.fn(),
    handleTemplatePickerClose: vi.fn(),
    openTemplatePicker: vi.fn(),
  }),
  useNotes: () => ({
    deleteCurrentNote: vi.fn(),
    loadDailyNote: vi.fn(),
    createNote: vi.fn(),
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

vi.mock('./EditorFooter', () => ({ EditorFooter: () => null }));
vi.mock('./TabBar', () => ({ TabBar: () => null }));
vi.mock('./SelectionToolbar', () => ({ SelectionToolbar: () => null }));
vi.mock('./ImageToolbar', () => ({ ImageToolbar: () => null }));
vi.mock('./LinkModal', () => ({ LinkModal: () => null }));
vi.mock('./ImageModal', () => ({ ImageModal: () => null }));
vi.mock('./ExternalChangeBanner', () => ({ ExternalChangeBanner: () => null }));
vi.mock('@/components/backlinks', () => ({ BacklinksPanel: () => null }));
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
} from '@/stores';
import { usePluginCommandStore } from '@/stores/pluginCommandStore';

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
    externallyChanged: new Set(),
  });
  useSettingsStore.setState({ spellCheck: true, tagsEnabled: true });
  useThemeStore.setState({ theme: 'light', baseMode: 'light' });
  useNoteColorsStore.setState({ colors: {}, isLoading: false });
  useTagStore.setState({ allTags: new Map(), selectedTags: [], selectedTag: null });
  usePluginCommandStore.getState().clear();
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
    expect(tiptapHarness.blurCallCount).toBe(1);
    await waitFor(() => {
      expect(editor.isFocused).toBe(false);
      expect(window.getSelection()?.rangeCount).toBe(0);
    });
  });
});

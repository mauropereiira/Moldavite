/** Dropped Markdown files open in place when the platform can place them, and read-only otherwise. */

import { act, fireEvent, render, renderHook, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useNoteStore, isCurrentNoteViewOnly } from '@/stores/noteStore';
import { useToastStore } from '@/stores/toastStore';
import { flushPendingAutosave } from './autosaveFlush';
import type { Note, NoteFile } from '@/types';

const invokeMock = vi.fn();

vi.mock('./ipc', () => ({
  safeInvoke: (...args: unknown[]) => invokeMock(...args),
}));
vi.mock('@/lib/ipc', () => ({
  safeInvoke: (...args: unknown[]) => invokeMock(...args),
}));

import { autoSaveTiming, useAutoSave } from '@/hooks/useAutoSave';
import { useNotes } from '@/hooks/useNotes';
import { installWindowDropGuard, setWindowFileDropHandler } from './dropGuard';
import { addDroppedToForge, openDroppedFiles } from './droppedFiles';
import { noteDiskFilename, saveNoteOnLeave } from './leaveSave';
import {
  keepMineLooseNote,
  saveLooseCopy,
  writeLooseNote,
  useLooseStatusStore,
} from './looseFiles';
import { isLooseViewOnly } from './looseId';
import { DroppedFileBanner, LooseFileBanner } from '@/components/editor/LooseFileBanner';
import { ExternalChangeBanner } from '@/components/editor/ExternalChangeBanner';

const LOOSE_ID = '0123456789abcdef0123456789abcdef';
const WRITE_COMMAND = /write|create|delete|trash|rename|move|save|add_/;

let admitted: unknown;
let listedNotes: NoteFile[];
let openForgeNote: ReturnType<typeof vi.fn<(rel: string) => Promise<unknown>>>;
let uninstallGuard: () => void;
let unregister: () => void;

function calls(command: string) {
  return invokeMock.mock.calls.filter(([name]) => name === command);
}

function writeCalls() {
  return invokeMock.mock.calls.filter(([name]) => WRITE_COMMAND.test(String(name)));
}

function markdownFile(name: string, text: string, lastModified = 1_791_016_922_000): File {
  return new File([text], name, { type: 'text/markdown', lastModified });
}

function drop(
  files: File[],
  { uriList = '', target = document.body }: { uriList?: string; target?: Element } = {}
): DragEvent {
  const event = new Event('drop', { bubbles: true, cancelable: true }) as DragEvent;
  const types = uriList ? ['Files', 'text/uri-list'] : ['Files'];
  let dispatching = true;
  Object.defineProperty(event, 'dataTransfer', {
    value: {
      types,
      files,
      getData: (type: string) => (dispatching && type === 'text/uri-list' ? uriList : ''),
    },
  });
  target.dispatchEvent(event);
  dispatching = false;
  return event;
}

async function settle() {
  await act(async () => {
    for (let i = 0; i < 10; i++) await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

function activeNote(): Note {
  const note = useNoteStore.getState().currentNote;
  if (!note) throw new Error('No note is open');
  return note;
}

const standalone = (name: string): NoteFile => ({
  name,
  path: `notes/${name}`,
  isDaily: false,
  isWeekly: false,
  isLocked: false,
});

beforeEach(() => {
  localStorage.clear();
  admitted = [null];
  listedNotes = [];
  invokeMock.mockReset();
  invokeMock.mockImplementation(async (command: string) => {
    switch (command) {
      case 'admit_dropped_files':
        if (admitted instanceof Error) throw admitted;
        return admitted;
      case 'read_loose_file':
        return {
          body: 'Hello from the desktop',
          hash: 'hash-1',
          readOnly: false,
          name: 'Read me.md',
          dirDisplay: '~/Desktop',
        };
      case 'write_loose_file':
        return { hash: 'hash-2' };
      case 'add_dropped_to_forge':
        return 'Dropped.md';
      case 'read_note':
        return { content: 'forge note', color: null, contentHash: 'forge-hash' };
      case 'write_note':
        return { contentHash: 'written', conflictCopy: null };
      case 'list_notes':
        return listedNotes;
      default:
        return undefined;
    }
  });
  autoSaveTiming.delayMs = 60_000;
  useNoteStore.setState({
    notes: [],
    openTabs: [],
    activeTabId: null,
    currentNote: null,
    recentNoteIds: [],
    unlockedNotes: new Set(),
    externallyChanged: new Map(),
    savedContent: new Map(),
    isSaving: false,
  });
  useToastStore.setState({ toasts: [] });
  openForgeNote = vi.fn(async () => true);
  uninstallGuard = installWindowDropGuard();
  unregister = setWindowFileDropHandler((files, event) => {
    void openDroppedFiles(files, event, openForgeNote);
  });
});

afterEach(() => {
  unregister();
  uninstallGuard();
  delete (window as { chrome?: unknown }).chrome;
  vi.restoreAllMocks();
});

describe('dropping a Markdown file on the window', () => {
  it('asks Rust to place it and opens it editable, saved to its own file', async () => {
    admitted = [{ kind: 'loose', id: LOOSE_ID, name: 'Read me.md', dirDisplay: '~/Desktop' }];
    renderHook(() => useAutoSave());
    const file = markdownFile('Read me.md', '# Hello');

    drop([file], { uriList: 'file:///home/me/Read%20me.md\r\n' });
    await settle();

    expect(calls('admit_dropped_files')).toEqual([
      [
        'admit_dropped_files',
        {
          candidates: [{ name: 'Read me.md', size: 7, lastModified: 1_791_016_922_000 }],
          uriList: 'file:///home/me/Read%20me.md\r\n',
          token: null,
        },
      ],
    ]);
    const note = activeNote();
    expect(note.id).toBe(`loose:${LOOSE_ID}`);
    expect(note.loose).toMatchObject({ looseId: LOOSE_ID, readOnly: false });
    expect(isCurrentNoteViewOnly(useNoteStore.getState())).toBe(false);
    invokeMock.mockClear();

    act(() => useNoteStore.getState().updateNoteContent('<p>Edited</p>', note.id));
    await act(() => flushPendingAutosave());

    expect(writeCalls()).toEqual([
      ['write_loose_file', { id: LOOSE_ID, body: 'Edited', baseHash: 'hash-1' }],
    ]);
  });

  it.each(['md', 'markdown', 'mdown', 'mkd'])(
    'opens a .%s drop through the native route without a page path',
    async (extension) => {
      admitted = [
        { kind: 'loose', id: LOOSE_ID, name: `Read me.${extension}`, dirDisplay: '~/Desktop' },
      ];
      const file = markdownFile(`Read me.${extension}`, '# Hello');

      drop([file]);
      await settle();

      expect(calls('admit_dropped_files')[0][1]).toEqual({
        candidates: [{ name: file.name, size: file.size, lastModified: file.lastModified }],
        uriList: null,
        token: null,
      });
      expect(activeNote().id).toBe(`loose:${LOOSE_ID}`);
    }
  );

  it('keeps every file in a multi-file drop, including an unmatched file', async () => {
    admitted = [{ kind: 'loose', id: LOOSE_ID, name: 'Read me.md', dirDisplay: '~/Desktop' }, null];

    drop([markdownFile('Read me.md', '# Hello'), markdownFile('Unknown.md', '# Unknown')]);
    await settle();

    const tabs = useNoteStore.getState().openTabs;
    expect(tabs).toHaveLength(2);
    expect(tabs[0].id).toBe(`loose:${LOOSE_ID}`);
    expect(tabs[1].loose?.viewOnlyReason).toBe('dropped');
  });

  it('hands WebView2 the dropped files and passes Rust the token it posted them under', async () => {
    const post = vi.fn();
    (window as { chrome?: unknown }).chrome = {
      webview: { postMessageWithAdditionalObjects: post },
    };
    admitted = [{ kind: 'loose', id: LOOSE_ID, name: 'Read me.md', dirDisplay: 'C:\\Notes' }];
    const file = markdownFile('Read me.md', '# Hello');

    drop([file]);
    await settle();

    expect(post).toHaveBeenCalledTimes(1);
    const [message, objects] = post.mock.calls[0];
    expect(objects).toEqual([file]);
    expect(message).toEqual({ moldaviteDrop: expect.stringMatching(/^[0-9a-f]{32}$/) });
    expect(calls('admit_dropped_files')[0][1]).toMatchObject({
      token: message.moldaviteDrop,
      uriList: null,
    });
    expect(activeNote().id).toBe(`loose:${LOOSE_ID}`);
  });

  it('opens a dropped note that lives in the Forge as that note', async () => {
    admitted = [{ kind: 'forgeNote', rel: 'notes/Plans.md' }];

    drop([markdownFile('Plans.md', '# Plans')]);
    await settle();

    expect(openForgeNote).toHaveBeenCalledWith('notes/Plans.md');
    expect(useNoteStore.getState().openTabs).toHaveLength(0);
  });

  it('reports only the Markdown files, and ignores a drop with none', async () => {
    const image = new File(['png'], 'photo.png', { type: 'image/png' });
    const text = new File(['plain'], 'notes.txt', { type: 'text/plain' });

    const ignored = drop([image, text]);
    await settle();

    expect(ignored.defaultPrevented).toBe(true);
    expect(invokeMock).not.toHaveBeenCalled();
    expect(useNoteStore.getState().openTabs).toHaveLength(0);

    drop([image, markdownFile('a.MARKDOWN', 'a'), text]);
    await settle();

    expect(calls('admit_dropped_files')[0][1].candidates).toEqual([
      { name: 'a.MARKDOWN', size: 1, lastModified: 1_791_016_922_000 },
    ]);
  });

  it('leaves a drop an inner handler took to that handler', async () => {
    const editor = document.createElement('div');
    document.body.appendChild(editor);
    const taken = vi.fn((event: Event) => event.preventDefault());
    editor.addEventListener('drop', taken);

    drop([markdownFile('Read me.md', '# Hello')], { target: editor });
    await settle();

    expect(taken).toHaveBeenCalledTimes(1);
    expect(invokeMock).not.toHaveBeenCalled();
    expect(useNoteStore.getState().openTabs).toHaveLength(0);
    editor.remove();
  });
});

describe('a dropped file Rust cannot place', () => {
  it('opens read-only without its frontmatter, saying why', async () => {
    drop([markdownFile('Dropped.md', '---\ntags: [a]\n---\n# Dropped\n\nBody text')]);
    await settle();

    const note = activeNote();
    expect(note.id).toMatch(/^dropped:[0-9a-f]{32}$/);
    expect(note.loose).toMatchObject({ readOnly: true, viewOnlyReason: 'dropped' });
    expect(note.loose?.looseId).toBeUndefined();
    expect(note.content).toContain('Body text');
    expect(note.content).not.toContain('tags');
    expect(isCurrentNoteViewOnly(useNoteStore.getState())).toBe(true);
  });

  it('opens read-only when asking Rust fails', async () => {
    admitted = new Error('IPC down');

    drop([markdownFile('Dropped.md', '# Dropped')]);
    await settle();

    expect(activeNote().loose?.viewOnlyReason).toBe('dropped');
  });

  it('is never written anywhere by autosave or by leaving it', async () => {
    const hook = renderHook(() => {
      const notes = useNotes();
      useAutoSave();
      return notes;
    });
    drop([markdownFile('Dropped.md', '# Dropped')]);
    await settle();
    const id = activeNote().id;
    invokeMock.mockClear();

    act(() => useNoteStore.getState().updateNoteContent('<p>typed over it</p>', id));
    await act(() => flushPendingAutosave());
    await act(async () => {
      await saveNoteOnLeave(activeNote());
    });
    await act(() => hook.result.current.loadNote(standalone('Elsewhere.md')));

    expect(writeCalls()).toEqual([]);
  });

  it('is never written even if its tab loses the loose info', async () => {
    renderHook(() => useAutoSave());
    const note: Note = {
      id: 'dropped:fedcba9876543210fedcba9876543210',
      title: 'Dropped.md',
      content: '<p>Dropped</p>',
      createdAt: new Date(),
      updatedAt: new Date(),
      isDaily: false,
      isWeekly: false,
    };
    act(() => useNoteStore.getState().openTab(note, true));
    act(() => useNoteStore.getState().updateNoteContent('<p>typed</p>', note.id));
    await act(() => flushPendingAutosave());
    await act(async () => {
      await saveNoteOnLeave(activeNote());
    });

    expect(writeCalls()).toEqual([]);
    expect(() => noteDiskFilename(note)).toThrow(/no Forge filename/);
    await expect(keepMineLooseNote(note)).rejects.toThrow(/view-only/);
    await expect(writeLooseNote(note)).rejects.toThrow(/view-only/);
    await expect(saveLooseCopy(note)).rejects.toThrow(/without its location/);
    act(() => {
      useLooseStatusStore.getState().setStatus(note.id, 'changed');
      useNoteStore.setState({ externallyChanged: new Map([[note.id, null]]) });
    });
    const banners = render(
      <>
        <ExternalChangeBanner />
        <LooseFileBanner />
      </>
    );
    expect(banners.container).toBeEmptyDOMElement();
    expect(writeCalls()).toEqual([]);
    expect(isLooseViewOnly(note)).toBe(true);
    expect(
      isLooseViewOnly({
        ...note,
        loose: { name: 'Dropped.md', dir: '', readOnly: false, editAnyway: true },
      })
    ).toBe(true);
  });

  it('shows the fallback banner and creates an editable Forge note only on Add to Forge', async () => {
    render(<DroppedFileBanner />);
    const raw = '---\ntags: [a]\n---\n# Dropped\n';
    act(() => {
      drop([markdownFile('Dropped.md', raw)]);
    });
    await settle();

    expect(screen.getByRole('status')).toHaveTextContent(
      "Moldavite couldn't find where this file lives, so it opened read-only. Use Open With or"
    );
    expect(screen.getByRole('status')).toHaveTextContent(/(?:⌘O|Ctrl\+O) to edit it\./);
    expect(writeCalls()).toEqual([]);
    listedNotes = [standalone('Dropped.md')];
    fireEvent.click(screen.getByRole('button', { name: 'Add to Forge' }));
    await settle();

    expect(writeCalls()).toEqual([['add_dropped_to_forge', { name: 'Dropped.md', text: raw }]]);
    expect(activeNote().id).toBe('notes/Dropped.md');
    expect(isCurrentNoteViewOnly(useNoteStore.getState())).toBe(false);
    expect(screen.queryByRole('status')).toBeNull();
    expect(useToastStore.getState().toasts.filter((toast) => toast.type === 'success')).toEqual([
      expect.objectContaining({ message: 'Added to the Forge' }),
    ]);
  });

  it('copies its text, frontmatter included, into the Forge on Add to Forge', async () => {
    const raw = '---\ntags: [a]\n---\n# Dropped\n';
    drop([markdownFile('Dropped.md', raw)]);
    await settle();
    invokeMock.mockClear();

    const path = await addDroppedToForge(activeNote());

    expect(path).toBe('notes/Dropped.md');
    expect(writeCalls()).toEqual([['add_dropped_to_forge', { name: 'Dropped.md', text: raw }]]);
  });
});

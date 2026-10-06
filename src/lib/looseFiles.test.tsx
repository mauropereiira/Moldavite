/** Loose notes: files outside the Forge open, save, conflict and close without touching it. */

import { act, fireEvent, render, renderHook, screen } from '@testing-library/react';
import { LooseFileBanner } from '@/components/editor/LooseFileBanner';
import { MoreOptionsMenu } from '@/components/editor/MoreOptionsMenu';
import { NoteCloseButton } from '@/components/editor/NoteCloseButton';
import { TabBar } from '@/components/editor/TabBar';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useNoteStore, isCurrentNoteViewOnly } from '@/stores/noteStore';
import { useQuickSwitcherStore } from '@/stores/quickSwitcherStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { useToastStore } from '@/stores/toastStore';
import { flushPendingAutosave } from './autosaveFlush';
import { namespacedKey } from './forgeStorage';
import type { LooseNoteInfo, Note, NoteFile } from '@/types';

const invokeMock = vi.fn();

vi.mock('./ipc', () => ({
  safeInvoke: (...args: unknown[]) => invokeMock(...args),
}));
vi.mock('@/lib/ipc', () => ({
  safeInvoke: (...args: unknown[]) => invokeMock(...args),
}));

import { useAutoSave } from '@/hooks/useAutoSave';
import { useNotes } from '@/hooks/useNotes';
import { useKeyboardShortcuts } from '@/hooks/useKeyboardShortcuts';
import {
  checkLooseNoteOnDisk,
  isFaithfulRoundTrip,
  keepMineLooseNote,
  openLooseFile,
  restoreOpenLooseFiles,
  saveLooseCopy,
  writeLooseNote,
  useLooseStatusStore,
} from './looseFiles';

const LOOSE_ID = '0123456789abcdef0123456789abcdef';
const NOTE_ID = `loose:${LOOSE_ID}`;
const admission = { id: LOOSE_ID, name: 'Read me.md', dirDisplay: '~/Desktop' };

let diskBody: string;
let diskHash: string;
let readOnly: boolean;
let writeError: string | null;

function calls(command: string) {
  return invokeMock.mock.calls.filter(([name]) => name === command);
}

const standalone = (name: string): NoteFile => ({
  name,
  path: `notes/${name}`,
  isDaily: false,
  isWeekly: false,
  isLocked: false,
});

beforeEach(async () => {
  localStorage.clear();
  diskBody = 'Hello from outside';
  diskHash = 'hash-1';
  readOnly = false;
  writeError = null;
  invokeMock.mockReset();
  invokeMock.mockImplementation(async (command: string, payload?: Record<string, unknown>) => {
    switch (command) {
      case 'read_loose_file':
        return {
          body: diskBody,
          hash: diskHash,
          readOnly,
          name: admission.name,
          dirDisplay: admission.dirDisplay,
        };
      case 'write_loose_file':
        if (writeError) throw new Error(writeError);
        diskBody = String(payload?.body);
        diskHash = `hash-of:${diskBody}`;
        return { hash: diskHash };
      case 'stat_loose_file':
        return { hash: diskHash };
      case 'read_note':
        return { content: 'forge note', color: null, contentHash: 'forge-hash' };
      case 'write_note':
        return { contentHash: 'written', conflictCopy: null };
      case 'list_notes':
        return [];
      default:
        return undefined;
    }
  });
  useSettingsStore.setState({ autoSaveDelay: 60_000 });
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
  useLooseStatusStore.setState({ status: {} });
  useQuickSwitcherStore.setState({ pinnedNoteIds: [] });
  useToastStore.setState({ toasts: [] });
  await new Promise((resolve) => setTimeout(resolve, 0));
  invokeMock.mockClear();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function renderEditing() {
  return renderHook(() => {
    const notes = useNotes();
    useAutoSave();
    return notes;
  });
}

function activeNote(): Note {
  const note = useNoteStore.getState().currentNote;
  if (!note) throw new Error('No note is open');
  return note;
}

function activeLoose(): LooseNoteInfo {
  const loose = activeNote().loose;
  if (!loose) throw new Error('The open note is not a loose file');
  return loose;
}

async function openAndEdit(typed: string) {
  await act(() => openLooseFile(admission));
  act(() => useNoteStore.getState().updateNoteContent(typed, NOTE_ID));
}

describe('opening a loose file', () => {
  it('adds a Forge copy from the menu, refreshes and opens it, and toasts once', async () => {
    await act(() => openLooseFile(admission));
    const backend = invokeMock.getMockImplementation();
    if (!backend) throw new Error('No file backend');
    invokeMock.mockImplementation(async (command: string, payload?: Record<string, unknown>) => {
      if (command === 'add_loose_to_forge') return 'Copy.md';
      if (command === 'list_notes') return [standalone('Copy.md')];
      return backend(command, payload);
    });
    render(
      <MoreOptionsMenu
        onDelete={vi.fn()}
        wordCount={3}
        characterCount={18}
        onRenameNote={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'More options' }));
    await act(async () => {
      fireEvent.click(screen.getByText('Add to Forge'));
    });

    expect(calls('add_loose_to_forge')).toEqual([['add_loose_to_forge', { id: LOOSE_ID }]]);
    expect(calls('list_notes')).toHaveLength(1);
    expect(activeNote().id).toBe('notes/Copy.md');
    expect(useToastStore.getState().toasts).toEqual([
      expect.objectContaining({ type: 'success', message: 'Added to the Forge' }),
    ]);
  });

  it('opens it in its own tab, editable, without adding it to recent notes', async () => {
    await act(() => openLooseFile(admission));

    const state = useNoteStore.getState();
    expect(state.currentNote?.id).toBe(NOTE_ID);
    expect(state.currentNote?.loose).toMatchObject({
      looseId: LOOSE_ID,
      name: 'Read me.md',
      dir: '~/Desktop',
      readOnly: false,
    });
    expect(isCurrentNoteViewOnly(state)).toBe(false);
    expect(state.recentNoteIds).toEqual([]);
    expect(localStorage.getItem(namespacedKey('moldavite-recent-notes')) ?? '').not.toContain(
      'loose:'
    );
  });

  it('opens a file it cannot save view-only, saying why', async () => {
    readOnly = true;
    await act(() => openLooseFile(admission));

    const state = useNoteStore.getState();
    expect(state.currentNote?.loose?.viewOnlyReason).toBe('permissions');
    expect(isCurrentNoteViewOnly(state)).toBe(true);
  });

  it('opens a file the editor would rewrite view-only until the user edits anyway', async () => {
    diskBody = '| a | b |\n|---|---|\n| 1 | 2 |';
    await act(() => openLooseFile(admission));

    expect(activeLoose().viewOnlyReason).toBe('lossy');
    expect(isCurrentNoteViewOnly(useNoteStore.getState())).toBe(true);

    act(() =>
      useNoteStore.getState().updateLooseInfo(NOTE_ID, { ...activeLoose(), editAnyway: true })
    );
    expect(isCurrentNoteViewOnly(useNoteStore.getState())).toBe(false);
  });

  it('switches to the open tab instead of reading the file over unsaved edits', async () => {
    await openAndEdit('<p>mine</p>');
    await act(() => openLooseFile(admission));

    expect(calls('read_loose_file')).toHaveLength(1);
    expect(useNoteStore.getState().currentNote?.content).toBe('<p>mine</p>');
  });
});

describe('the fidelity check', () => {
  it('rejects code whitespace lost by the editor schema', () => {
    expect(isFaithfulRoundTrip('Use `a  b` here.')).toBe(false);
  });

  it('preserves fenced code whitespace', () => {
    expect(isFaithfulRoundTrip('```\na  b\n  c\n```')).toBe(true);
    expect(isFaithfulRoundTrip('```\na  b\n```', '<pre><code>a b\n</code></pre>')).toBe(false);
  });

  it('compares code delimiters verbatim too', () => {
    expect(isFaithfulRoundTrip('~~~\na  b\n~~~')).toBe(false);
    expect(isFaithfulRoundTrip('Use ``a b`` here.')).toBe(false);
  });

  it('keeps list nesting significant', () => {
    expect(isFaithfulRoundTrip('- a\n  - b')).toBe(true);
    expect(isFaithfulRoundTrip('- a\n  - b', '<ul><li>a</li><li>b</li></ul>')).toBe(false);
  });

  it('distinguishes a paragraph inside a list item from one after it', () => {
    expect(isFaithfulRoundTrip('- a\n\n  paragraph', '<ul><li>a</li></ul><p>paragraph</p>')).toBe(
      false
    );
  });

  it('detects when adjacent lists become one', () => {
    expect(isFaithfulRoundTrip('* a\n\n- b')).toBe(false);
  });

  it('trips on a table', () => {
    expect(isFaithfulRoundTrip('| a | b |\n|---|---|\n| 1 | 2 |')).toBe(false);
  });

  it('trips on raw HTML', () => {
    expect(isFaithfulRoundTrip('<div class="note">Hello</div>')).toBe(false);
  });

  it('passes ordinary files written in another style: bullets, spacing and wrapped lines', () => {
    const readme =
      '# Notes\n\nA paragraph that the author\nwrapped by hand at a fixed\nwidth.\n\n* apples\n* pears\n\n1.  first\n2.  second\n';
    expect(isFaithfulRoundTrip(readme)).toBe(true);
  });

  it('still trips when two paragraphs would become one', () => {
    expect(isFaithfulRoundTrip('one\n\n\n<!-- note -->\n\ntwo')).toBe(false);
  });

  it('passes Markdown the editor writes the same way, ignoring trailing whitespace', () => {
    expect(isFaithfulRoundTrip('# Title\n\nSome *emphasis* and **bold**.  \n\n> A quote\n')).toBe(
      true
    );
  });
});

describe('saving a loose file', () => {
  it('refuses every direct write of a view-only file, including Keep mine', async () => {
    diskBody = '<div>Unsupported HTML</div>';
    await act(() => openLooseFile(admission));
    diskHash = 'changed';
    await expect(keepMineLooseNote(activeNote())).rejects.toThrow(/view.only/i);
    await expect(writeLooseNote(activeNote())).rejects.toThrow(/view.only/i);
    expect(calls('write_loose_file')).toHaveLength(0);
  });

  it('copies view-only disk bytes without sending converted content', async () => {
    diskBody = '<div>Unsupported HTML</div>';
    await act(() => openLooseFile(admission));
    await saveLooseCopy(activeNote());
    expect(calls('save_loose_copy_dialog')).toEqual([['save_loose_copy_dialog', { id: LOOSE_ID }]]);
  });

  it('offers Reload without Keep mine for a changed view-only file', async () => {
    diskBody = '<div>Unsupported HTML</div>';
    await act(() => openLooseFile(admission));
    diskHash = 'changed';
    await act(() => checkLooseNoteOnDisk(activeNote()));
    render(<LooseFileBanner />);
    expect(screen.queryByRole('button', { name: 'Keep mine' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Reload' })).toHaveClass('focus-ring');
    expect(screen.getByRole('status').querySelector('button')).toBeNull();
  });

  it('copies an editable tab with its current content', async () => {
    await openAndEdit('<p>Edited</p>');
    await saveLooseCopy(activeNote());
    expect(calls('save_loose_copy_dialog')).toEqual([
      ['save_loose_copy_dialog', { id: LOOSE_ID, body: 'Edited' }],
    ]);
  });

  it('restores loose tabs without activating them', async () => {
    const forge: Note = {
      id: 'notes/Here.md',
      title: 'Here',
      content: '<p>Forge</p>',
      createdAt: new Date(),
      updatedAt: new Date(),
      isDaily: false,
      isWeekly: false,
    };
    useNoteStore.getState().openTab(forge, true);
    invokeMock.mockImplementationOnce(async () => [admission]);
    await restoreOpenLooseFiles();
    expect(useNoteStore.getState().openTabs.map((note) => note.id)).toEqual([forge.id, NOTE_ID]);
    expect(useNoteStore.getState().currentNote?.id).toBe(forge.id);
  });
  // Regression: a tab whose id is not `notes/…` used to fall back to
  // `${title}.md` and be written into the Forge.
  it('autosave writes the file by session id and never writes a Forge note', async () => {
    renderEditing();
    await openAndEdit('<p>typed</p>');

    await act(() => flushPendingAutosave());

    expect(calls('write_note')).toHaveLength(0);
    expect(calls('write_loose_file')).toEqual([
      ['write_loose_file', { id: LOOSE_ID, body: 'typed', baseHash: 'hash-1' }],
    ]);
  });

  it('leaving the tab writes the file by session id and never writes a Forge note', async () => {
    const hook = renderEditing();
    await openAndEdit('<p>typed</p>');

    await act(() => hook.result.current.loadNote(standalone('Elsewhere.md')));

    expect(calls('write_note')).toHaveLength(0);
    expect(calls('write_loose_file')).toHaveLength(1);
    expect(calls('write_loose_file')[0][1]).toMatchObject({ id: LOOSE_ID, body: 'typed' });
  });

  it('writes nothing for a file that was only viewed', async () => {
    const hook = renderEditing();
    await act(() => openLooseFile(admission));

    await act(() => flushPendingAutosave());
    await act(() => hook.result.current.loadNote(standalone('Elsewhere.md')));

    expect(calls('write_loose_file')).toHaveLength(0);
    expect(calls('write_note')).toHaveLength(0);
  });

  it('never writes a view-only file, even when its tab content changes', async () => {
    readOnly = true;
    renderEditing();
    await openAndEdit('<p>should not land</p>');

    await act(() => flushPendingAutosave());

    expect(calls('write_loose_file')).toHaveLength(0);
    expect(calls('write_note')).toHaveLength(0);
  });

  it('carries the hash of its own last save into the next one', async () => {
    renderEditing();
    await openAndEdit('<p>first</p>');
    await act(() => flushPendingAutosave());
    act(() => useNoteStore.getState().updateNoteContent('<p>second</p>', NOTE_ID));
    await act(() => flushPendingAutosave());

    expect(calls('write_loose_file').map(([, payload]) => payload.baseHash)).toEqual([
      'hash-1',
      'hash-of:first',
    ]);
  });
});

describe('a loose file changed on disk', () => {
  it('refuses the save, raises the banner, and neither retries nor toasts', async () => {
    vi.useFakeTimers();
    writeError = 'conflict:hash-disk';
    const hook = renderEditing();
    await openAndEdit('<p>mine</p>');

    await act(() => hook.result.current.loadNote(standalone('Elsewhere.md')));
    await act(() => vi.advanceTimersByTimeAsync(10_000));
    act(() => useNoteStore.getState().switchTab(NOTE_ID));
    act(() => useNoteStore.getState().updateNoteContent('<p>more</p>', NOTE_ID));
    await act(() => flushPendingAutosave());

    expect(calls('write_loose_file')).toHaveLength(1);
    expect(calls('write_note')).toHaveLength(0);
    expect(useLooseStatusStore.getState().status[NOTE_ID]).toBe('changed');
    expect(useToastStore.getState().toasts).toHaveLength(0);
    expect(useNoteStore.getState().openTabs.find((tab) => tab.id === NOTE_ID)?.content).toBe(
      '<p>more</p>'
    );
  });

  it('Keep mine overwrites using the hash that is on disk now', async () => {
    writeError = 'conflict:hash-disk';
    renderEditing();
    await openAndEdit('<p>mine</p>');
    await act(() => flushPendingAutosave());

    writeError = null;
    diskHash = 'hash-disk';
    await act(() => keepMineLooseNote(activeNote()));

    const writes = calls('write_loose_file');
    const last = writes[writes.length - 1]?.[1];
    expect(last).toMatchObject({ body: 'mine', baseHash: 'hash-disk' });
    expect(useLooseStatusStore.getState().status[NOTE_ID]).toBeUndefined();
  });

  it('raises the banner when focus finds the file changed', async () => {
    await act(() => openLooseFile(admission));
    diskHash = 'hash-2';

    await act(() => checkLooseNoteOnDisk(activeNote()));

    expect(useLooseStatusStore.getState().status[NOTE_ID]).toBe('changed');
  });
});

describe('pins and closing', () => {
  describe.each(['⌘W', 'tab bar', 'NoteCloseButton'])('%s', (control) => {
    it.each(['conflict:hash-disk', 'Moved', 'Disk full'])(
      'keeps unsaved edits and the file session after a failed save: %s',
      async (error) => {
        vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15'
        );
        renderEditing();
        renderHook(() => useKeyboardShortcuts({ editor: null }));
        await openAndEdit('<p>mine</p>');
        writeError = error;
        await act(() => flushPendingAutosave());
        const saved = useNoteStore.getState().savedContent.get(NOTE_ID);
        if (control === 'tab bar') render(<TabBar />);
        if (control === 'NoteCloseButton') {
          render(
            <NoteCloseButton
              noteId={NOTE_ID}
              title={admission.name}
              onClose={() => useNoteStore.getState().closeTab(NOTE_ID)}
            />
          );
        }
        render(<LooseFileBanner />);

        await act(async () => {
          if (control === '⌘W') {
            window.dispatchEvent(new KeyboardEvent('keydown', { key: 'w', metaKey: true }));
          } else {
            fireEvent.click(screen.getByRole('button', { name: /^Close Read me/ }));
          }
        });

        expect(useNoteStore.getState().openTabs).toHaveLength(1);
        expect(activeNote().content).toBe('<p>mine</p>');
        expect(useNoteStore.getState().savedContent.get(NOTE_ID)).toBe(saved);
        expect(calls('close_loose_file')).toHaveLength(0);
        expect(useToastStore.getState().toasts[0].message).toMatch(/still open.*Save a copy/);
        if (error !== 'Disk full') {
          expect(screen.getByRole('button', { name: 'Save a copy…' })).toBeInTheDocument();
        }
      }
    );
  });

  it('flushes pending edits before closing a loose tab', async () => {
    renderEditing();
    await openAndEdit('<p>saved before closing</p>');

    await act(async () => {
      await useNoteStore.getState().closeTab(NOTE_ID);
    });

    expect(diskBody).toBe('saved before closing');
    expect(useNoteStore.getState().openTabs).toHaveLength(0);
    expect(calls('close_loose_file')).toHaveLength(1);
  });

  it('keeps edits typed while the close flush is writing', async () => {
    renderEditing();
    await openAndEdit('<p>first</p>');
    let finish!: (result: { hash: string }) => void;
    invokeMock.mockImplementationOnce(() => new Promise((resolve) => (finish = resolve)));
    const closing = useNoteStore.getState().closeTab(NOTE_ID);
    await act(async () => {
      await Promise.resolve();
      useNoteStore.getState().updateNoteContent('<p>newer</p>', NOTE_ID);
      finish({ hash: 'hash-of:first' });
      await closing;
    });

    expect(activeNote().content).toBe('<p>newer</p>');
    expect(useNoteStore.getState().savedContent.get(NOTE_ID)).toBe('<p>first</p>');
    expect(calls('close_loose_file')).toHaveLength(0);
  });

  it('closes after Keep mine has saved the previously conflicted edits', async () => {
    renderEditing();
    await openAndEdit('<p>mine</p>');
    writeError = 'conflict:hash-disk';
    await act(() => flushPendingAutosave());
    await act(() => useNoteStore.getState().closeTab(NOTE_ID));
    expect(activeNote().content).toBe('<p>mine</p>');

    writeError = null;
    diskHash = 'hash-disk';
    await act(() => keepMineLooseNote(activeNote()));
    await act(() => useNoteStore.getState().closeTab(NOTE_ID));

    expect(diskBody).toBe('mine');
    expect(useNoteStore.getState().openTabs).toHaveLength(0);
    expect(calls('close_loose_file')).toHaveLength(1);
  });

  it('keeps and activates an inactive unsaved loose tab when closing all tabs', async () => {
    const hook = renderEditing();
    await openAndEdit('<p>mine</p>');
    writeError = 'conflict:hash-disk';
    await act(() => hook.result.current.loadNote(standalone('Elsewhere.md')));
    expect(activeNote().id).toBe('notes/Elsewhere.md');
    render(<TabBar />);

    fireEvent.click(screen.getByRole('button', { name: 'Open tabs' }));
    await act(async () => {
      fireEvent.click(screen.getByRole('menuitem', { name: 'Close all tabs' }));
    });

    expect(useNoteStore.getState().openTabs).toHaveLength(1);
    expect(activeNote().id).toBe(NOTE_ID);
    expect(activeNote().content).toBe('<p>mine</p>');
    expect(calls('close_loose_file')).toHaveLength(0);
  });

  it('keeps loose tabs out of pins: no pin control, and the pin list refuses them', async () => {
    await act(() => openLooseFile(admission));
    render(<TabBar />);
    render(<NoteCloseButton noteId={NOTE_ID} title={admission.name} onClose={() => {}} />);

    act(() => useQuickSwitcherStore.getState().togglePinned(NOTE_ID));

    expect(screen.queryByRole('button', { name: /^Pin / })).not.toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /^Close Read me/ })).toHaveLength(2);
    expect(useQuickSwitcherStore.getState().pinnedNoteIds).toEqual([]);
  });

  it('closes a loose tab and gives the file back to Rust', async () => {
    await act(() => openLooseFile(admission));

    await act(async () => {
      useNoteStore.getState().closeTab(NOTE_ID);
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(useNoteStore.getState().openTabs).toHaveLength(0);
    expect(invokeMock).toHaveBeenCalledWith('close_loose_file', { id: LOOSE_ID });
  });

  it('⌘W closes a loose tab', async () => {
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15'
    );
    renderHook(() => useKeyboardShortcuts({ editor: null }));
    await act(() => openLooseFile(admission));

    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'w', metaKey: true }));
    });

    expect(useNoteStore.getState().openTabs).toHaveLength(0);
  });
});

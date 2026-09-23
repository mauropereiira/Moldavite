/** A note New made and left empty is deleted, and nothing else ever is. */

import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useNoteStore } from '@/stores/noteStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { useToastStore } from '@/stores/toastStore';
import type { NoteFile } from '@/types';
import { discardLeaveSave, heldLeaveSaveIds } from '@/lib/leaveSave';

const invokeMock = vi.fn();

vi.mock('@/lib/ipc', () => ({
  safeInvoke: (...args: unknown[]) => invokeMock(...args),
}));

import { useNotes } from './useNotes';
import { useAutoSave } from './useAutoSave';

const other: NoteFile = {
  name: 'Other.md',
  path: 'notes/Other.md',
  isDaily: false,
  isWeekly: false,
  isLocked: false,
};

let disk: Record<string, { content: string; color?: string }> = {};
let writeError: Error | null = null;
let deleteError: Error | null = null;

const deletes = () => invokeMock.mock.calls.filter(([command]) => command === 'delete_note');
const listed = (path: string) => useNoteStore.getState().notes.some((n) => n.path === path);

function renderNotes() {
  return renderHook(() => {
    const notes = useNotes();
    useAutoSave();
    return notes;
  });
}

async function newNote(hook: ReturnType<typeof renderNotes>, discardIfLeftEmpty = true) {
  await act(() => hook.result.current.createNote('Untitled', null, { discardIfLeftEmpty }));
  expect(useNoteStore.getState().currentNote?.id).toBe('notes/Untitled.md');
}

/** Let a discard that may have started finish its read and delete. */
async function settle() {
  await act(async () => {
    for (let i = 0; i < 10; i++) await Promise.resolve();
  });
}

beforeEach(() => {
  localStorage.clear();
  disk = { 'Other.md': { content: 'other' } };
  writeError = null;
  deleteError = null;
  invokeMock.mockReset();
  invokeMock.mockImplementation(async (command: string, payload?: Record<string, unknown>) => {
    const filename = String(payload?.filename ?? '');
    switch (command) {
      case 'create_note':
        disk['Untitled.md'] = { content: '' };
        return 'Untitled.md';
      case 'read_note': {
        const file = disk[filename] ?? { content: '' };
        return {
          content: file.content,
          color: file.color ?? null,
          contentHash: `hash:${file.content}`,
        };
      }
      case 'write_note':
        if (writeError) throw writeError;
        disk[filename] = { content: String(payload?.content ?? '') };
        return { contentHash: `hash:${payload?.content}`, conflictCopy: null };
      case 'delete_note':
        if (deleteError) throw deleteError;
        if (payload?.baseHash !== `hash:${disk[filename]?.content}`) {
          throw new Error('Note changed on disk since it was last read — not deleting');
        }
        delete disk[filename];
        return undefined;
      case 'rename_note':
        disk[String(payload?.newFilename)] = disk[String(payload?.oldFilename)];
        delete disk[String(payload?.oldFilename)];
        return undefined;
      case 'list_notes':
        return [];
      default:
        return undefined;
    }
  });
  useSettingsStore.setState({ autoSaveDelay: 60_000, indexMode: 'overlay' });
  useNoteStore.setState({
    notes: [other],
    openTabs: [],
    activeTabId: null,
    currentNote: null,
    recentNoteIds: [],
    unlockedNotes: new Set(),
    externallyChanged: new Map(),
    savedContent: new Map(),
    pendingUnlock: null,
    isLoading: false,
    isSaving: false,
  });
  useToastStore.setState({ toasts: [] });
});

afterEach(() => {
  for (const id of heldLeaveSaveIds()) discardLeaveSave(id);
});

describe('an empty note from New', () => {
  it('is deleted, without a Trash entry, when another note replaces it', async () => {
    const hook = renderNotes();
    await newNote(hook);

    await act(() => hook.result.current.loadNote(other));

    await waitFor(() => expect(listed('notes/Untitled.md')).toBe(false));
    expect(deletes()).toEqual([
      [
        'delete_note',
        { filename: 'Untitled.md', isDaily: false, isWeekly: false, baseHash: 'hash:' },
      ],
    ]);
    expect(invokeMock.mock.calls.some(([command]) => command === 'trash_note')).toBe(false);
    expect(disk['Untitled.md']).toBeUndefined();
    expect(useNoteStore.getState().recentNoteIds).not.toContain('notes/Untitled.md');
    expect(useNoteStore.getState().currentNote?.id).toBe('notes/Other.md');
  });

  it('is deleted when its tab is closed', async () => {
    const hook = renderNotes();
    await newNote(hook);

    act(() => useNoteStore.getState().closeTab('notes/Untitled.md'));

    await waitFor(() => expect(listed('notes/Untitled.md')).toBe(false));
    expect(disk['Untitled.md']).toBeUndefined();
  });

  it('is deleted when it held text that was all deleted again', async () => {
    const hook = renderNotes();
    await newNote(hook);
    act(() => useNoteStore.getState().updateNoteContent('<p>x</p>', 'notes/Untitled.md'));
    act(() => useNoteStore.getState().updateNoteContent('<p></p>', 'notes/Untitled.md'));

    await act(() => hook.result.current.loadNote(other));

    await waitFor(() => expect(listed('notes/Untitled.md')).toBe(false));
  });
});

describe('a note is kept', () => {
  it('when it has text', async () => {
    const hook = renderNotes();
    await newNote(hook);
    act(() => useNoteStore.getState().updateNoteContent('<p>Milk</p>', 'notes/Untitled.md'));

    await act(() => hook.result.current.loadNote(other));
    await settle();

    expect(deletes()).toHaveLength(0);
    expect(disk['Untitled.md']).toEqual({ content: 'Milk' });
    expect(listed('notes/Untitled.md')).toBe(true);
  });

  it('when it was renamed', async () => {
    const hook = renderNotes();
    await newNote(hook);

    const untitled: NoteFile = { ...other, name: 'Untitled.md', path: 'notes/Untitled.md' };
    await act(() => hook.result.current.renameNote(untitled, 'Groceries'));
    await act(() => hook.result.current.loadNote(other));
    await settle();

    expect(deletes()).toHaveLength(0);
    expect(listed('notes/Groceries.md')).toBe(true);
    expect(disk['Groceries.md']).toEqual({ content: '' });
  });

  it('when it was not made by New', async () => {
    const hook = renderNotes();
    await newNote(hook, false);

    await act(() => hook.result.current.loadNote(other));
    await settle();

    expect(deletes()).toHaveLength(0);
    expect(listed('notes/Untitled.md')).toBe(true);
  });

  it('when its file was written elsewhere', async () => {
    const hook = renderNotes();
    await newNote(hook);
    disk['Untitled.md'] = { content: 'from another device' };

    await act(() => hook.result.current.loadNote(other));
    await settle();

    expect(deletes()).toHaveLength(0);
    expect(disk['Untitled.md']).toEqual({ content: 'from another device' });
    expect(listed('notes/Untitled.md')).toBe(true);
  });

  it('when it was given a colour', async () => {
    const hook = renderNotes();
    await newNote(hook);
    disk['Untitled.md'] = { content: '', color: 'sage' };

    await act(() => hook.result.current.loadNote(other));
    await settle();

    expect(deletes()).toHaveLength(0);
    expect(listed('notes/Untitled.md')).toBe(true);
  });

  it('when its file changes between the check and the delete', async () => {
    const hook = renderNotes();
    await newNote(hook);
    const read = invokeMock.getMockImplementation();
    invokeMock.mockImplementation(async (command: string, payload?: Record<string, unknown>) => {
      const result = await read?.(command, payload);
      if (command === 'read_note' && payload?.filename === 'Untitled.md') {
        disk['Untitled.md'] = { content: 'typed on the Mac' };
      }
      return result;
    });
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

    act(() => useNoteStore.getState().closeTab('notes/Untitled.md'));
    await settle();

    expect(disk['Untitled.md']).toEqual({ content: 'typed on the Mac' });
    expect(listed('notes/Untitled.md')).toBe(true);
    consoleError.mockRestore();
  });

  it('when an autosave of it is still pending', async () => {
    const hook = renderNotes();
    await newNote(hook);
    act(() => useNoteStore.getState().updateNoteContent('<p></p>', 'notes/Untitled.md'));

    act(() => useNoteStore.getState().closeTab('notes/Untitled.md'));
    await settle();

    expect(deletes()).toHaveLength(0);
    expect(listed('notes/Untitled.md')).toBe(true);
  });

  it('when its save is held after a failed write', async () => {
    const hook = renderNotes();
    await newNote(hook);
    writeError = new Error('disk full');
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    act(() => useNoteStore.getState().updateNoteContent('<p> </p>', 'notes/Untitled.md'));

    await act(() => hook.result.current.loadNote(other));
    expect(heldLeaveSaveIds()).toContain('notes/Untitled.md');
    act(() => useNoteStore.getState().closeTab('notes/Untitled.md'));
    await settle();

    expect(deletes()).toHaveLength(0);
    expect(listed('notes/Untitled.md')).toBe(true);
    consoleError.mockRestore();
  });

  it('when it is locked', async () => {
    const hook = renderNotes();
    await newNote(hook);

    act(() => {
      useNoteStore.setState((state) => ({
        notes: state.notes.map((n) =>
          n.path === 'notes/Untitled.md' ? { ...n, isLocked: true } : n
        ),
      }));
      useNoteStore.getState().removeTabByPath('notes/Untitled.md');
    });
    await settle();

    expect(deletes()).toHaveLength(0);
    expect(listed('notes/Untitled.md')).toBe(true);
  });

  it('in the list when the delete is refused', async () => {
    const hook = renderNotes();
    await newNote(hook);
    deleteError = new Error('Note is locked');
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

    await act(() => hook.result.current.loadNote(other));
    await settle();

    expect(deletes()).toHaveLength(1);
    expect(listed('notes/Untitled.md')).toBe(true);
    consoleError.mockRestore();
  });
});

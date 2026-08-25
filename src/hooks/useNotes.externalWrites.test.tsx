import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getLastPersistedMarkdown, readNoteWithMeta } from '@/lib/fileSystem';
import {
  beginAutosavePathChange,
  commitAutosavePathChange,
  flushPendingAutosave,
  getPendingAutosaveNoteId,
} from '@/lib/autosaveFlush';
import { useForgeStore } from '@/stores/forgeStore';
import { useNoteColorsStore } from '@/stores/noteColorsStore';
import { useNoteSelectionStore } from '@/stores/noteSelectionStore';
import { useNoteStore } from '@/stores/noteStore';
import { useQuickSwitcherStore } from '@/stores/quickSwitcherStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { useSidebarOrderStore } from '@/stores/sidebarOrderStore';
import { useTemplateStore } from '@/stores/templateStore';
import { useWordPressStore } from '@/stores/wordpressStore';
import type { Note, NoteFile } from '@/types';

const invokeMock = vi.fn();

vi.mock('@/lib/ipc', () => ({
  safeInvoke: (...args: unknown[]) => invokeMock(...args),
}));

import { useNotes } from './useNotes';
import { discardPendingAutosaveForNote, useAutoSave } from './useAutoSave';
import { useTrash } from './useTrash';

beforeEach(() => {
  localStorage.clear();
  invokeMock.mockReset();
  invokeMock.mockImplementation(async (command: string) => {
    if (command === 'list_notes') return [];
    if (command === 'read_note') {
      return { content: '', color: null, contentHash: 'empty-hash' };
    }
    if (command === 'create_note') return 'created.md';
    if (command === 'list_trash') return [];
    if (command === 'trash_note') return 'trash-1';
    return undefined;
  });
  useTemplateStore.setState({ defaultDailyTemplate: null });
  useSettingsStore.setState({ autoSaveDelay: 60_000 });
  useForgeStore.setState({ active: 'Old Forge' });
  useNoteStore.setState({
    notes: [],
    openTabs: [],
    activeTabId: null,
    currentNote: null,
    recentNoteIds: [],
    unlockedNotes: new Set(),
    externallyChanged: new Map(),
    isLoading: false,
    isSaving: false,
  });
});

describe('useNotes external-write bases', () => {
  it('reads a missing daily note before opening its virtual buffer', async () => {
    const hook = renderHook(() => useNotes());
    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith('list_notes'));

    await act(() => hook.result.current.loadDailyNote(new Date(2026, 6, 31)));

    expect(invokeMock).toHaveBeenCalledWith('read_note', {
      filename: '2026-07-31.md',
      isDaily: true,
      isWeekly: false,
    });
    expect(getLastPersistedMarkdown('2026-07-31.md', true, false)).toBe('');
    expect(useNoteStore.getState().currentNote?.id).toBe('2026-07-31.md');
  });

  it('opens a raced daily file as a real note when the list was stale', async () => {
    invokeMock.mockImplementation(async (command: string) => {
      if (command === 'list_notes') return [];
      if (command === 'read_note') {
        return { content: '# Agent update', color: null, contentHash: 'agent-hash' };
      }
      return undefined;
    });
    const hook = renderHook(() => useNotes());
    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith('list_notes'));

    await act(() => hook.result.current.loadDailyNote(new Date(2026, 6, 31)));

    expect(useNoteStore.getState().currentNote).toMatchObject({
      id: 'daily/2026-07-31.md',
      isDaily: true,
      date: '2026-07-31',
    });
    expect(useNoteStore.getState().currentNote?.content).toContain('Agent update');
    expect(useNoteStore.getState().notes).toContainEqual(
      expect.objectContaining({ path: 'daily/2026-07-31.md' })
    );
  });

  it('primes the empty base after creating a standalone note', async () => {
    const hook = renderHook(() => useNotes());
    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith('list_notes'));

    await act(() => hook.result.current.createNote('Created'));

    expect(invokeMock).toHaveBeenCalledWith('read_note', {
      filename: 'created.md',
      isDaily: false,
      isWeekly: false,
    });
    expect(getLastPersistedMarkdown('created.md', false, false)).toBe('');
  });

  it('does not replace an editor conflict base while scanning daily tasks in the background', async () => {
    const daily: NoteFile = {
      name: '2026-08-01.md',
      path: 'daily/2026-08-01.md',
      isDaily: true,
      isWeekly: false,
      isLocked: false,
      date: '2026-08-01',
    };
    let readCount = 0;
    invokeMock.mockImplementation(async (command: string) => {
      if (command === 'list_notes') return [daily];
      if (command === 'read_note') {
        readCount += 1;
        return readCount === 1
          ? { content: 'editor base', color: null, contentHash: 'editor-hash' }
          : { content: '- [ ] background task', color: null, contentHash: 'scanner-hash' };
      }
      return undefined;
    });
    await readNoteWithMeta(daily.name, true, false);

    renderHook(() => useNotes());
    await waitFor(() => expect(readCount).toBe(2));

    expect(getLastPersistedMarkdown(daily.name, true, false)).toBe('editor base');
  });

  it('keeps a failed autosave pending and aborts a Forge switch', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const note: Note = {
      id: 'notes/unsaved.md',
      title: 'unsaved',
      content: '<p>saved</p>',
      createdAt: new Date(0),
      updatedAt: new Date(0),
      isDaily: false,
      isWeekly: false,
    };
    useNoteStore.setState({
      notes: [],
      openTabs: [note],
      activeTabId: note.id,
      currentNote: note,
    });
    invokeMock.mockImplementation(async (command: string) => {
      if (command === 'write_note') throw new Error('disk full');
      if (command === 'set_active_forge') return 'New Forge';
      return undefined;
    });
    const hook = renderHook(() => useAutoSave());

    act(() => {
      useNoteStore.getState().updateNoteContent('<p>writing that must survive</p>', note.id);
    });
    await waitFor(() => expect(getPendingAutosaveNoteId()).toBe(note.id));

    let switchError: unknown;
    await act(async () => {
      try {
        await useForgeStore.getState().switchTo('New Forge');
      } catch (error) {
        switchError = error;
      }
    });
    const pendingAfterFailure = getPendingAutosaveNoteId();
    const setActiveCalls = invokeMock.mock.calls.filter(
      ([command]) => command === 'set_active_forge'
    );
    hook.unmount();
    consoleError.mockRestore();

    expect(switchError).toBeInstanceOf(Error);
    expect(pendingAfterFailure).toBe(note.id);
    expect(setActiveCalls).toHaveLength(0);
    expect(useNoteStore.getState().currentNote?.content).toContain('writing that must survive');
  });

  it('cancels a deleted note debounce and closes its tab without recreating the file', async () => {
    const doomedFile: NoteFile = {
      name: 'doomed.md',
      path: 'notes/doomed.md',
      isDaily: false,
      isWeekly: false,
      isLocked: false,
    };
    const doomed: Note = {
      id: doomedFile.path,
      title: 'doomed',
      content: '<p>saved body</p>',
      createdAt: new Date(0),
      updatedAt: new Date(0),
      isDaily: false,
      isWeekly: false,
    };
    const survivor: Note = {
      ...doomed,
      id: 'notes/survivor.md',
      title: 'survivor',
      content: '<p>survivor</p>',
    };
    invokeMock.mockImplementation(async (command: string) => {
      if (command === 'list_notes') return [];
      if (command === 'delete_note') return undefined;
      if (command === 'write_note') {
        return { contentHash: 'recreated-hash', conflictCopy: null };
      }
      return undefined;
    });
    const hook = renderHook(() => {
      const noteActions = useNotes();
      useAutoSave();
      return noteActions;
    });
    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith('list_notes'));

    act(() => {
      useNoteStore.setState({
        notes: [doomedFile],
        openTabs: [doomed, survivor],
        activeTabId: doomed.id,
        currentNote: doomed,
      });
    });
    act(() => {
      useNoteStore.getState().updateNoteContent('<p>unsaved doomed edit</p>', doomed.id);
    });
    await waitFor(() => expect(getPendingAutosaveNoteId()).toBe(doomed.id));

    await act(() => hook.result.current.deleteCurrentNote());
    hook.unmount();

    const commands = invokeMock.mock.calls.map(([command]) => command);
    const state = useNoteStore.getState();
    expect(commands.filter((command) => command === 'delete_note')).toHaveLength(1);
    expect(commands.filter((command) => command === 'write_note')).toHaveLength(0);
    expect(state.openTabs.map((tab) => tab.id)).toEqual([survivor.id]);
    expect(state.activeTabId).toBe(survivor.id);
    expect(state.currentNote?.id).toBe(survivor.id);
  });

  it('readdresses edits made while an active note is moving', async () => {
    const note: Note = {
      id: 'notes/moving.md',
      title: 'moving',
      content: '<p>saved body</p>',
      createdAt: new Date(0),
      updatedAt: new Date(0),
      isDaily: false,
      isWeekly: false,
    };
    invokeMock.mockImplementation(async (command: string) => {
      if (command === 'write_note') {
        return { contentHash: 'moved-write', conflictCopy: null };
      }
      return undefined;
    });
    const hook = renderHook(() => useAutoSave());

    act(() => {
      useNoteStore.setState({
        notes: [],
        openTabs: [note],
        activeTabId: note.id,
        currentNote: note,
      });
    });
    beginAutosavePathChange(note.id);
    act(() => {
      useNoteStore.getState().updateNoteContent('<p>edit during move</p>', note.id);
    });
    await waitFor(() => expect(getPendingAutosaveNoteId()).toBe(note.id));

    const newId = 'notes/Projects/moving.md';
    act(() => useNoteStore.getState().renameNoteReferences(note.id, newId, 'moving'));
    await act(() => commitAutosavePathChange(note.id, newId));
    hook.unmount();

    const writes = invokeMock.mock.calls.filter(([command]) => command === 'write_note');
    expect(writes).toHaveLength(1);
    expect(writes[0][1]).toMatchObject({
      filename: 'Projects/moving.md',
      content: 'edit during move',
    });
    expect(getPendingAutosaveNoteId()).toBeNull();
  });

  it('keeps the moved edit separate when another note is edited during the move', async () => {
    const moving: Note = {
      id: 'notes/moving-and-switching.md',
      title: 'moving-and-switching',
      content: '<p>saved moving body</p>',
      createdAt: new Date(0),
      updatedAt: new Date(0),
      isDaily: false,
      isWeekly: false,
    };
    const other: Note = {
      ...moving,
      id: 'notes/other.md',
      title: 'other',
      content: '<p>saved other body</p>',
    };
    invokeMock.mockImplementation(async (command: string) => {
      if (command === 'write_note') {
        return { contentHash: 'write-hash', conflictCopy: null };
      }
      return undefined;
    });
    const hook = renderHook(() => useAutoSave());

    act(() => {
      useNoteStore.setState({
        notes: [],
        openTabs: [moving, other],
        activeTabId: moving.id,
        currentNote: moving,
      });
    });
    beginAutosavePathChange(moving.id);
    act(() => {
      useNoteStore.getState().updateNoteContent('<p>moving edit</p>', moving.id);
    });
    await waitFor(() => expect(getPendingAutosaveNoteId()).toBe(moving.id));

    act(() => useNoteStore.getState().switchTab(other.id));
    act(() => {
      useNoteStore.getState().updateNoteContent('<p>other edit</p>', other.id);
    });
    const newId = 'notes/Projects/moving-and-switching.md';
    act(() => useNoteStore.getState().renameNoteReferences(moving.id, newId, moving.title));
    await act(() => commitAutosavePathChange(moving.id, newId));

    expect(getPendingAutosaveNoteId()).toBe(other.id);
    await act(() => flushPendingAutosave());
    hook.unmount();

    const writes = invokeMock.mock.calls
      .filter(([command]) => command === 'write_note')
      .map(([, args]) => args as Record<string, unknown>);
    expect(writes).toEqual([
      expect.objectContaining({
        filename: 'Projects/moving-and-switching.md',
        content: 'moving edit',
      }),
      expect.objectContaining({ filename: 'other.md', content: 'other edit' }),
    ]);
  });

  it('keeps a moved edit pending when its first destination save fails', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const moving: Note = {
      id: 'notes/retry-move.md',
      title: 'retry-move',
      content: '<p>saved body</p>',
      createdAt: new Date(0),
      updatedAt: new Date(0),
      isDaily: false,
      isWeekly: false,
    };
    let failWrite = true;
    invokeMock.mockImplementation(async (command: string) => {
      if (command === 'write_note') {
        if (failWrite) throw new Error('disk full');
        return { contentHash: 'retry-hash', conflictCopy: null };
      }
      return undefined;
    });
    const hook = renderHook(() => useAutoSave());

    act(() => {
      useNoteStore.setState({
        openTabs: [moving],
        activeTabId: moving.id,
        currentNote: moving,
      });
    });
    beginAutosavePathChange(moving.id);
    act(() => {
      useNoteStore.getState().updateNoteContent('<p>must retry</p>', moving.id);
    });
    const newId = 'notes/Projects/retry-move.md';
    act(() => useNoteStore.getState().renameNoteReferences(moving.id, newId, moving.title));

    await expect(act(() => commitAutosavePathChange(moving.id, newId))).rejects.toThrow(
      'disk full'
    );
    expect(getPendingAutosaveNoteId()).toBe(newId);

    failWrite = false;
    await act(() => flushPendingAutosave());
    hook.unmount();
    consoleError.mockRestore();

    expect(getPendingAutosaveNoteId()).toBeNull();
    const writes = invokeMock.mock.calls.filter(([command]) => command === 'write_note');
    expect(writes).toHaveLength(2);
    expect(writes[1][1]).toMatchObject({
      filename: 'Projects/retry-move.md',
      content: 'must retry',
    });
  });

  it('discards a held moved edit after the note is explicitly deleted', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const moving: Note = {
      id: 'notes/delete-after-move.md',
      title: 'delete-after-move',
      content: '<p>saved body</p>',
      createdAt: new Date(0),
      updatedAt: new Date(0),
      isDaily: false,
      isWeekly: false,
    };
    invokeMock.mockImplementation(async (command: string) => {
      if (command === 'write_note') throw new Error('disk full');
      return undefined;
    });
    const hook = renderHook(() => useAutoSave());

    act(() => {
      useNoteStore.setState({
        openTabs: [moving],
        activeTabId: moving.id,
        currentNote: moving,
      });
    });
    beginAutosavePathChange(moving.id);
    act(() => {
      useNoteStore.getState().updateNoteContent('<p>delete me</p>', moving.id);
    });
    const newId = 'notes/Projects/delete-after-move.md';
    act(() => useNoteStore.getState().renameNoteReferences(moving.id, newId, moving.title));
    await expect(act(() => commitAutosavePathChange(moving.id, newId))).rejects.toThrow(
      'disk full'
    );

    discardPendingAutosaveForNote(newId, '<p>delete me</p>');
    await act(() => flushPendingAutosave());
    hook.unmount();
    consoleError.mockRestore();

    expect(getPendingAutosaveNoteId()).toBeNull();
    expect(invokeMock.mock.calls.filter(([command]) => command === 'write_note')).toHaveLength(1);
  });

  it('does not trash a note whose moved edit still cannot be saved', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const moving: Note = {
      id: 'notes/trash-after-move.md',
      title: 'trash-after-move',
      content: '<p>saved body</p>',
      createdAt: new Date(0),
      updatedAt: new Date(0),
      isDaily: false,
      isWeekly: false,
    };
    invokeMock.mockImplementation(async (command: string) => {
      if (command === 'write_note') throw new Error('disk full');
      if (command === 'list_notes' || command === 'list_trash') return [];
      return undefined;
    });
    const hook = renderHook(() => {
      useAutoSave();
      return useTrash();
    });

    act(() => {
      useNoteStore.setState({
        openTabs: [moving],
        activeTabId: moving.id,
        currentNote: moving,
      });
    });
    beginAutosavePathChange(moving.id);
    act(() => {
      useNoteStore.getState().updateNoteContent('<p>trash me</p>', moving.id);
    });
    const newId = 'notes/Projects/trash-after-move.md';
    act(() => useNoteStore.getState().renameNoteReferences(moving.id, newId, moving.title));
    await expect(act(() => commitAutosavePathChange(moving.id, newId))).rejects.toThrow(
      'disk full'
    );

    await expect(
      act(() => hook.result.current.trashNote('Projects/trash-after-move.md', false))
    ).rejects.toThrow('Save pending changes before moving a note to trash');
    expect(getPendingAutosaveNoteId()).toBe(newId);
    hook.unmount();
    consoleError.mockRestore();

    expect(useNoteStore.getState().openTabs).toHaveLength(1);
    expect(invokeMock.mock.calls.filter(([command]) => command === 'write_note')).toHaveLength(2);
    expect(invokeMock.mock.calls.some(([command]) => command === 'trash_note')).toBe(false);
  });

  it('keeps the saved tab when trashing the note fails', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const note: Note = {
      id: 'notes/failed-trash.md',
      title: 'failed-trash',
      content: '<p>saved body</p>',
      createdAt: new Date(0),
      updatedAt: new Date(0),
      isDaily: false,
      isWeekly: false,
    };
    invokeMock.mockImplementation(async (command: string) => {
      if (command === 'trash_note') throw new Error('trash unavailable');
      if (command === 'write_note')
        return { contentHash: 'saved-before-trash', conflictCopy: null };
      return undefined;
    });
    const hook = renderHook(() => {
      useAutoSave();
      return useTrash();
    });

    act(() => {
      useNoteStore.setState({
        openTabs: [note],
        activeTabId: note.id,
        currentNote: note,
      });
    });
    act(() => {
      useNoteStore.getState().updateNoteContent('<p>unsaved edit</p>', note.id);
    });
    await waitFor(() => expect(getPendingAutosaveNoteId()).toBe(note.id));

    await expect(
      act(() => hook.result.current.trashNote('failed-trash.md', false))
    ).rejects.toThrow('trash unavailable');
    expect(getPendingAutosaveNoteId()).toBeNull();
    hook.unmount();
    consoleError.mockRestore();

    expect(useNoteStore.getState().openTabs.map((tab) => tab.id)).toEqual([note.id]);
    expect(useNoteStore.getState().currentNote?.content).toBe('<p>unsaved edit</p>');
  });

  it('forgets every path-keyed reference after trash succeeds', async () => {
    const note: Note = {
      id: 'notes/trash-cleanup.md',
      title: 'trash-cleanup',
      content: '<p>saved body</p>',
      createdAt: new Date(0),
      updatedAt: new Date(0),
      isDaily: false,
      isWeekly: false,
    };
    const noteFile: NoteFile = {
      name: 'trash-cleanup.md',
      path: note.id,
      isDaily: false,
      isWeekly: false,
      isLocked: false,
    };
    useNoteStore.setState({
      notes: [noteFile],
      openTabs: [note],
      activeTabId: note.id,
      currentNote: note,
      recentNoteIds: [note.id],
      unlockedNotes: new Set([note.id]),
    });
    useNoteColorsStore.setState({ colors: { [note.id]: 'cosmos' } });
    useNoteSelectionStore.setState({ selectedIds: new Set([note.id]) });
    useQuickSwitcherStore.setState({ pinnedNoteIds: [note.id] });
    useSidebarOrderStore.setState({ noteOrder: [note.id] });
    useWordPressStore.setState({
      postsByNote: { [`7:${note.id}`]: 42 },
      trashedPostsById: {},
    });
    const hook = renderHook(() => {
      useAutoSave();
      return useTrash();
    });

    await act(() => hook.result.current.trashNote('trash-cleanup.md', false));

    expect(useNoteStore.getState()).toMatchObject({
      notes: [],
      openTabs: [],
      activeTabId: null,
      currentNote: null,
      recentNoteIds: [],
    });
    expect(useNoteStore.getState().unlockedNotes.has(note.id)).toBe(false);
    expect(useNoteColorsStore.getState().colors[note.id]).toBeUndefined();
    expect(useNoteSelectionStore.getState().selectedIds.has(note.id)).toBe(false);
    expect(useQuickSwitcherStore.getState().pinnedNoteIds).not.toContain(note.id);
    expect(useSidebarOrderStore.getState().noteOrder).not.toContain(note.id);
    expect(useWordPressStore.getState().postsByNote).toEqual({});
    expect(useWordPressStore.getState().trashedPostsById).toEqual({
      'trash-1': { [`7:${note.id}`]: 42 },
    });
  });

  it('forgets WordPress mappings for expired trash items', async () => {
    invokeMock.mockImplementation(async (command: string) => {
      if (command === 'cleanup_old_trash') return ['expired-trash'];
      if (command === 'list_trash') return [];
      return undefined;
    });
    useWordPressStore.setState({
      trashedPostsById: {
        'expired-trash': { '7:notes/expired.md': 42 },
        'fresh-trash': { '7:notes/fresh.md': 43 },
      },
    });
    const hook = renderHook(() => useTrash());

    await act(() => hook.result.current.cleanupOld());

    expect(useWordPressStore.getState().trashedPostsById).toEqual({
      'fresh-trash': { '7:notes/fresh.md': 43 },
    });
  });
});

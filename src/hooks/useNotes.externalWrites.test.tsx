import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getLastPersistedMarkdown,
  readNoteWithMeta,
} from '@/lib/fileSystem';
import { getPendingAutosaveNoteId } from '@/lib/autosaveFlush';
import { useForgeStore } from '@/stores/forgeStore';
import { useNoteStore } from '@/stores/noteStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { useTemplateStore } from '@/stores/templateStore';
import type { Note, NoteFile } from '@/types';

const invokeMock = vi.fn();

vi.mock('@/lib/ipc', () => ({
  safeInvoke: (...args: unknown[]) => invokeMock(...args),
}));

import { useNotes } from './useNotes';
import { useAutoSave } from './useAutoSave';

beforeEach(() => {
  localStorage.clear();
  invokeMock.mockReset();
  invokeMock.mockImplementation(async (command: string) => {
    if (command === 'list_notes') return [];
    if (command === 'read_note') {
      return { content: '', color: null, contentHash: 'empty-hash' };
    }
    if (command === 'create_note') return 'created.md';
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
    const setActiveCalls = invokeMock.mock.calls.filter(([command]) => command === 'set_active_forge');
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
});

/** Verifies that a rename migrates every store keyed by the note's stable path. */

import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useNoteColorsStore } from '@/stores/noteColorsStore';
import { useNoteSelectionStore } from '@/stores/noteSelectionStore';
import { useNoteStore } from '@/stores/noteStore';
import { useQuickSwitcherStore } from '@/stores/quickSwitcherStore';
import { useToastStore } from '@/stores/toastStore';
import type { Note, NoteFile } from '@/types';

const invokeMock = vi.fn();

vi.mock('@/lib/ipc', () => ({
  safeInvoke: (...args: unknown[]) => invokeMock(...args),
}));

import { useNotes } from './useNotes';

const file: NoteFile = {
  name: 'Old title.md',
  path: 'notes/Old title.md',
  isDaily: false,
  isWeekly: false,
  isLocked: false,
};

const openNote: Note = {
  id: file.path,
  title: 'Old title',
  content: '<p>Unsaved content</p>',
  createdAt: new Date(0),
  updatedAt: new Date(0),
  isDaily: false,
  isWeekly: false,
  isPinned: true,
};

beforeEach(() => {
  localStorage.clear();
  invokeMock.mockReset();
  invokeMock.mockImplementation(async (command: string) => {
    if (command === 'list_notes') return [];
    if (command === 'write_note') {
      return { contentHash: 'renamed-test-hash', conflictCopy: null };
    }
    return undefined;
  });
  useNoteStore.setState({
    notes: [],
    openTabs: [],
    activeTabId: null,
    currentNote: null,
    recentNoteIds: [],
    unlockedNotes: new Set(),
    isLoading: false,
    isSaving: false,
  });
  useNoteColorsStore.setState({ colors: {}, isLoading: false });
  useNoteSelectionStore.setState({ selectedIds: new Set() });
  useQuickSwitcherStore.setState({ pinnedNoteIds: [], recentSearches: [], isOpen: false });
  useToastStore.setState({ toasts: [] });
});

async function renderInitializedHook() {
  const hook = renderHook(() => useNotes());
  await waitFor(() => expect(invokeMock).toHaveBeenCalledWith('list_notes'));
  return hook;
}

describe('useNotes rename', () => {
  it('keeps an open note seamless and migrates every path-keyed state', async () => {
    const hook = await renderInitializedHook();
    useNoteStore.setState({
      notes: [file],
      openTabs: [openNote],
      activeTabId: file.path,
      currentNote: openNote,
      recentNoteIds: [file.path, 'notes/Other.md'],
      unlockedNotes: new Set([file.path]),
    });
    useNoteColorsStore.setState({ colors: { [file.path]: 'purple' } });
    useNoteSelectionStore.setState({ selectedIds: new Set([file.path]) });
    useQuickSwitcherStore.setState({ pinnedNoteIds: [file.path] });

    await act(() => hook.result.current.renameNote(file, 'New title'));

    expect(invokeMock).toHaveBeenCalledWith('rename_note', {
      oldFilename: 'Old title.md',
      newFilename: 'New title.md',
      isDaily: false,
      isWeekly: false,
    });
    const state = useNoteStore.getState();
    expect(state.notes[0]).toMatchObject({ name: 'New title.md', path: 'notes/New title.md' });
    expect(state.openTabs[0]).toMatchObject({ id: 'notes/New title.md', title: 'New title' });
    expect(state.currentNote).toBe(state.openTabs[0]);
    expect(state.activeTabId).toBe('notes/New title.md');
    expect(state.recentNoteIds).toEqual(['notes/New title.md', 'notes/Other.md']);
    expect([...state.unlockedNotes]).toEqual(['notes/New title.md']);
    expect(useNoteColorsStore.getState().colors).toEqual({ 'notes/New title.md': 'purple' });
    expect([...useNoteSelectionStore.getState().selectedIds]).toEqual(['notes/New title.md']);
    expect(useQuickSwitcherStore.getState().pinnedNoteIds).toEqual(['notes/New title.md']);
    expect(useToastStore.getState().toasts[0]).toMatchObject({
      type: 'success',
      message: 'Renamed — inbound links updated',
    });
  });

  it('rejects invalid titles before invoking the backend', async () => {
    const hook = await renderInitializedHook();

    await expect(act(() => hook.result.current.renameNote(file, 'bad/title'))).rejects.toThrow(
      'Title can only contain letters, numbers, spaces, and hyphens'
    );

    expect(invokeMock.mock.calls.some(([command]) => command === 'rename_note')).toBe(false);
    expect(useToastStore.getState().toasts[0]).toMatchObject({ type: 'error' });
  });

  it('surfaces backend errors and leaves state under the old path', async () => {
    const hook = await renderInitializedHook();
    useNoteStore.setState({ notes: [file] });
    invokeMock.mockImplementation(async (command: string) => {
      if (command === 'rename_note') {
        throw new Error('A note with this name already exists');
      }
      if (command === 'list_notes') return [];
      return undefined;
    });

    await expect(act(() => hook.result.current.renameNote(file, 'Duplicate'))).rejects.toThrow(
      'A note with this name already exists'
    );

    expect(useNoteStore.getState().notes).toEqual([file]);
    expect(useToastStore.getState().toasts[0]).toMatchObject({
      type: 'error',
      message: 'A note with this name already exists',
    });
  });
});

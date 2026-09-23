import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useFolders } from './useFolders';
import { useNoteColorsStore } from '@/stores/noteColorsStore';
import { useNoteSelectionStore } from '@/stores/noteSelectionStore';
import { useNoteStore } from '@/stores/noteStore';
import { useQuickSwitcherStore } from '@/stores/quickSwitcherStore';
import { useSidebarOrderStore } from '@/stores/sidebarOrderStore';
import { useToastStore } from '@/stores/toastStore';
import { useWordPressStore } from '@/stores/wordpressStore';
import type { Note, NoteFile } from '@/types';

const fileSystem = vi.hoisted(() => ({
  listFolders: vi.fn(),
  createFolder: vi.fn(),
  renameFolder: vi.fn(),
  deleteFolder: vi.fn(),
  moveNote: vi.fn(),
  moveFolder: vi.fn(),
  listNotes: vi.fn(),
}));
const autosave = vi.hoisted(() => ({
  acquireAutosavePathChange: vi.fn(),
  abortAutosavePathChange: vi.fn(),
  beginAutosavePathChange: vi.fn(),
  commitAutosavePathChange: vi.fn(),
  flushPendingAutosave: vi.fn(),
  getPendingAutosaveNoteId: vi.fn(),
  registerHeldSaves: vi.fn(),
}));

vi.mock('@/lib/fileSystem', () => fileSystem);
vi.mock('@/lib/autosaveFlush', () => autosave);

const oldFile: NoteFile = {
  name: 'Draft.md',
  path: 'notes/Draft.md',
  isDaily: false,
  isWeekly: false,
  isLocked: false,
};
const openNote: Note = {
  id: oldFile.path,
  title: 'Draft',
  content: '<p>Latest body</p>',
  createdAt: new Date(0),
  updatedAt: new Date(0),
  isDaily: false,
  isWeekly: false,
  isPinned: true,
};
const movedFile: NoteFile = {
  ...oldFile,
  name: 'Draft (2).md',
  path: 'notes/Projects/Draft (2).md',
  folderPath: 'Projects',
};

beforeEach(() => {
  window.localStorage.clear();
  vi.clearAllMocks();
  fileSystem.listFolders.mockResolvedValue([]);
  fileSystem.listNotes.mockResolvedValue([movedFile]);
  fileSystem.moveNote.mockResolvedValue(movedFile.path);
  autosave.flushPendingAutosave.mockResolvedValue(undefined);
  autosave.acquireAutosavePathChange.mockResolvedValue(vi.fn());
  autosave.getPendingAutosaveNoteId.mockReturnValue(null);
  autosave.abortAutosavePathChange.mockResolvedValue(undefined);
  autosave.commitAutosavePathChange.mockResolvedValue(undefined);
  useNoteStore.setState({
    notes: [oldFile],
    openTabs: [openNote],
    activeTabId: oldFile.path,
    currentNote: openNote,
    recentNoteIds: [oldFile.path],
    unlockedNotes: new Set(),
    externallyChanged: new Map(),
    isLoading: false,
    isSaving: false,
  });
  useNoteColorsStore.setState({ colors: { [oldFile.path]: 'cosmos' }, isLoading: false });
  useNoteSelectionStore.setState({ selectedIds: new Set([oldFile.path]) });
  useQuickSwitcherStore.setState({ pinnedNoteIds: [oldFile.path] });
  useSidebarOrderStore.setState({ noteOrder: [oldFile.path], folderOrder: [] });
  useWordPressStore.setState({ postsByNote: { [`42:${oldFile.path}`]: 99 } });
  useToastStore.setState({ toasts: [] });
});

describe('useFolders note moves', () => {
  it('settles autosave and migrates every path-keyed reference to the returned path', async () => {
    const { result } = renderHook(() => useFolders());

    await act(() => result.current.moveNoteToFolder('Draft.md', 'Projects'));

    expect(autosave.flushPendingAutosave).toHaveBeenCalledOnce();
    expect(fileSystem.moveNote).toHaveBeenCalledWith('Draft.md', 'Projects');
    expect(autosave.beginAutosavePathChange).toHaveBeenCalledWith(oldFile.path);
    expect(autosave.commitAutosavePathChange).toHaveBeenCalledWith(oldFile.path, movedFile.path);
    expect(autosave.flushPendingAutosave.mock.invocationCallOrder[0]).toBeLessThan(
      fileSystem.moveNote.mock.invocationCallOrder[0]
    );

    const state = useNoteStore.getState();
    expect(state.notes).toEqual([movedFile]);
    expect(state.openTabs[0]).toMatchObject({ id: movedFile.path, title: 'Draft (2)' });
    expect(state.currentNote).toBe(state.openTabs[0]);
    expect(state.activeTabId).toBe(movedFile.path);
    expect(state.recentNoteIds).toEqual([movedFile.path]);
    expect(useNoteColorsStore.getState().colors).toEqual({ [movedFile.path]: 'cosmos' });
    expect([...useNoteSelectionStore.getState().selectedIds]).toEqual([movedFile.path]);
    expect(useQuickSwitcherStore.getState().pinnedNoteIds).toEqual([movedFile.path]);
    expect(useSidebarOrderStore.getState().noteOrder).toEqual([movedFile.path]);
    expect(useWordPressStore.getState().postsByNote).toEqual({ [`42:${movedFile.path}`]: 99 });
    const toasts = useToastStore.getState().toasts;
    expect(toasts[toasts.length - 1]).toMatchObject({
      type: 'success',
      message: 'Note moved',
    });
  });

  it('does not move a note whose pending autosave failed to settle', async () => {
    autosave.getPendingAutosaveNoteId.mockReturnValue(oldFile.path);
    const { result } = renderHook(() => useFolders());

    await expect(
      act(() => result.current.moveNoteToFolder('notes/Draft.md', 'Projects'))
    ).rejects.toThrow('Save pending changes before moving a note');

    expect(fileSystem.moveNote).not.toHaveBeenCalled();
    expect(useNoteStore.getState().currentNote?.id).toBe(oldFile.path);
    const toasts = useToastStore.getState().toasts;
    expect(toasts[toasts.length - 1]).toMatchObject({ type: 'error' });
  });

  it('resumes the old autosave address when the disk move fails', async () => {
    fileSystem.moveNote.mockRejectedValue(new Error('move failed'));
    const { result } = renderHook(() => useFolders());

    await expect(
      act(() => result.current.moveNoteToFolder('Draft.md', 'Projects'))
    ).rejects.toThrow('move failed');

    expect(autosave.abortAutosavePathChange).toHaveBeenCalledWith(oldFile.path);
    expect(autosave.commitAutosavePathChange).not.toHaveBeenCalled();
    expect(useNoteStore.getState().currentNote?.id).toBe(oldFile.path);
  });

  it('keeps a committed move successful when the list refresh fails', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    fileSystem.listNotes.mockRejectedValue(new Error('refresh failed'));
    const { result } = renderHook(() => useFolders());

    await expect(act(() => result.current.moveNoteToFolder('Draft.md', 'Projects'))).resolves.toBe(
      movedFile.path
    );

    expect(useNoteStore.getState().currentNote?.id).toBe(movedFile.path);
    const toasts = useToastStore.getState().toasts;
    expect(toasts[toasts.length - 1]).toMatchObject({ type: 'success', message: 'Note moved' });
    consoleError.mockRestore();
  });
});

describe('useFolders folder renames', () => {
  const inside: Note = {
    ...openNote,
    id: 'notes/Projects/Plan.md',
    title: 'Plan',
    isPinned: false,
  };

  beforeEach(() => {
    fileSystem.renameFolder.mockResolvedValue('Archive');
    fileSystem.listNotes.mockResolvedValue([]);
    useNoteStore.setState({
      openTabs: [openNote, inside],
      activeTabId: inside.id,
      currentNote: inside,
      savedContent: new Map([
        [openNote.id, openNote.content],
        [inside.id, inside.content],
      ]),
    });
  });

  it('points open tabs inside a renamed folder at their new path', async () => {
    const { result } = renderHook(() => useFolders());

    await act(() => result.current.renameExistingFolder('Projects', 'Archive'));

    const state = useNoteStore.getState();
    expect(state.openTabs.map((tab) => tab.id)).toEqual([openNote.id, 'notes/Archive/Plan.md']);
    expect(state.currentNote?.id).toBe('notes/Archive/Plan.md');
    expect(state.savedContent.get('notes/Archive/Plan.md')).toBe(inside.content);
    expect(autosave.beginAutosavePathChange).toHaveBeenCalledWith(inside.id);
    expect(autosave.commitAutosavePathChange).toHaveBeenCalledWith(
      inside.id,
      'notes/Archive/Plan.md'
    );
  });

  it('refuses to rename a folder holding a note with unsaved edits', async () => {
    useNoteStore.setState({ savedContent: new Map([[openNote.id, openNote.content]]) });
    const { result } = renderHook(() => useFolders());

    await expect(
      act(() => result.current.renameExistingFolder('Projects', 'Archive'))
    ).rejects.toThrow('Save pending changes');

    expect(fileSystem.renameFolder).not.toHaveBeenCalled();
    expect(useNoteStore.getState().currentNote?.id).toBe(inside.id);
  });
});

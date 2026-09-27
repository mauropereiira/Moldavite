import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useTrash } from './useTrash';
import { useFolderStore } from '@/stores/folderStore';
import { useNoteColorsStore } from '@/stores/noteColorsStore';
import { useNoteSelectionStore } from '@/stores/noteSelectionStore';
import { useNoteStore } from '@/stores/noteStore';
import { useQuickSwitcherStore } from '@/stores/quickSwitcherStore';
import { useSidebarOrderStore } from '@/stores/sidebarOrderStore';
import { useTrashStore } from '@/stores/trashStore';
import type { FolderInfo, NoteFile, TrashedNote } from '@/types';

const fileSystem = vi.hoisted(() => ({
  trashNote: vi.fn(),
  trashFolder: vi.fn(),
  listTrash: vi.fn(),
  restoreNote: vi.fn(),
  restoreNoteFromFolder: vi.fn(),
  permanentlyDeleteTrash: vi.fn(),
  emptyTrash: vi.fn(),
  cleanupOldTrash: vi.fn(),
  listNotes: vi.fn(),
  listFolders: vi.fn(),
  getAllNoteColors: vi.fn(),
  registerCloudPlaceholderProbe: vi.fn(),
}));
const autosave = vi.hoisted(() => ({
  acquireAutosavePathChange: vi.fn(),
  abortAutosavePathChange: vi.fn(),
  beginAutosavePathChange: vi.fn(),
  flushPendingAutosave: vi.fn(),
  getPendingAutosaveNoteId: vi.fn(),
  registerHeldSaves: vi.fn(),
}));

vi.mock('@/lib/fileSystem', () => fileSystem);
vi.mock('@/lib/autosaveFlush', () => autosave);
vi.mock('./useAutoSave', () => ({ discardPendingAutosaveForNote: vi.fn() }));
vi.mock('@/lib', () => ({ getAllNoteColors: fileSystem.getAllNoteColors, setNoteColor: vi.fn() }));

const restoredFolder: FolderInfo = { name: 'Projects', path: 'Projects', children: [] };
const restoredNote: NoteFile = {
  name: 'Plan.md',
  path: 'notes/Projects/Plan.md',
  folderPath: 'Projects',
  isDaily: false,
  isWeekly: false,
  isLocked: false,
};

beforeEach(() => {
  vi.clearAllMocks();
  autosave.acquireAutosavePathChange.mockResolvedValue(vi.fn());
  autosave.flushPendingAutosave.mockResolvedValue(undefined);
  autosave.getPendingAutosaveNoteId.mockReturnValue(null);
  fileSystem.listTrash.mockResolvedValue([]);
  fileSystem.getAllNoteColors.mockResolvedValue({});
  useNoteStore.setState({ notes: [], openTabs: [], activeTabId: null, currentNote: null });
  useFolderStore.setState({ folders: [] });
});

describe('restoring from the trash', () => {
  it('shows a restored folder in the folder tree', async () => {
    fileSystem.restoreNote.mockResolvedValue('Projects');
    fileSystem.listNotes.mockResolvedValue([restoredNote]);
    fileSystem.listFolders.mockResolvedValue([restoredFolder]);
    const { result } = renderHook(() => useTrash());

    await act(() => result.current.restoreNote('trash-1'));

    expect(useFolderStore.getState().folders).toEqual([restoredFolder]);
  });
});

describe('trashing a folder', () => {
  it('forgets the references of notes inside it that are not open', async () => {
    const idle = 'notes/Projects/Plan.md';
    const outside = 'notes/Other.md';
    fileSystem.trashFolder.mockResolvedValue('trash-1');
    fileSystem.listNotes.mockResolvedValue([]);
    fileSystem.listFolders.mockResolvedValue([]);
    useNoteStore.setState({ notes: [restoredNote], recentNoteIds: [idle, outside] });
    useNoteColorsStore.setState({ colors: { [idle]: 'cosmos', [outside]: 'ember' } });
    useNoteSelectionStore.setState({ selectedIds: new Set([idle]) });
    useQuickSwitcherStore.setState({ pinnedNoteIds: [idle, outside] });
    useSidebarOrderStore.setState({ noteOrder: [idle, outside] });
    const { result } = renderHook(() => useTrash());

    await act(() => result.current.trashFolder('Projects'));

    expect(useNoteStore.getState().recentNoteIds).toEqual([outside]);
    expect(useNoteColorsStore.getState().colors).toEqual({ [outside]: 'ember' });
    expect(useNoteSelectionStore.getState().selectedIds.size).toBe(0);
    expect(useQuickSwitcherStore.getState().pinnedNoteIds).toEqual([outside]);
    expect(useSidebarOrderStore.getState().noteOrder).toEqual([outside]);
  });
});

describe('emptying the trash', () => {
  it('shows what is left when some items could not be removed', async () => {
    const trashed = (id: string): TrashedNote => ({
      id,
      filename: `${id}.md`,
      originalPath: `notes/${id}.md`,
      isDaily: false,
      isWeekly: false,
      isFolder: false,
      containedFiles: [],
      trashedAt: 0,
      daysRemaining: 7,
    });
    const kept = trashed('2');
    useTrashStore.setState({ trashedNotes: [trashed('1'), kept] });
    fileSystem.emptyTrash.mockRejectedValue('1 item could not be removed from the Trash');
    fileSystem.listTrash.mockResolvedValue([kept]);
    const { result } = renderHook(() => useTrash());

    await act(() => result.current.emptyTrash().catch(() => {}));

    expect(useTrashStore.getState().trashedNotes).toEqual([kept]);
  });
});

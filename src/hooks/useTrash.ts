/**
 * Component-facing trash, restore, permanent-delete, and cleanup workflows.
 * Backend trash metadata is authoritative; successful operations refresh every
 * affected notes/folders/trash store before reporting completion.
 */

import { useCallback } from 'react';
import {
  useNoteColorsStore,
  useNoteSelectionStore,
  useNoteStore,
  useQuickSwitcherStore,
  useSidebarOrderStore,
  useTrashStore,
} from '@/stores';
import {
  trashNote as trashNoteApi,
  trashFolder as trashFolderApi,
  listTrash,
  restoreNote as restoreNoteApi,
  restoreNoteFromFolder as restoreNoteFromFolderApi,
  permanentlyDeleteTrash,
  emptyTrash as emptyTrashApi,
  cleanupOldTrash,
  listNotes,
  listFolders,
} from '@/lib/fileSystem';
import { useFolderStore } from '@/stores/folderStore';
import { useToast } from './useToast';
import { discardPendingAutosaveForNote } from './useAutoSave';
import {
  acquireAutosavePathChange,
  flushPendingAutosave,
  getPendingAutosaveNoteId,
} from '@/lib/autosaveFlush';
import { useWordPressStore } from '@/stores/wordpressStore';
import type { Note, NoteFile } from '@/types';

function forgetTrashedNoteReferences(noteId: string): void {
  useNoteStore.getState().forgetNoteReferences(noteId);
  useNoteColorsStore.setState((state) => {
    if (!(noteId in state.colors)) return state;
    const { [noteId]: _removed, ...colors } = state.colors;
    return { colors };
  });
  useNoteSelectionStore
    .getState()
    .replace([...useNoteSelectionStore.getState().selectedIds].filter((id) => id !== noteId));
  if (useQuickSwitcherStore.getState().pinnedNoteIds.includes(noteId)) {
    useQuickSwitcherStore.getState().togglePinned(noteId);
  }
  useSidebarOrderStore.setState((state) => ({
    noteOrder: state.noteOrder.filter((id) => id !== noteId),
  }));
}

export function useTrash() {
  const { trashedNotes, setTrashedNotes, setLoading, removeFromTrash } = useTrashStore();
  const { setNotes } = useNoteStore();
  const { setFolders } = useFolderStore();
  const toast = useToast();

  /**
   * Loads the trash list from the backend.
   */
  const loadTrash = useCallback(async () => {
    try {
      setLoading(true);
      const items = await listTrash();
      if (!Array.isArray(items)) {
        throw new Error('Invalid response from list_trash');
      }
      setTrashedNotes(items);
    } catch (error) {
      console.error('Failed to load trash:', error);
    } finally {
      setLoading(false);
    }
  }, [setTrashedNotes, setLoading]);

  /**
   * Moves a note to the trash.
   * @param filename - The note filename (relative path)
   * @param isDaily - Whether this is a daily note
   * @param isWeekly - Whether this is a weekly note
   */
  const trashNote = useCallback(
    async (filename: string, isDaily: boolean, isWeekly: boolean = false) => {
      const noteId = isDaily
        ? `daily/${filename}`
        : isWeekly
          ? `weekly/${filename}`
          : `notes/${filename}`;
      let trashed = false;
      let closedTab:
        | {
            note: Note;
            index: number;
            activate: boolean;
            hadExternalChange: boolean;
            externalClient: string | null;
          }
        | undefined;
      let removedNoteFile: { note: NoteFile; index: number } | undefined;
      const releasePathChange = await acquireAutosavePathChange();

      try {
        await flushPendingAutosave();
        if (getPendingAutosaveNoteId() !== null) {
          throw new Error('Save pending changes before moving a note to trash');
        }
        const noteState = useNoteStore.getState();
        const noteFileIndex = noteState.notes.findIndex((note) => note.path === noteId);
        if (noteFileIndex >= 0) {
          removedNoteFile = { note: noteState.notes[noteFileIndex], index: noteFileIndex };
          useNoteStore.setState((state) => ({
            notes: state.notes.filter((note) => note.path !== noteId),
          }));
        }
        const tabIndex = noteState.openTabs.findIndex((note) => note.id === noteId);
        const openNote = tabIndex >= 0 ? noteState.openTabs[tabIndex] : undefined;
        if (openNote) {
          closedTab = {
            note: openNote,
            index: tabIndex,
            activate: noteState.activeTabId === noteId,
            hadExternalChange: noteState.externallyChanged.has(noteId),
            externalClient: noteState.externallyChanged.get(noteId) ?? null,
          };
          noteState.removeTabByPath(noteId);
        }
        const trashId = await trashNoteApi(filename, isDaily, isWeekly);
        trashed = true;
        discardPendingAutosaveForNote(noteId, closedTab?.note.content ?? '');
        useWordPressStore.getState().noteTrashed(noteId, trashId);
        forgetTrashedNoteReferences(noteId);
        // Refresh notes list
        const notes = await listNotes();
        setNotes(notes);
        // Refresh trash list
        await loadTrash();
        toast.success('Note moved to trash');
      } catch (error) {
        if (!trashed && closedTab) {
          useNoteStore.getState().restoreTabAt(closedTab.note, closedTab.index, closedTab.activate);
          if (closedTab.hadExternalChange) {
            useNoteStore
              .getState()
              .markExternallyChanged(noteId, closedTab.externalClient ?? undefined);
          }
        }
        if (!trashed && removedNoteFile) {
          const noteFileToRestore = removedNoteFile;
          useNoteStore.setState((state) => {
            if (state.notes.some((note) => note.path === noteId)) return state;
            const notes = [...state.notes];
            notes.splice(
              Math.min(Math.max(noteFileToRestore.index, 0), notes.length),
              0,
              noteFileToRestore.note
            );
            return { notes };
          });
        }
        toast.error(String(error));
        throw error;
      } finally {
        releasePathChange();
      }
    },
    [setNotes, loadTrash, toast]
  );

  /**
   * Restores a note from the trash.
   * @param trashId - The unique ID of the trashed note
   */
  const restoreNote = useCallback(
    async (trashId: string) => {
      try {
        const restoredPath = await restoreNoteApi(trashId);
        useWordPressStore.getState().noteRestored(trashId, restoredPath);
        removeFromTrash(trashId);
        await useNoteColorsStore.getState().loadColors();
        // Refresh notes list
        const notes = await listNotes();
        setNotes(notes);
        toast.success('Note restored');
      } catch (error) {
        toast.error(String(error));
        throw error;
      }
    },
    [setNotes, removeFromTrash, toast]
  );

  /**
   * Permanently deletes a note from the trash.
   * @param trashId - The unique ID of the trashed note
   */
  const permanentlyDelete = useCallback(
    async (trashId: string) => {
      try {
        await permanentlyDeleteTrash(trashId);
        useWordPressStore.getState().forgetTrashedNote(trashId);
        removeFromTrash(trashId);
        toast.success('Note permanently deleted');
      } catch (error) {
        toast.error(String(error));
        throw error;
      }
    },
    [removeFromTrash, toast]
  );

  /**
   * Empties the entire trash.
   */
  const emptyTrash = useCallback(async () => {
    try {
      await emptyTrashApi();
      useWordPressStore.getState().forgetAllTrashedNotes();
      setTrashedNotes([]);
      toast.success('Trash emptied');
    } catch (error) {
      toast.error(String(error));
      throw error;
    }
  }, [setTrashedNotes, toast]);

  /**
   * Cleans up old trash items (older than 7 days).
   * Should be called on app startup.
   */
  const cleanupOld = useCallback(async () => {
    try {
      const deletedIds = await cleanupOldTrash();
      if (deletedIds.length > 0) {
        for (const trashId of deletedIds) {
          useWordPressStore.getState().forgetTrashedNote(trashId);
        }
        await loadTrash();
      }
    } catch (error) {
      console.error('Failed to cleanup old trash:', error);
    }
  }, [loadTrash]);

  /**
   * Moves a folder (and all its contents) to the trash.
   * @param path - The folder path to trash
   */
  const trashFolder = useCallback(
    async (path: string) => {
      try {
        await trashFolderApi(path);
        // Refresh notes list
        const notes = await listNotes();
        setNotes(notes);
        // Refresh folders list
        const folders = await listFolders();
        setFolders(folders);
        // Refresh trash list
        await loadTrash();
        toast.success('Folder moved to trash');
      } catch (error) {
        toast.error(String(error));
        throw error;
      }
    },
    [setNotes, setFolders, loadTrash, toast]
  );

  /**
   * Restores a single note from a trashed folder to the root notes directory.
   * @param trashId - The unique ID of the trashed folder
   * @param noteFilename - The filename of the note within the folder
   */
  const restoreNoteFromFolder = useCallback(
    async (trashId: string, noteFilename: string) => {
      try {
        await restoreNoteFromFolderApi(trashId, noteFilename);
        await useNoteColorsStore.getState().loadColors();
        // Refresh trash list
        await loadTrash();
        // Refresh notes list
        const notes = await listNotes();
        setNotes(notes);
        toast.success('Note restored');
      } catch (error) {
        toast.error(String(error));
        throw error;
      }
    },
    [setNotes, loadTrash, toast]
  );

  return {
    // State
    trashedNotes,

    // Actions
    loadTrash,
    trashNote,
    trashFolder,
    restoreNote,
    restoreNoteFromFolder,
    permanentlyDelete,
    emptyTrash,
    cleanupOld,
  };
}

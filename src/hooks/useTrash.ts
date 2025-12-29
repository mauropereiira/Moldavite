import { useCallback } from 'react';
import { useTrashStore, useNoteStore } from '@/stores';
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
   */
  const trashNote = useCallback(
    async (filename: string, isDaily: boolean) => {
      try {
        await trashNoteApi(filename, isDaily);
        // Refresh notes list
        const notes = await listNotes();
        setNotes(notes);
        // Refresh trash list
        await loadTrash();
        toast.success('Note moved to trash');
      } catch (error) {
        toast.error(String(error));
        throw error;
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
        await restoreNoteApi(trashId);
        removeFromTrash(trashId);
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
      const deletedCount = await cleanupOldTrash();
      if (deletedCount > 0) {
        console.log(`[useTrash] Cleaned up ${deletedCount} old trash items`);
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

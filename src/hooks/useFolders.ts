import { useCallback } from 'react';
import { useFolderStore, useNoteStore } from '@/stores';
import {
  listFolders,
  createFolder as createFolderApi,
  renameFolder as renameFolderApi,
  deleteFolder as deleteFolderApi,
  moveNote as moveNoteApi,
  moveFolder as moveFolderApi,
  listNotes,
} from '@/lib/fileSystem';
import { useToast } from './useToast';

export function useFolders() {
  const {
    folders,
    setFolders,
    expandedFolders,
    toggleFolder,
    expandFolder,
    collapseFolder,
    sectionsCollapsed,
    toggleSection,
  } = useFolderStore();

  const { setNotes } = useNoteStore();
  const toast = useToast();

  /**
   * Initializes the folder list from the backend.
   */
  const initialize = useCallback(async () => {
    try {
      const folderList = await listFolders();
      setFolders(folderList);
    } catch (error) {
      console.error('Failed to load folders:', error);
    }
  }, [setFolders]);

  /**
   * Creates a new folder.
   * @param path - The folder path to create
   */
  const createNewFolder = useCallback(
    async (path: string) => {
      try {
        await createFolderApi(path);
        await initialize();
        toast.success('Folder created');
      } catch (error) {
        toast.error(String(error));
        throw error;
      }
    },
    [initialize, toast]
  );

  /**
   * Renames an existing folder.
   * @param path - Current folder path
   * @param newName - New folder name
   * @returns The new folder path
   */
  const renameExistingFolder = useCallback(
    async (path: string, newName: string) => {
      try {
        const newPath = await renameFolderApi(path, newName);
        await initialize();
        // Also refresh notes to update their folder paths
        const notes = await listNotes();
        setNotes(notes);
        toast.success('Folder renamed');
        return newPath;
      } catch (error) {
        toast.error(String(error));
        throw error;
      }
    },
    [initialize, setNotes, toast]
  );

  /**
   * Deletes a folder.
   * @param path - Folder path to delete
   * @param force - If true, delete even if not empty
   */
  const deleteExistingFolder = useCallback(
    async (path: string, force?: boolean) => {
      try {
        await deleteFolderApi(path, force);
        await initialize();
        // Refresh notes in case any were deleted
        if (force) {
          const notes = await listNotes();
          setNotes(notes);
        }
        toast.success('Folder deleted');
      } catch (error) {
        toast.error(String(error));
        throw error;
      }
    },
    [initialize, setNotes, toast]
  );

  /**
   * Moves a note to a different folder.
   * @param notePath - Current note path (relative within notes/)
   * @param toFolder - Destination folder path, or undefined for root
   * @returns The new note path
   */
  const moveNoteToFolder = useCallback(
    async (notePath: string, toFolder?: string) => {
      try {
        const newPath = await moveNoteApi(notePath, toFolder);
        // Refresh notes to reflect new paths
        const notes = await listNotes();
        setNotes(notes);
        toast.success('Note moved');
        return newPath;
      } catch (error) {
        toast.error(String(error));
        throw error;
      }
    },
    [setNotes, toast]
  );

  /**
   * Moves a folder (and all its contents) to a different folder or to root.
   * @param folderPath - Current folder path
   * @param toFolder - Destination parent folder path, or undefined for root
   * @returns The new folder path
   */
  const moveFolderToFolder = useCallback(
    async (folderPath: string, toFolder?: string) => {
      try {
        const newPath = await moveFolderApi(folderPath, toFolder);
        // Refresh both folders and notes to reflect new paths
        await initialize();
        const notes = await listNotes();
        setNotes(notes);
        toast.success('Folder moved');
        return newPath;
      } catch (error) {
        toast.error(String(error));
        throw error;
      }
    },
    [initialize, setNotes, toast]
  );

  /**
   * Checks if a folder is currently expanded.
   * @param path - Folder path to check
   */
  const isFolderExpanded = useCallback(
    (path: string) => expandedFolders.includes(path),
    [expandedFolders]
  );

  return {
    // State
    folders,
    expandedFolders,
    sectionsCollapsed,

    // Actions
    initialize,
    createNewFolder,
    renameExistingFolder,
    deleteExistingFolder,
    moveNoteToFolder,
    moveFolderToFolder,

    // UI state actions
    toggleFolder,
    expandFolder,
    collapseFolder,
    toggleSection,
    isFolderExpanded,
  };
}

/**
 * Component-facing orchestration for standalone-note folders.
 * Backend mutations remain authoritative; each successful structural change
 * refreshes folder state and, where paths changed, note metadata as one workflow.
 */

import { useCallback } from 'react';
import {
  useFolderStore,
  useNoteColorsStore,
  useNoteSelectionStore,
  useNoteStore,
  useQuickSwitcherStore,
  useSidebarOrderStore,
} from '@/stores';
import {
  listFolders,
  createFolder as createFolderApi,
  renameFolder as renameFolderApi,
  deleteFolder as deleteFolderApi,
  moveNote as moveNoteApi,
  moveFolder as moveFolderApi,
  listNotes,
} from '@/lib/fileSystem';
import {
  acquireAutosavePathChange,
  abortAutosavePathChange,
  beginAutosavePathChange,
  commitAutosavePathChange,
  flushPendingAutosave,
  getPendingAutosaveNoteId,
} from '@/lib/autosaveFlush';
import { hasUnsavedEdits } from '@/lib/leaveSave';
import { useWordPressStore } from '@/stores/wordpressStore';
import { useToast } from './useToast';

/**
 * Renames or moves a folder while the open tabs inside it keep pointing at their
 * files. Owed edits are saved first; one typed during the move is held and written
 * to the new address.
 */
async function changeFolderPath(
  folderPath: string,
  change: () => Promise<string>
): Promise<string> {
  const releasePathChange = await acquireAutosavePathChange();
  const prefix = `notes/${folderPath}/`;
  let heldAutosavePath: string | null = null;
  try {
    await flushPendingAutosave();
    const hasEditsInside = useNoteStore
      .getState()
      .openTabs.some((tab) => tab.id.startsWith(prefix) && hasUnsavedEdits(tab.id));
    if (getPendingAutosaveNoteId() !== null || hasEditsInside) {
      throw new Error('Save pending changes before renaming or moving a folder');
    }
    const currentId = useNoteStore.getState().currentNote?.id;
    if (currentId?.startsWith(prefix)) {
      beginAutosavePathChange(currentId);
      heldAutosavePath = currentId;
    }

    const newFolderPath = await change();
    const newPrefix = `notes/${newFolderPath}/`;
    if (newPrefix !== prefix) {
      for (const tab of useNoteStore.getState().openTabs) {
        if (!tab.id.startsWith(prefix)) continue;
        const newId = newPrefix + tab.id.slice(prefix.length);
        useNoteStore.getState().renameNoteReferences(tab.id, newId, tab.title);
      }
    }
    if (heldAutosavePath) {
      const committingPath = heldAutosavePath;
      heldAutosavePath = null;
      await commitAutosavePathChange(
        committingPath,
        newPrefix + committingPath.slice(prefix.length)
      ).catch((error) => {
        console.error('[useFolders] Failed to save an edit made during a folder move:', error);
      });
    }
    return newFolderPath;
  } catch (error) {
    if (heldAutosavePath) {
      await abortAutosavePathChange(heldAutosavePath).catch(() => {});
    }
    throw error;
  } finally {
    releasePathChange();
  }
}

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
      if (!Array.isArray(folderList)) {
        throw new Error('Invalid response from list_folders');
      }
      setFolders(folderList);
    } catch (error) {
      console.error('Failed to load folders:', error);
    }
  }, [setFolders]);

  /**
   * Creates a new folder.
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
        const newPath = await changeFolderPath(path, () => renameFolderApi(path, newName));
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
      let heldAutosavePath: string | null = null;
      const releasePathChange = await acquireAutosavePathChange();
      try {
        const oldPath = notePath.startsWith('notes/') ? notePath : `notes/${notePath}`;
        const backendPath = oldPath.slice('notes/'.length);

        await flushPendingAutosave();
        if (getPendingAutosaveNoteId() !== null) {
          throw new Error('Save pending changes before moving a note');
        }
        if (useNoteStore.getState().currentNote?.id === oldPath) {
          beginAutosavePathChange(oldPath);
          heldAutosavePath = oldPath;
        }

        const newPath = await moveNoteApi(backendPath, toFolder);
        if (newPath !== oldPath) {
          const newName = newPath.split('/').pop() || newPath;
          const newTitle = newName.replace(/\.md$/, '');
          useNoteStore.getState().renameNoteReferences(oldPath, newPath, newTitle);
        }
        if (heldAutosavePath) {
          const committingPath = heldAutosavePath;
          heldAutosavePath = null;
          await commitAutosavePathChange(committingPath, newPath).catch((error) => {
            console.error('[useFolders] Failed to save an edit made during move:', error);
          });
        }
        if (newPath !== oldPath) {
          try {
            useNoteColorsStore.getState().renameColor(oldPath, newPath);
            useNoteSelectionStore.getState().rename(oldPath, newPath);
            useQuickSwitcherStore.getState().renamePinnedNote(oldPath, newPath);
            useSidebarOrderStore.getState().renameNote(oldPath, newPath);
            useWordPressStore.getState().notePathChanged(oldPath, newPath);
          } catch (error) {
            console.error('[useFolders] Failed to migrate secondary note references:', error);
          }
        }
        // The move is already committed and renameNoteReferences carries enough
        // metadata to keep the sidebar coherent if this best-effort refresh fails.
        try {
          setNotes(await listNotes());
        } catch (error) {
          console.error('[useFolders] Failed to refresh notes after move:', error);
        }
        toast.success('Note moved');
        return newPath;
      } catch (error) {
        if (heldAutosavePath) {
          await abortAutosavePathChange(heldAutosavePath).catch(() => {});
        }
        toast.error(String(error));
        throw error;
      } finally {
        releasePathChange();
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
        // Frontend guard: refuse to move a folder into itself or any of
        // its own descendants. Backend also rejects this, but bailing
        // early avoids a round-trip + misleading error toast.
        if (toFolder !== undefined) {
          if (toFolder === folderPath || toFolder.startsWith(`${folderPath}/`)) {
            toast.error('Cannot move a folder into itself');
            throw new Error('self-descendant move rejected');
          }
        }
        const newPath = await changeFolderPath(folderPath, () =>
          moveFolderApi(folderPath, toFolder)
        );
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
   */
  const isFolderExpanded = useCallback(
    (path: string) => expandedFolders.includes(path),
    [expandedFolders]
  );

  return {
    folders,
    expandedFolders,
    sectionsCollapsed,

    initialize,
    createNewFolder,
    renameExistingFolder,
    deleteExistingFolder,
    moveNoteToFolder,
    moveFolderToFolder,

    toggleFolder,
    expandFolder,
    collapseFolder,
    toggleSection,
    isFolderExpanded,
  };
}

/**
 * Root drop-zone state for moving notes and folders out of nested folders.
 * MIME types keep note and folder zones disjoint; nested drag-enter counters avoid
 * clearing highlights until the pointer leaves the entire zone.
 */

import { useRef, useState } from 'react';
import { canDropDraggedNoteIntoRoot } from '@/components/sidebar/DraggableNoteItem';
import { canDropDraggedFolderIntoRoot } from '@/components/sidebar/FolderItem';

type MoveNote = (notePath: string, toFolder?: string) => Promise<unknown>;
type MoveFolder = (folderPath: string, toFolder?: string) => Promise<unknown>;

/**
 * Owns the two root-level drop zones in the sidebar:
 * - Notes section: accepts notes dragged out of folders (moves to root).
 * - Folders section: accepts folders dragged out of parents (moves to root).
 *
 * Each zone ignores payloads that target the other — e.g. the Notes
 * section won't highlight when a folder is dragged over it.
 */
export function useSidebarDnd({
  moveNoteToFolder,
  moveFolderToFolder,
}: {
  moveNoteToFolder: MoveNote;
  moveFolderToFolder: MoveFolder;
}) {
  const [isDragOverRoot, setIsDragOverRoot] = useState(false);
  const rootDragCounterRef = useRef(0);

  const [isDragOverFoldersRoot, setIsDragOverFoldersRoot] = useState(false);
  const foldersRootDragCounterRef = useRef(0);

  // Notes section — accepts notes only.
  const onRootDragEnter = (e: React.DragEvent) => {
    const hasNoteData = e.dataTransfer.types.includes('application/x-note-path');
    const hasFolderData = e.dataTransfer.types.includes('application/x-folder-path');
    if (hasNoteData && !hasFolderData && canDropDraggedNoteIntoRoot()) {
      e.preventDefault();
      rootDragCounterRef.current++;
      setIsDragOverRoot(true);
    }
  };

  const onRootDragOver = (e: React.DragEvent) => {
    const hasNoteData = e.dataTransfer.types.includes('application/x-note-path');
    const hasFolderData = e.dataTransfer.types.includes('application/x-folder-path');
    if (hasNoteData && !hasFolderData && canDropDraggedNoteIntoRoot()) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
    }
  };

  const onRootDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    rootDragCounterRef.current = Math.max(0, rootDragCounterRef.current - 1);
    if (rootDragCounterRef.current === 0) {
      setIsDragOverRoot(false);
    }
  };

  const onRootDrop = async (e: React.DragEvent) => {
    const hasNoteData = e.dataTransfer.types.includes('application/x-note-path');
    const hasFolderData = e.dataTransfer.types.includes('application/x-folder-path');
    if (!hasNoteData || hasFolderData || !canDropDraggedNoteIntoRoot()) return;

    e.preventDefault();
    e.stopPropagation();
    rootDragCounterRef.current = 0;
    setIsDragOverRoot(false);

    const notePath = e.dataTransfer.getData('application/x-note-path');
    // A note already at the root has nowhere to go — the backend treats this
    // as a no-op now, but skipping it also spares the pointless "Note moved"
    // toast and the note-list refresh behind it.
    if (notePath && notePath.includes('/')) {
      try {
        await moveNoteToFolder(notePath, undefined);
      } catch {
        // The move workflow owns its error toast.
      }
    }
  };

  // Folders section — accepts folders only.
  const onFoldersRootDragEnter = (e: React.DragEvent) => {
    if (
      !e.dataTransfer.types.includes('application/x-folder-path') ||
      !canDropDraggedFolderIntoRoot()
    ) {
      return;
    }
    e.preventDefault();
    foldersRootDragCounterRef.current++;
    setIsDragOverFoldersRoot(true);
  };

  const onFoldersRootDragOver = (e: React.DragEvent) => {
    if (
      !e.dataTransfer.types.includes('application/x-folder-path') ||
      !canDropDraggedFolderIntoRoot()
    ) {
      return;
    }
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  };

  const onFoldersRootDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    foldersRootDragCounterRef.current = Math.max(0, foldersRootDragCounterRef.current - 1);
    if (foldersRootDragCounterRef.current === 0) {
      setIsDragOverFoldersRoot(false);
    }
  };

  const onFoldersRootDrop = async (e: React.DragEvent) => {
    if (!canDropDraggedFolderIntoRoot()) return;
    e.preventDefault();
    e.stopPropagation();
    foldersRootDragCounterRef.current = 0;
    setIsDragOverFoldersRoot(false);

    const folderPath = e.dataTransfer.getData('application/x-folder-path');
    if (folderPath) {
      try {
        await moveFolderToFolder(folderPath, undefined);
      } catch {
        // The move workflow owns its error toast.
      }
    }
  };

  return {
    isDragOverRoot,
    isDragOverFoldersRoot,
    onRootDragEnter,
    onRootDragOver,
    onRootDragLeave,
    onRootDrop,
    onFoldersRootDragEnter,
    onFoldersRootDragOver,
    onFoldersRootDragLeave,
    onFoldersRootDrop,
  };
}

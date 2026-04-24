import { useRef, useState } from 'react';

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
    e.preventDefault();
    rootDragCounterRef.current++;
    const hasNoteData = e.dataTransfer.types.includes('application/x-note-path');
    const hasTextData = e.dataTransfer.types.includes('text/plain');
    const hasFolderData = e.dataTransfer.types.includes('application/x-folder-path');
    if ((hasNoteData || hasTextData) && !hasFolderData) {
      setIsDragOverRoot(true);
    }
  };

  const onRootDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    const hasNoteData = e.dataTransfer.types.includes('application/x-note-path');
    const hasTextData = e.dataTransfer.types.includes('text/plain');
    const hasFolderData = e.dataTransfer.types.includes('application/x-folder-path');
    if ((hasNoteData || hasTextData) && !hasFolderData) {
      e.dataTransfer.dropEffect = 'move';
    }
  };

  const onRootDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    rootDragCounterRef.current--;
    if (rootDragCounterRef.current === 0) {
      setIsDragOverRoot(false);
    }
  };

  const onRootDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    rootDragCounterRef.current = 0;
    setIsDragOverRoot(false);

    const hasFolderData = e.dataTransfer.types.includes('application/x-folder-path');
    if (hasFolderData) return;

    let notePath = e.dataTransfer.getData('application/x-note-path');
    if (!notePath) {
      notePath = e.dataTransfer.getData('text/plain');
    }
    if (notePath) {
      await moveNoteToFolder(notePath, undefined);
    }
  };

  // Folders section — accepts folders only.
  const onFoldersRootDragEnter = (e: React.DragEvent) => {
    e.preventDefault();
    foldersRootDragCounterRef.current++;
    if (e.dataTransfer.types.includes('application/x-folder-path')) {
      setIsDragOverFoldersRoot(true);
    }
  };

  const onFoldersRootDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    if (e.dataTransfer.types.includes('application/x-folder-path')) {
      e.dataTransfer.dropEffect = 'move';
    }
  };

  const onFoldersRootDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    foldersRootDragCounterRef.current--;
    if (foldersRootDragCounterRef.current === 0) {
      setIsDragOverFoldersRoot(false);
    }
  };

  const onFoldersRootDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    foldersRootDragCounterRef.current = 0;
    setIsDragOverFoldersRoot(false);

    const folderPath = e.dataTransfer.getData('application/x-folder-path');
    if (folderPath) {
      await moveFolderToFolder(folderPath, undefined);
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

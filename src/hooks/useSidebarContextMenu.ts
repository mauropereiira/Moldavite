import { useCallback, useEffect, useState } from 'react';
import type { NoteFile, FolderInfo } from '@/types';

interface Position {
  x: number;
  y: number;
}

/**
 * Manages right-click menu state for a single target type. Encapsulates
 * position tracking and the "click anywhere else to dismiss" effect that
 * previously lived as a repeated pattern in Sidebar.tsx.
 */
function useContextMenu<T>() {
  const [target, setTarget] = useState<T | null>(null);
  const [position, setPosition] = useState<Position>({ x: 0, y: 0 });

  const open = useCallback((t: T, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setTarget(t);
    setPosition({ x: e.clientX, y: e.clientY });
  }, []);

  const close = useCallback(() => setTarget(null), []);

  useEffect(() => {
    if (!target) return;
    const handleClick = () => close();
    document.addEventListener('click', handleClick);
    return () => document.removeEventListener('click', handleClick);
  }, [target, close]);

  return { target, position, open, close };
}

/** Aggregates note + folder right-click menus for the sidebar. */
export function useSidebarContextMenu() {
  const noteMenu = useContextMenu<NoteFile>();
  const folderMenu = useContextMenu<FolderInfo>();
  return { noteMenu, folderMenu };
}

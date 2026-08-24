import type { FolderInfo } from '@/types';
import { ContextMenuSurface } from './ContextMenuSurface';

interface FolderContextMenuProps {
  folder: FolderInfo;
  position: { x: number; y: number };
  onNewNoteInFolder: (folder: FolderInfo) => void;
  onRename: (folder: FolderInfo) => void;
  onDelete: (folder: FolderInfo) => void;
  onClose: () => void;
}

const itemClass = 'shrink-0 w-full px-3 py-2 text-left text-sm transition-colors';

export function FolderContextMenu({
  folder,
  position,
  onNewNoteInFolder,
  onRename,
  onDelete,
  onClose,
}: FolderContextMenuProps) {
  return (
    <ContextMenuSurface position={position} onClose={onClose}>
      <button
        onClick={() => onNewNoteInFolder(folder)}
        className={itemClass}
        style={{ color: 'var(--text-primary)' }}
      >
        New Note in Folder
      </button>
      <button
        onClick={() => onRename(folder)}
        className={itemClass}
        style={{ color: 'var(--text-primary)' }}
      >
        Rename Folder
      </button>
      <div className="my-1 shrink-0" style={{ borderTop: '1px solid var(--border-muted)' }} />
      <button
        onClick={() => onDelete(folder)}
        className={itemClass}
        style={{ color: 'var(--error)' }}
      >
        Delete Folder
      </button>
    </ContextMenuSurface>
  );
}

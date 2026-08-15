import type { FolderInfo } from '@/types';
import { applyImpactOrigin } from '@/lib/impactOrigin';

interface FolderContextMenuProps {
  folder: FolderInfo;
  position: { x: number; y: number };
  onNewNoteInFolder: (folder: FolderInfo) => void;
  onRename: (folder: FolderInfo) => void;
  onDelete: (folder: FolderInfo) => void;
}

const itemClass = 'w-full px-3 py-2 text-left text-sm transition-colors';

function hoverIn(e: React.MouseEvent<HTMLButtonElement>) {
  e.currentTarget.style.backgroundColor = 'var(--hover-overlay)';
}
function hoverOut(e: React.MouseEvent<HTMLButtonElement>) {
  e.currentTarget.style.backgroundColor = 'transparent';
}

export function FolderContextMenu({
  folder,
  position,
  onNewNoteInFolder,
  onRename,
  onDelete,
}: FolderContextMenuProps) {
  return (
    <div
      ref={(node) => applyImpactOrigin(node, position)}
      className="fixed z-[9999] py-1 min-w-[160px] modal-content-enter impact-surface"
      style={{
        left: position.x,
        top: position.y,
        backgroundColor: 'var(--bg-elevated)',
        border: '1px solid var(--border-default)',
        borderRadius: 'var(--radius-sm)',
      }}
      onClick={(e) => e.stopPropagation()}
    >
      <button
        onClick={() => onNewNoteInFolder(folder)}
        className={itemClass}
        style={{ color: 'var(--text-primary)' }}
        onMouseEnter={hoverIn}
        onMouseLeave={hoverOut}
      >
        New Note in Folder
      </button>
      <button
        onClick={() => onRename(folder)}
        className={itemClass}
        style={{ color: 'var(--text-primary)' }}
        onMouseEnter={hoverIn}
        onMouseLeave={hoverOut}
      >
        Rename Folder
      </button>
      <div className="my-1" style={{ borderTop: '1px solid var(--border-muted)' }} />
      <button
        onClick={() => onDelete(folder)}
        className={itemClass}
        style={{ color: 'var(--error)' }}
        onMouseEnter={hoverIn}
        onMouseLeave={hoverOut}
      >
        Delete Folder
      </button>
    </div>
  );
}

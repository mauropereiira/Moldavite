import { FolderInput, Trash2, X } from 'lucide-react';
import { useNoteSelectionStore } from '@/stores';

interface BulkActionBarProps {
  onMoveToFolder: () => void;
  onTrash: () => void;
}

/**
 * Floating action bar that appears when the user has multi-selected notes
 * in the sidebar. Renders nothing when the selection is empty.
 *
 * Kept deliberately dumb — actions are passed in as callbacks so Sidebar
 * owns the modal/confirmation state. That keeps this component easy to
 * style-iterate on without worrying about side effects.
 */
export function BulkActionBar({ onMoveToFolder, onTrash }: BulkActionBarProps) {
  const count = useNoteSelectionStore((s) => s.selectedIds.size);
  const clear = useNoteSelectionStore((s) => s.clear);

  if (count === 0) return null;

  return (
    <div
      // Absolute position bottom-center above the footer. Pointer-events on the
      // inner card only so the backdrop remains transparent to clicks — the
      // sidebar's root-click handler still clears selection if the user clicks
      // anywhere outside a note row.
      className="absolute left-1/2 -translate-x-1/2 bottom-16 z-50 flex items-center gap-2 px-3 py-2 shadow-lg select-none"
      role="toolbar"
      aria-label="Bulk note actions"
      style={{
        backgroundColor: 'var(--bg-elevated)',
        border: '1px solid var(--border-default)',
        borderRadius: 'var(--radius-md)',
        boxShadow: 'var(--shadow-md)',
      }}
      onClick={(e) => e.stopPropagation()}
    >
      <span className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>
        {count} selected
      </span>
      <span style={{ width: 1, height: 16, backgroundColor: 'var(--border-muted)' }} />
      <button
        onClick={onMoveToFolder}
        className="inline-flex items-center gap-1.5 px-2 py-1 text-xs font-medium rounded transition-colors focus-ring"
        style={{ color: 'var(--text-primary)' }}
        onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = 'var(--hover-overlay)')}
        onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
      >
        <FolderInput className="w-3.5 h-3.5" />
        Move to folder
      </button>
      <button
        onClick={onTrash}
        className="inline-flex items-center gap-1.5 px-2 py-1 text-xs font-medium rounded transition-colors focus-ring"
        style={{ color: 'var(--error)' }}
        onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = 'var(--hover-overlay)')}
        onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
      >
        <Trash2 className="w-3.5 h-3.5" />
        Trash
      </button>
      <span style={{ width: 1, height: 16, backgroundColor: 'var(--border-muted)' }} />
      <button
        onClick={clear}
        className="inline-flex items-center gap-1 px-2 py-1 text-xs rounded transition-colors focus-ring"
        style={{ color: 'var(--text-muted)' }}
        onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = 'var(--hover-overlay)')}
        onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
        aria-label="Clear selection"
      >
        <X className="w-3.5 h-3.5" />
        Clear
      </button>
    </div>
  );
}

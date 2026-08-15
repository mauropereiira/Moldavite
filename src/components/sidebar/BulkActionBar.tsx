import { useNoteSelectionStore } from '@/stores';

interface BulkActionBarProps {
  onMoveToFolder: () => void;
  onTrash: () => void;
  onExport: () => void;
}

/**
 * Floating action bar that appears when the user has multi-selected notes
 * in the sidebar. Renders nothing when the selection is empty.
 *
 * Kept deliberately dumb — actions are passed in as callbacks so Sidebar
 * owns the modal/confirmation state. That keeps this component easy to
 * style-iterate on without worrying about side effects.
 */
export function BulkActionBar({ onMoveToFolder, onTrash, onExport }: BulkActionBarProps) {
  const count = useNoteSelectionStore((s) => s.selectedIds.size);
  const clear = useNoteSelectionStore((s) => s.clear);

  if (count === 0) return null;

  return (
    <div
      // Absolute position bottom-center above the footer. Pointer-events on the
      // inner card only so the backdrop remains transparent to clicks — the
      // sidebar's root-click handler still clears selection if the user clicks
      // anywhere outside a note row.
      className="absolute left-1/2 -translate-x-1/2 bottom-16 z-50 flex items-center gap-2 px-3 py-2 select-none"
      role="toolbar"
      aria-label="Bulk note actions"
      style={{
        backgroundColor: 'var(--bg-elevated)',
        border: '1px solid var(--border-default)',
      }}
      onClick={(e) => e.stopPropagation()}
    >
      <span className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>
        {count} selected
      </span>
      <span
        aria-hidden="true"
        style={{ width: 1, height: 16, backgroundColor: 'var(--border-muted)' }}
      />
      <button
        type="button"
        onClick={onMoveToFolder}
        className="inline-flex items-center px-2 py-1 text-xs font-medium transition-colors focus-ring"
        style={{ color: 'var(--text-primary)' }}
        onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--text-secondary)')}
        onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--text-primary)')}
      >
        Move to folder
      </button>
      <button
        type="button"
        onClick={onExport}
        className="inline-flex items-center px-2 py-1 text-xs font-medium transition-colors focus-ring"
        style={{ color: 'var(--text-primary)' }}
        onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--text-secondary)')}
        onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--text-primary)')}
      >
        Export…
      </button>
      <button
        type="button"
        onClick={onTrash}
        className="inline-flex items-center px-2 py-1 text-xs font-medium transition-colors focus-ring"
        style={{ color: 'var(--error)' }}
      >
        Trash
      </button>
      <span
        aria-hidden="true"
        style={{ width: 1, height: 16, backgroundColor: 'var(--border-muted)' }}
      />
      <button
        type="button"
        onClick={clear}
        className="inline-flex items-center px-2 py-1 text-xs transition-colors focus-ring"
        style={{ color: 'var(--text-muted)' }}
        onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--text-primary)')}
        onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--text-muted)')}
        aria-label="Clear selection"
      >
        Clear
      </button>
    </div>
  );
}

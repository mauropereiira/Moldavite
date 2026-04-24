import { useCallback, useEffect, useRef, useState } from 'react';
import { Trash2, Undo2, FileText, Calendar, Folder, X, GripHorizontal } from 'lucide-react';
import type { TrashedNote } from '@/types';

const POPOVER_WIDTH = 380;
const POPOVER_MAX_HEIGHT = 520;
const GAP = 12;

interface TrashPopoverProps {
  isOpen: boolean;
  anchor: HTMLElement | null;
  trashedNotes: TrashedNote[];
  onClose: () => void;
  onRestore: (trashId: string) => void;
  onPermanentDelete: (trashId: string) => void;
  onEmptyTrash: () => void;
  /** Row click opens preview (the buttons don't trigger this). */
  onPreview: (note: TrashedNote) => void;
}

/**
 * Small floating popover anchored above the sidebar's Trash footer
 * button. Lists items deleted in the last 7 days.
 */
export function TrashPopover({
  isOpen,
  anchor,
  trashedNotes,
  onClose,
  onRestore,
  onPermanentDelete,
  onEmptyTrash,
  onPreview,
}: TrashPopoverProps) {
  const popoverRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null);
  const dragStateRef = useRef<{ offsetX: number; offsetY: number } | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  // First-open positioning: drop the popover to the right of the sidebar
  // footer (using the anchor button as a reference), without covering it.
  // Subsequent opens during the same session reuse the dragged position.
  useEffect(() => {
    if (!isOpen || !anchor) return;
    setPosition((prev) => {
      if (prev) {
        // Clamp previous position in case the viewport shrank since.
        return {
          left: Math.max(
            GAP,
            Math.min(window.innerWidth - POPOVER_WIDTH - GAP, prev.left),
          ),
          top: Math.max(
            GAP,
            Math.min(window.innerHeight - 80 - GAP, prev.top),
          ),
        };
      }
      const rect = anchor.getBoundingClientRect();
      // Anchor sits at the bottom of the sidebar — place popover just to
      // the right of the sidebar, with its bottom aligned to the button.
      const left = Math.min(
        window.innerWidth - POPOVER_WIDTH - GAP,
        rect.right + GAP,
      );
      const top = Math.max(
        GAP,
        Math.min(
          window.innerHeight - POPOVER_MAX_HEIGHT - GAP,
          rect.bottom - POPOVER_MAX_HEIGHT,
        ),
      );
      return { left, top };
    });
  }, [isOpen, anchor]);

  // Drag handlers: the header is a drag handle. Updates `position` via
  // mousemove and clamps to the viewport on mouseup.
  const handleHeaderMouseDown = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (!position) return;
      // Ignore drags that start on a button (close button, etc.).
      if ((e.target as HTMLElement).closest('button')) return;
      e.preventDefault();
      dragStateRef.current = {
        offsetX: e.clientX - position.left,
        offsetY: e.clientY - position.top,
      };
      setIsDragging(true);
    },
    [position],
  );

  useEffect(() => {
    if (!isDragging) return;
    const handleMove = (e: MouseEvent) => {
      const drag = dragStateRef.current;
      if (!drag) return;
      const left = Math.max(
        GAP,
        Math.min(window.innerWidth - POPOVER_WIDTH - GAP, e.clientX - drag.offsetX),
      );
      const top = Math.max(
        GAP,
        Math.min(window.innerHeight - 80 - GAP, e.clientY - drag.offsetY),
      );
      setPosition({ left, top });
    };
    const handleUp = () => {
      dragStateRef.current = null;
      setIsDragging(false);
    };
    document.addEventListener('mousemove', handleMove);
    document.addEventListener('mouseup', handleUp);
    return () => {
      document.removeEventListener('mousemove', handleMove);
      document.removeEventListener('mouseup', handleUp);
    };
  }, [isDragging]);

  // Close when clicking outside.
  useEffect(() => {
    if (!isOpen) return;

    const handleClick = (e: MouseEvent) => {
      const target = e.target as Node;
      if (popoverRef.current?.contains(target)) return;
      if (anchor?.contains(target)) return;
      onClose();
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };

    document.addEventListener('mousedown', handleClick);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('keydown', handleKey);
    };
  }, [isOpen, anchor, onClose]);

  if (!isOpen || !position) return null;

  // Trash entries live 7 days, so `daysAgo = 7 - daysRemaining` (clamped
  // to 0). This avoids calling `Date.now()` during render, which the
  // react-hooks/purity lint rule flags as impure.
  const daysAgo = (daysRemaining: number) => {
    const days = Math.max(0, 7 - daysRemaining);
    if (days <= 0) return 'Today';
    if (days === 1) return '1 day ago';
    return `${days} days ago`;
  };

  return (
    <div
      ref={popoverRef}
      className="fixed z-[9999] flex flex-col modal-content-enter"
      style={{
        left: position.left,
        top: position.top,
        width: POPOVER_WIDTH,
        maxHeight: POPOVER_MAX_HEIGHT,
        backgroundColor: 'var(--bg-elevated)',
        border: '1px solid var(--border-default)',
        borderRadius: 'var(--radius-md)',
        boxShadow: 'var(--shadow-md)',
        color: 'var(--text-primary)',
      }}
      role="dialog"
      aria-label="Trash"
    >
      <div
        className="flex items-center justify-between px-3 py-2 select-none"
        style={{
          borderBottom: '1px solid var(--border-default)',
          cursor: isDragging ? 'grabbing' : 'grab',
        }}
        onMouseDown={handleHeaderMouseDown}
      >
        <div className="flex items-center gap-2">
          <GripHorizontal
            className="w-3.5 h-3.5"
            style={{ color: 'var(--text-muted)', opacity: 0.6 }}
          />
          <Trash2 className="w-4 h-4" style={{ color: 'var(--text-muted)' }} />
          <h3 className="text-sm font-semibold">Trash</h3>
          <span
            className="text-[10px] px-1.5 py-0.5 rounded"
            style={{
              backgroundColor: 'var(--count-badge-bg)',
              color: 'var(--text-muted)',
            }}
          >
            {trashedNotes.length}
          </span>
        </div>
        <button
          onClick={onClose}
          className="p-1 transition-colors"
          style={{ color: 'var(--text-muted)', borderRadius: 'var(--radius-sm)' }}
          onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = 'var(--hover-overlay)')}
          onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
          aria-label="Close trash popover"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto">
        {trashedNotes.length === 0 ? (
          <div className="px-4 py-8 text-center">
            <Trash2 className="w-10 h-10 mx-auto mb-2" style={{ color: 'var(--text-muted)', opacity: 0.4 }} />
            <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
              Trash is empty
            </p>
          </div>
        ) : (
          <ul className="divide-y" style={{ borderColor: 'var(--border-muted)' }}>
            {trashedNotes.map((note) => (
              <li
                key={note.id}
                className="px-3 py-2 cursor-pointer transition-colors"
                onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = 'var(--hover-overlay)')}
                onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
                onClick={() => onPreview(note)}
              >
                <div className="flex items-start gap-2">
                  <div className="flex-shrink-0 mt-0.5">
                    {note.isFolder ? (
                      <Folder className="w-4 h-4" style={{ color: 'var(--warning)' }} />
                    ) : note.isDaily ? (
                      <Calendar className="w-4 h-4" style={{ color: 'var(--accent-primary)' }} />
                    ) : (
                      <FileText className="w-4 h-4" style={{ color: 'var(--text-muted)' }} />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm truncate font-medium">
                      {note.filename.replace(/\.md$/, '')}
                    </p>
                    <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
                      {daysAgo(note.daysRemaining)} · {note.daysRemaining}d left
                    </p>
                  </div>
                  <div
                    className="flex items-center gap-0.5 flex-shrink-0"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <button
                      onClick={() => onRestore(note.id)}
                      className="p-1 transition-colors"
                      style={{ color: 'var(--text-muted)', borderRadius: 'var(--radius-sm)' }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.backgroundColor = 'var(--hover-overlay)';
                        e.currentTarget.style.color = 'var(--accent-primary)';
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.backgroundColor = 'transparent';
                        e.currentTarget.style.color = 'var(--text-muted)';
                      }}
                      title="Restore"
                      aria-label="Restore"
                    >
                      <Undo2 className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => onPermanentDelete(note.id)}
                      className="p-1 transition-colors"
                      style={{ color: 'var(--text-muted)', borderRadius: 'var(--radius-sm)' }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.backgroundColor = 'var(--hover-overlay)';
                        e.currentTarget.style.color = 'var(--error)';
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.backgroundColor = 'transparent';
                        e.currentTarget.style.color = 'var(--text-muted)';
                      }}
                      title="Delete permanently"
                      aria-label="Delete permanently"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {trashedNotes.length > 0 && (
        <div
          className="px-3 py-2"
          style={{ borderTop: '1px solid var(--border-default)' }}
        >
          <button
            onClick={onEmptyTrash}
            className="w-full text-sm font-medium py-1.5 rounded transition-colors"
            style={{ color: 'var(--error)' }}
            onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = 'var(--hover-overlay)')}
            onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
          >
            Empty Trash
          </button>
        </div>
      )}
    </div>
  );
}

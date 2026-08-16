import React from 'react';
import type { NoteFile } from '@/types';
import { useNoteSelectionStore } from '@/stores';

interface DraggableNoteItemProps {
  note: NoteFile;
  isActive: boolean;
  /** Stable callback — note is passed back so the parent can keep one reference across the list. */
  onClick: (note: NoteFile, e: React.MouseEvent) => void;
  onContextMenu: (note: NoteFile, e: React.MouseEvent) => void;
  /** Modifier-click handler: cmd/ctrl toggles, shift extends. Parent owns range state. */
  onSelectionClick?: (note: NoteFile, e: React.MouseEvent) => void;
  level?: number;
  tags?: string[];
  index?: number;
}

function DraggableNoteItemImpl({
  note,
  isActive,
  onClick,
  onContextMenu,
  onSelectionClick,
  level = 0,
  tags = [],
  index = 0,
}: DraggableNoteItemProps) {
  // Narrow selector: subscribe to this row's selection bit only. Any other
  // row's state change returns the same boolean, so React bails out of the
  // update. This is what keeps the memoized list efficient when a user
  // shift-selects a 500-note range.
  const isSelected = useNoteSelectionStore((s) => s.selectedIds.has(note.path));
  const handleClick = (e: React.MouseEvent) => {
    // Cmd/Ctrl-click toggles and shift-click extends the selection. We route
    // both through `onSelectionClick` so the parent can keep track of the
    // anchor for range selection. Plain clicks fall through to `onClick` so
    // normal navigation (open note / open-in-new-tab with meta) keeps working
    // when selection mode isn't being used. To avoid clashing with the
    // existing "cmd-click to open in new tab" behaviour, we only intercept
    // cmd/ctrl when there's already an active selection — shift always
    // intercepts because shift has no prior meaning on a note row.
    const hasExistingSelection = useNoteSelectionStore.getState().selectedIds.size > 0;
    if (e.shiftKey || ((e.metaKey || e.ctrlKey) && hasExistingSelection)) {
      if (onSelectionClick) {
        e.preventDefault();
        e.stopPropagation();
        onSelectionClick(note, e);
        return;
      }
    }
    onClick(note, e);
  };
  const handleContextMenu = (e: React.MouseEvent) => onContextMenu(note, e);
  const handleDragStart = (e: React.DragEvent) => {
    // Store the note path for drag-and-drop
    // Strip "notes/" prefix for the relative path within notes folder
    const relativePath = note.path.startsWith('notes/') ? note.path.slice(6) : note.path;
    e.dataTransfer.setData('text/plain', relativePath);
    e.dataTransfer.setData('application/x-note-path', relativePath);
    e.dataTransfer.effectAllowed = 'move';
  };

  return (
    <div
      className="group relative list-item-stagger"
      style={
        {
          paddingLeft: level > 0 ? `${level * 12}px` : undefined,
          '--index': Math.min(index, 10),
        } as React.CSSProperties
      }
      onContextMenu={handleContextMenu}
      draggable
      onDragStart={handleDragStart}
    >
      <div
        onClick={handleClick}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => e.key === 'Enter' && handleClick(e as unknown as React.MouseEvent)}
        className={`note-card sidebar-item-animated w-full text-left text-sm pr-14 focus-ring cursor-pointer${
          isActive ? ' note-card-active' : ''
        }${isSelected ? ' is-selected' : ''}`}
        aria-pressed={isSelected || undefined}
      >
        {/* `min-w-0` on both: a flex item's default minimum is its content
            size, so `truncate` never engages and a long note name runs under
            the Options button instead of ellipsing before it. */}
        <span className="flex min-w-0 items-baseline gap-2">
          {note.isLocked && (
            <span
              className="flex-shrink-0 text-[10px] font-normal"
              style={{ color: 'var(--text-muted)' }}
            >
              Locked
            </span>
          )}
          <span className="note-card-title min-w-0 truncate">{note.name.replace(/\.md$/, '')}</span>
        </span>
        {tags.length > 0 && (
          <div className="flex flex-wrap gap-x-2 gap-y-0.5 mt-0.5">
            {tags.slice(0, 3).map((tag) => (
              <span key={tag} className="note-tag">
                #{tag}
              </span>
            ))}
            {tags.length > 3 && <span className="note-tag">+{tags.length - 3}</span>}
          </div>
        )}
      </div>
      <button
        onClick={(e) => {
          e.stopPropagation();
          handleContextMenu(e);
        }}
        draggable={false}
        className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] opacity-0 group-hover:opacity-60 focus-visible:opacity-100 transition-all"
        style={{ color: 'var(--text-muted)' }}
        onMouseEnter={(e) => {
          e.currentTarget.style.color = 'var(--text-primary)';
          e.currentTarget.style.opacity = '1';
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.color = 'var(--text-muted)';
          // Clear the inline opacity set on enter; an inline style outranks the
          // classes above, so leaving it behind pins the button visible.
          e.currentTarget.style.opacity = '';
        }}
        aria-label="Note options"
      >
        Options
      </button>
    </div>
  );
}

const arraysEqual = (a: string[] = [], b: string[] = []) => {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
};

export const DraggableNoteItem = React.memo(
  DraggableNoteItemImpl,
  (prev, next) =>
    prev.note === next.note &&
    prev.isActive === next.isActive &&
    prev.level === next.level &&
    prev.index === next.index &&
    prev.onClick === next.onClick &&
    prev.onContextMenu === next.onContextMenu &&
    prev.onSelectionClick === next.onSelectionClick &&
    arraysEqual(prev.tags, next.tags)
);

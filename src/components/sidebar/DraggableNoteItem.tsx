import React from 'react';
import { Lock, MoreHorizontal, Hash } from 'lucide-react';
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
}

function DraggableNoteItemImpl({
  note,
  isActive,
  onClick,
  onContextMenu,
  onSelectionClick,
  level = 0,
  tags = [],
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
    const relativePath = note.path.startsWith('notes/')
      ? note.path.slice(6)
      : note.path;
    e.dataTransfer.setData('text/plain', relativePath);
    e.dataTransfer.setData('application/x-note-path', relativePath);
    e.dataTransfer.effectAllowed = 'move';
  };

  // Selection highlight composes with the active-tab highlight. We prefer the
  // active colour for the left border but blend the background so a selected
  // row that's also active stays visually distinct.
  const background = isSelected ? 'var(--accent-subtle)' : undefined;

  return (
    <div
      className="group relative"
      style={{ paddingLeft: level > 0 ? `${level * 12}px` : undefined }}
      onContextMenu={handleContextMenu}
      draggable
      onDragStart={handleDragStart}
    >
      <div
        onClick={handleClick}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => e.key === 'Enter' && handleClick(e as unknown as React.MouseEvent)}
        className={`note-card sidebar-item-animated w-full text-left text-sm pr-8 focus-ring cursor-pointer${
          isSelected ? ' is-selected' : ''
        }`}
        aria-pressed={isSelected || undefined}
        style={{
          color: isActive ? 'var(--accent-primary)' : 'var(--text-primary)',
          borderLeft: isActive
            ? '2px solid var(--accent-primary)'
            : isSelected
              ? '2px solid var(--accent-primary)'
              : '2px solid transparent',
          paddingLeft: '10px',
          marginLeft: '-2px',
          backgroundColor: background,
        }}
      >
        <span className="flex items-center gap-2">
          {note.isLocked && (
            <Lock className="w-4 h-4 flex-shrink-0" style={{ color: 'var(--warning)' }} />
          )}
          <span className="truncate">{note.name.replace(/\.md$/, '')}</span>
        </span>
        {tags.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-1">
            {tags.slice(0, 3).map((tag) => (
              <span
                key={tag}
                className="inline-flex items-center gap-0.5 px-1.5 py-0.5 text-[10px] font-medium rounded"
                style={{
                  backgroundColor: 'var(--accent-subtle)',
                  color: 'var(--accent-primary)',
                }}
              >
                <Hash className="w-2.5 h-2.5" style={{ opacity: 0.7 }} />
                {tag}
              </span>
            ))}
            {tags.length > 3 && (
              <span
                className="px-1.5 py-0.5 text-[10px] font-medium rounded"
                style={{
                  backgroundColor: 'var(--bg-inset)',
                  color: 'var(--text-muted)',
                }}
              >
                +{tags.length - 3}
              </span>
            )}
          </div>
        )}
      </div>
      <button
        onClick={(e) => {
          e.stopPropagation();
          handleContextMenu(e);
        }}
        draggable={false}
        className="absolute right-1 top-1/2 -translate-y-1/2 p-1 rounded opacity-0 group-hover:opacity-60 transition-all"
        style={{
          borderRadius: 'var(--radius-sm)',
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.backgroundColor = 'var(--hover-overlay)';
          e.currentTarget.style.opacity = '1';
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.backgroundColor = 'transparent';
        }}
        aria-label="Note options"
      >
        <MoreHorizontal className="w-4 h-4" style={{ color: 'var(--text-tertiary)' }} />
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
    prev.onClick === next.onClick &&
    prev.onContextMenu === next.onContextMenu &&
    prev.onSelectionClick === next.onSelectionClick &&
    arraysEqual(prev.tags, next.tags),
);

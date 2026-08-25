import React, { useState } from 'react';
import type { NoteFile } from '@/types';
import { useNoteSelectionStore } from '@/stores';
import type { DropPlace } from '@/stores/sidebarOrderStore';
import { dropPlaceFromPointer, isSameFolder } from './dropPlacement';
import { DropIndicator } from './DropIndicator';

/** The folder a dragged note came from, read off its `notes/`-relative path. */
function folderOfRelativePath(relative: string): string | null {
  const cut = relative.lastIndexOf('/');
  return cut === -1 ? null : relative.slice(0, cut);
}

/**
 * The note currently being dragged, if any.
 *
 * `dataTransfer.getData` is deliberately unreadable until the drop, so a row
 * cannot ask "is this one of mine?" while deciding whether to show the insert
 * line. The drag never leaves this window, so remembering the source here is
 * enough — and the drop itself still reads `dataTransfer`, which is the
 * authoritative copy.
 */
let draggedNote: { path: string; folderPath?: string } | null = null;

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
  /**
   * Manual-sort only. Drop another note from this same list onto this row to
   * take its place. Absent in every other sort mode, where the list order is
   * computed and a reorder would silently do nothing.
   */
  onReorder?: (draggedPath: string, targetPath: string, place: DropPlace) => void;
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
  onReorder,
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
    // The full address as well: reordering keys off `note.path`, and the
    // relative form above cannot be turned back into one for a note that
    // does not live under `notes/`.
    e.dataTransfer.setData('application/x-note-id', note.path);
    e.dataTransfer.effectAllowed = 'move';
    draggedNote = { path: note.path, folderPath: note.folderPath };
  };
  const handleDragEnd = () => {
    draggedNote = null;
  };

  // Reorder drop target. Only a note from this same list is a reorder; a note
  // dragged in from another folder is a move, so that drop is left alone to
  // bubble to the section / folder zone that already handles moves.
  const [dropPlace, setDropPlace] = useState<DropPlace | null>(null);

  const isReorderDrag = () =>
    draggedNote !== null &&
    draggedNote.path !== note.path &&
    isSameFolder(draggedNote.folderPath, note.folderPath);

  const handleDragOver = (e: React.DragEvent) => {
    if (!isReorderDrag()) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDropPlace(dropPlaceFromPointer(e));
  };
  const handleDragLeave = (e: React.DragEvent) => {
    // `relatedTarget` is where the pointer went. Crossing between this row's
    // own children fires a leave the row never actually experienced.
    if (e.currentTarget.contains(e.relatedTarget as Node)) return;
    setDropPlace(null);
  };
  const handleDropOnRow = (e: React.DragEvent) => {
    setDropPlace(null);
    const draggedPath = e.dataTransfer.getData('application/x-note-id');
    if (!draggedPath || draggedPath === note.path) return;
    const from = folderOfRelativePath(e.dataTransfer.getData('application/x-note-path'));
    if (!isSameFolder(from, note.folderPath)) return;
    e.preventDefault();
    e.stopPropagation();
    // Recomputed from the event rather than read off state: the drop is the
    // authoritative pointer position, and state could be a frame behind it.
    onReorder?.(draggedPath, note.path, dropPlaceFromPointer(e));
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
      onDragEnd={handleDragEnd}
      onDragLeave={onReorder && handleDragLeave}
      onDragOver={onReorder && handleDragOver}
      onDrop={onReorder && handleDropOnRow}
    >
      <DropIndicator place={dropPlace} />
      <div
        onClick={handleClick}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => e.key === 'Enter' && handleClick(e as unknown as React.MouseEvent)}
        className={`note-card sidebar-item-animated w-full text-left text-sm focus-ring cursor-pointer${
          isActive ? ' note-card-active' : ''
        }${isSelected ? ' is-selected' : ''}`}
        // `.note-card` uses a padding shorthand that outranks Tailwind's
        // layered utilities. Keep the overlaid Options action clear here.
        style={{ paddingRight: '3.5rem' }}
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
    prev.onReorder === next.onReorder &&
    arraysEqual(prev.tags, next.tags)
);

import React, { useState, useRef } from 'react';
import type { FolderInfo, NoteFile } from '@/types';
import type { DropPlace } from '@/stores/sidebarOrderStore';
import { DraggableNoteItem } from './DraggableNoteItem';
import { Folder, FolderOpen } from 'lucide-react';
import { folderDropIntent } from './dropPlacement';
import { DropIndicator } from './DropIndicator';
import { SignatureMark } from '@/components/ui/SignatureMark';

interface FolderItemProps {
  folder: FolderInfo;
  level: number;
  isExpanded: boolean;
  onToggle: () => void;
  onContextMenu: (e: React.MouseEvent) => void;
  onNoteDrop: (notePath: string) => void;
  onFolderDrop: (folderPath: string) => void;
  notes: NoteFile[];
  isNoteActive: (note: NoteFile) => boolean;
  onNoteClick: (note: NoteFile, e: React.MouseEvent) => void;
  onNoteSelectionClick?: (note: NoteFile, e: React.MouseEvent) => void;
  onNoteContextMenu: (note: NoteFile, e: React.MouseEvent) => void;
  getNoteTags?: (notePath: string) => string[];
  renderChildren?: React.ReactNode;
  showShapeMark?: boolean;
  index?: number;
  /**
   * Manual-sort only. Dropping a *sibling* folder on this row's header
   * reorders instead of nesting; nesting a sibling is still available by
   * dropping it into this folder's expanded contents, which is the area the
   * wrapper below still handles.
   */
  onFolderReorder?: (draggedPath: string, targetPath: string, place: DropPlace) => void;
  /** Manual-sort only — reorder notes inside this folder. */
  onNoteReorder?: (draggedPath: string, targetPath: string, place: DropPlace) => void;
}

/** The parent of a folder path: `''` for a top-level folder. */
function parentOfPath(path: string): string {
  const cut = path.lastIndexOf('/');
  return cut === -1 ? '' : path.slice(0, cut);
}

/**
 * The folder currently being dragged, if any. `dataTransfer.getData` stays
 * unreadable until the drop, so this is the only way a row can tell a sibling
 * (reorder) from anything else (nest) while deciding what hover feedback to
 * paint. The drop itself still reads `dataTransfer`.
 */
let draggedFolderPath: string | null = null;

export function FolderItem({
  folder,
  level,
  isExpanded,
  onToggle,
  onContextMenu,
  onNoteDrop,
  onFolderDrop,
  notes,
  isNoteActive,
  onNoteClick,
  onNoteSelectionClick,
  onNoteContextMenu,
  getNoteTags,
  renderChildren,
  showShapeMark = false,
  index = 0,
  onFolderReorder,
  onNoteReorder,
}: FolderItemProps) {
  const [isDragOver, setIsDragOver] = useState(false);
  const dragCounterRef = useRef(0);
  const [dropPlace, setDropPlace] = useState<DropPlace | null>(null);

  // Manual sort: a sibling folder dropped on either END of this header row
  // takes a place beside it. The band through the row's middle still means
  // "nest inside this folder", so both gestures live on the same row and
  // neither is lost — the drop falls through to the wrapper below, which has
  // always handled nesting.
  const isSiblingReorder = (dragged: string | null) =>
    !!onFolderReorder &&
    !!dragged &&
    dragged !== folder.path &&
    parentOfPath(dragged) === parentOfPath(folder.path);

  const handleRowDragOver = (e: React.DragEvent) => {
    if (!isSiblingReorder(draggedFolderPath)) return;
    const intent = folderDropIntent(e);
    setDropPlace(intent === 'nest' ? null : intent);
    if (intent === 'nest') return;
    // Claimed here so the row, not the wrapper, is what the pointer is over.
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  };
  const handleRowDragLeave = (e: React.DragEvent) => {
    if (e.currentTarget.contains(e.relatedTarget as Node)) return;
    setDropPlace(null);
  };
  const handleRowDrop = (e: React.DragEvent) => {
    setDropPlace(null);
    const dragged = e.dataTransfer.getData('application/x-folder-path');
    const intent = folderDropIntent(e);
    if (intent === 'nest' || !isSiblingReorder(dragged)) return;
    e.preventDefault();
    e.stopPropagation();
    onFolderReorder?.(dragged, folder.path, intent);
  };

  // Handle drag start for this folder
  const handleDragStart = (e: React.DragEvent) => {
    e.stopPropagation(); // Prevent parent folders from also starting drag
    e.dataTransfer.setData('text/plain', folder.path);
    e.dataTransfer.setData('application/x-folder-path', folder.path);
    e.dataTransfer.effectAllowed = 'move';
    draggedFolderPath = folder.path;
  };

  const handleDragEnd = () => {
    draggedFolderPath = null;
  };

  const handleDragEnter = (e: React.DragEvent) => {
    e.preventDefault();
    dragCounterRef.current++;

    const hasNoteData = e.dataTransfer.types.includes('application/x-note-path');
    const hasFolderData = e.dataTransfer.types.includes('application/x-folder-path');
    const hasTextData = e.dataTransfer.types.includes('text/plain');

    if (hasNoteData || hasFolderData || hasTextData) {
      setIsDragOver(true);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    const hasNoteData = e.dataTransfer.types.includes('application/x-note-path');
    const hasFolderData = e.dataTransfer.types.includes('application/x-folder-path');
    const hasTextData = e.dataTransfer.types.includes('text/plain');

    if (hasNoteData || hasFolderData || hasTextData) {
      e.dataTransfer.dropEffect = 'move';
    }
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    dragCounterRef.current--;

    // Only set isDragOver to false when we've truly left the entire folder area
    if (dragCounterRef.current === 0) {
      setIsDragOver(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    dragCounterRef.current = 0;
    setIsDragOver(false);

    // Check for folder drop first
    const folderPath = e.dataTransfer.getData('application/x-folder-path');
    if (folderPath) {
      const isSelf = folderPath === folder.path;
      if (isSelf) {
        // Can't drop folder on itself
        return;
      }

      // Check if dragged folder is a DIRECT child of this folder
      // Direct child: path starts with folder.path/ and has no more slashes after
      const isDescendant = folderPath.startsWith(folder.path + '/');
      const remainingPath = isDescendant ? folderPath.slice(folder.path.length + 1) : '';
      const isDirectChild = isDescendant && !remainingPath.includes('/');

      if (isDirectChild) {
        // If it's a direct child, don't capture - let it bubble up to root
        // (user wants to move it OUT of this folder)
        return;
      }

      // Prevent dropping a parent folder into its own descendant
      if (folder.path.startsWith(folderPath + '/')) {
        e.stopPropagation();
        return;
      }

      // Accept the drop - move folder into this folder
      // This includes deeper descendants (grandchildren, etc.) being moved up
      e.stopPropagation();
      onFolderDrop(folderPath);
      return;
    }

    // For notes, always stop propagation
    e.stopPropagation();

    // Try custom note type, fall back to text/plain
    let notePath = e.dataTransfer.getData('application/x-note-path');
    if (!notePath) {
      notePath = e.dataTransfer.getData('text/plain');
    }
    if (notePath) {
      // Don't allow dropping a note into its own folder
      const noteFolder = notePath.includes('/')
        ? notePath.substring(0, notePath.lastIndexOf('/'))
        : null;
      if (noteFolder !== folder.path) {
        onNoteDrop(notePath);
      }
    }
  };

  // Filter notes that belong to this folder
  const folderNotes = notes.filter((n) => n.folderPath === folder.path);

  return (
    <div
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* Folder header row */}
      <div
        className={`folder-row group relative flex items-center gap-2 py-1.5 pr-14 cursor-pointer transition-colors sidebar-item-animated${
          showShapeMark ? ' list-item-stagger' : ''
        }${isExpanded ? ' folder-row-expanded' : ''}`}
        style={
          {
            paddingLeft: `${14 + level * 12}px`,
            borderLeftColor: isDragOver ? 'var(--border-strong)' : undefined,
            '--index': Math.min(index, 10),
          } as React.CSSProperties
        }
        onClick={onToggle}
        role="button"
        tabIndex={0}
        aria-expanded={isExpanded}
        onKeyDown={(e) => {
          if (e.target !== e.currentTarget) return;
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onToggle();
          }
        }}
        onContextMenu={onContextMenu}
        draggable
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        onDragOver={onFolderReorder && handleRowDragOver}
        onDragLeave={onFolderReorder && handleRowDragLeave}
        onDrop={onFolderReorder && handleRowDrop}
      >
        <DropIndicator place={dropPlace} />
        <span
          aria-hidden="true"
          className={`sidebar-caret ${isExpanded ? 'sidebar-caret-expanded' : ''}`}
        />
        {/* A real folder glyph rather than an abstract mark: in a list that
            mixes folders, notes and tags, the icon's job is to say which kind
            of thing this row is, and only a folder shape does that. Hairline
            weight to match the icon rail. */}
        {showShapeMark &&
          (isExpanded ? (
            <FolderOpen
              aria-hidden="true"
              size={13}
              strokeWidth={1.25}
              style={{ color: 'var(--text-muted)', flexShrink: 0 }}
            />
          ) : (
            <Folder
              aria-hidden="true"
              size={13}
              strokeWidth={1.25}
              style={{ color: 'var(--text-muted)', flexShrink: 0 }}
            />
          ))}
        <span className="folder-label text-sm truncate flex-1">{folder.name}</span>
        {folderNotes.length > 0 && (
          <span className="count-badge group-hover:opacity-0 transition-opacity">
            {folderNotes.length}
          </span>
        )}
        <button
          onClick={(e) => {
            e.stopPropagation();
            onContextMenu(e);
          }}
          className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] opacity-0 group-hover:opacity-60 focus-visible:opacity-100 transition-all"
          style={{ color: 'var(--text-muted)' }}
          onMouseEnter={(e) => {
            e.currentTarget.style.color = 'var(--text-primary)';
            e.currentTarget.style.opacity = '1';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.color = 'var(--text-muted)';
            // Clear the inline opacity set on enter. An inline style outranks
            // the classes above, so leaving it behind pins the button visible
            // for good — and since it sits on top of the note count, the count
            // is never seen again either.
            e.currentTarget.style.opacity = '';
          }}
          aria-label="Folder options"
        >
          Options
        </button>
      </div>

      {/* Expanded content: child folders first, then notes */}
      {isExpanded && (
        <div
          className="ml-3 relative animate-expand stagger-children"
          style={{
            marginLeft: `${12 + level * 12}px`,
          }}
        >
          {/* Indent line */}
          <div
            className="absolute left-0 top-0 bottom-0 w-px transition-all duration-200"
            style={{ backgroundColor: 'var(--indent-line)' }}
          />
          {/* Render child folders first */}
          {renderChildren}
          {/* Then render notes in this folder */}
          {folderNotes.map((note, index) => (
            <DraggableNoteItem
              key={note.path}
              note={note}
              isActive={isNoteActive(note)}
              onClick={onNoteClick}
              onSelectionClick={onNoteSelectionClick}
              onContextMenu={onNoteContextMenu}
              level={level + 1}
              tags={getNoteTags?.(note.path)}
              index={index}
              onReorder={onNoteReorder}
            />
          ))}
          {folder.children.length === 0 && folderNotes.length === 0 && (
            <div
              className="flex justify-center py-2"
              style={{ color: 'var(--text-muted)' }}
              aria-label="Empty folder"
            >
              <SignatureMark />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

import React, { useState, useRef } from 'react';
import { ChevronRight, Folder, FolderOpen, MoreHorizontal } from 'lucide-react';
import type { FolderInfo, NoteFile } from '@/types';
import { DraggableNoteItem } from './DraggableNoteItem';

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
  onNoteContextMenu: (e: React.MouseEvent, note: NoteFile) => void;
  renderChildren?: React.ReactNode;
}

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
  onNoteContextMenu,
  renderChildren,
}: FolderItemProps) {
  const [isDragOver, setIsDragOver] = useState(false);
  const dragCounterRef = useRef(0);

  // Handle drag start for this folder
  const handleDragStart = (e: React.DragEvent) => {
    e.stopPropagation(); // Prevent parent folders from also starting drag
    e.dataTransfer.setData('text/plain', folder.path);
    e.dataTransfer.setData('application/x-folder-path', folder.path);
    e.dataTransfer.effectAllowed = 'move';
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
        className="group relative flex items-center gap-1.5 px-2 py-1.5 cursor-pointer transition-colors sidebar-item-animated"
        style={{
          paddingLeft: `${8 + level * 12}px`,
          borderRadius: 'var(--radius-sm)',
          backgroundColor: isDragOver ? 'var(--accent-subtle)' : undefined,
          boxShadow: isDragOver ? '0 0 0 2px var(--accent-primary)' : undefined,
        }}
        onClick={onToggle}
        onContextMenu={onContextMenu}
        draggable
        onDragStart={handleDragStart}
      >
        <ChevronRight
          className={`w-3.5 h-3.5 transition-transform duration-200 flex-shrink-0 ${
            isExpanded ? 'rotate-90' : ''
          }`}
          style={{ color: 'var(--text-tertiary)' }}
        />
        <span
          className="flex items-center justify-center w-5 h-5 flex-shrink-0"
          style={{
            backgroundColor: 'var(--folder-icon-bg)',
            borderRadius: 'var(--radius-sm)',
          }}
        >
          {isExpanded ? (
            <FolderOpen className="w-3.5 h-3.5 text-yellow-500 flex-shrink-0" />
          ) : (
            <Folder className="w-3.5 h-3.5 text-yellow-500 flex-shrink-0" />
          )}
        </span>
        <span
          className="text-sm font-medium truncate flex-1"
          style={{ color: 'var(--text-primary)' }}
        >
          {folder.name}
        </span>
        {folderNotes.length > 0 && (
          <span
            className="text-xs px-1.5 py-0.5 group-hover:opacity-0 transition-opacity"
            style={{
              color: 'var(--text-muted)',
              backgroundColor: 'var(--count-badge-bg)',
              borderRadius: 'var(--radius-sm)',
            }}
          >
            {folderNotes.length}
          </span>
        )}
        <button
          onClick={(e) => {
            e.stopPropagation();
            onContextMenu(e);
          }}
          className="absolute right-2 top-1/2 -translate-y-1/2 p-1 opacity-0 group-hover:opacity-60 transition-all"
          style={{ borderRadius: 'var(--radius-sm)' }}
          onMouseEnter={(e) => {
            e.currentTarget.style.backgroundColor = 'var(--hover-overlay)';
            e.currentTarget.style.opacity = '1';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.backgroundColor = 'transparent';
          }}
          aria-label="Folder options"
        >
          <MoreHorizontal className="w-4 h-4" style={{ color: 'var(--text-tertiary)' }} />
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
          {folderNotes.map((note) => (
            <DraggableNoteItem
              key={note.path}
              note={note}
              isActive={isNoteActive(note)}
              onClick={(e) => onNoteClick(note, e)}
              onContextMenu={(e) => onNoteContextMenu(e, note)}
              level={level + 1}
            />
          ))}
        </div>
      )}
    </div>
  );
}

import React from 'react';
import { Lock, MoreHorizontal } from 'lucide-react';
import type { NoteFile } from '@/types';

interface DraggableNoteItemProps {
  note: NoteFile;
  isActive: boolean;
  onClick: (e: React.MouseEvent) => void;
  onContextMenu: (e: React.MouseEvent) => void;
  level?: number;
}

export function DraggableNoteItem({
  note,
  isActive,
  onClick,
  onContextMenu,
  level = 0,
}: DraggableNoteItemProps) {
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

  return (
    <div
      className="group relative"
      style={{ paddingLeft: level > 0 ? `${level * 12}px` : undefined }}
      onContextMenu={onContextMenu}
      draggable
      onDragStart={handleDragStart}
    >
      <div
        onClick={onClick}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => e.key === 'Enter' && onClick(e as unknown as React.MouseEvent)}
        className="note-card sidebar-item-animated w-full text-left text-sm truncate pr-8 focus-ring cursor-pointer"
        style={{
          color: isActive ? 'var(--accent-primary)' : 'var(--text-primary)',
          borderLeft: isActive ? '2px solid var(--accent-primary)' : '2px solid transparent',
          paddingLeft: '10px',
          marginLeft: '-2px',
        }}
      >
        <span className="flex items-center gap-2">
          {note.isLocked && (
            <Lock className="w-4 h-4 flex-shrink-0" style={{ color: 'var(--warning)' }} />
          )}
          <span className="truncate">{note.name.replace(/\.md$/, '')}</span>
        </span>
      </div>
      <button
        onClick={(e) => {
          e.stopPropagation();
          onContextMenu(e);
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

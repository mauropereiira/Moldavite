import React, { useState, useRef } from 'react';
import { X, FileText, Calendar, Pin } from 'lucide-react';
import { useNoteStore } from '@/stores';
import { useToast } from '@/hooks/useToast';
import type { Note } from '@/types';

/**
 * Formats a note's title for display in a tab.
 * Daily notes show "Today" or a formatted date.
 */
function getTabTitle(note: Note): string {
  if (note.isDaily && note.date) {
    const today = new Date();
    const noteDate = new Date(note.date + 'T00:00:00');

    // Check if it's today
    if (
      noteDate.getFullYear() === today.getFullYear() &&
      noteDate.getMonth() === today.getMonth() &&
      noteDate.getDate() === today.getDate()
    ) {
      return 'Today';
    }

    // Check if it's yesterday
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    if (
      noteDate.getFullYear() === yesterday.getFullYear() &&
      noteDate.getMonth() === yesterday.getMonth() &&
      noteDate.getDate() === yesterday.getDate()
    ) {
      return 'Yesterday';
    }

    // Otherwise show formatted date
    return noteDate.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
    });
  }

  return note.title || 'Untitled';
}

export function TabBar() {
  const { openTabs, activeTabId, switchTab, closeTab, pinTab, reorderTabs } = useNoteStore();
  const toast = useToast();

  // Drag state
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  const dragCounter = useRef(0);

  // Don't render if no tabs
  if (openTabs.length === 0) {
    return null;
  }

  // Separate pinned and regular tabs
  const pinnedTabs = openTabs.filter((t) => t.isPinned);
  const regularTabs = openTabs.filter((t) => !t.isPinned);

  const handleTabClick = (noteId: string) => {
    switchTab(noteId);
  };

  const handleCloseClick = (e: React.MouseEvent, noteId: string) => {
    e.stopPropagation();
    closeTab(noteId);
  };

  const handlePinClick = (e: React.MouseEvent, noteId: string) => {
    e.stopPropagation();
    const result = pinTab(noteId);
    if (!result.success && result.message) {
      toast.error(result.message);
    }
  };

  // Drag handlers
  const handleDragStart = (e: React.DragEvent, index: number) => {
    setDraggedIndex(index);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', String(index));
    // Add drag styling after a brief delay
    requestAnimationFrame(() => {
      (e.target as HTMLElement).classList.add('tab-dragging');
    });
  };

  const handleDragEnd = (e: React.DragEvent) => {
    (e.target as HTMLElement).classList.remove('tab-dragging');
    setDraggedIndex(null);
    setDragOverIndex(null);
    dragCounter.current = 0;
  };

  const handleDragEnter = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    dragCounter.current++;
    if (draggedIndex !== null && draggedIndex !== index) {
      setDragOverIndex(index);
    }
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    dragCounter.current--;
    if (dragCounter.current === 0) {
      setDragOverIndex(null);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  };

  const handleDrop = (e: React.DragEvent, toIndex: number) => {
    e.preventDefault();
    if (draggedIndex !== null && draggedIndex !== toIndex) {
      reorderTabs(draggedIndex, toIndex);
    }
    setDraggedIndex(null);
    setDragOverIndex(null);
    dragCounter.current = 0;
  };

  // Render a single tab
  const renderTab = (note: Note, index: number, isPinned: boolean) => {
    const isActive = note.id === activeTabId;
    const title = getTabTitle(note);
    const isDragOver = dragOverIndex === index;

    return (
      <div
        key={note.id}
        className={`
          tab select-none
          ${isActive ? 'active' : ''}
          ${isPinned ? 'tab-pinned' : ''}
          ${isDragOver ? 'tab-drag-over' : ''}
        `}
        onClick={() => handleTabClick(note.id)}
        title={note.title}
        draggable
        onDragStart={(e) => handleDragStart(e, index)}
        onDragEnd={handleDragEnd}
        onDragEnter={(e) => handleDragEnter(e, index)}
        onDragLeave={handleDragLeave}
        onDragOver={handleDragOver}
        onDrop={(e) => handleDrop(e, index)}
      >
        {/* Icon */}
        <span className="tab-icon">
          {note.isDaily ? (
            <Calendar className="w-3.5 h-3.5" />
          ) : (
            <FileText className="w-3.5 h-3.5" />
          )}
        </span>

        {/* Title - only show for non-pinned tabs */}
        {!isPinned && <span className="tab-title">{title}</span>}

        {/* Pin button - only show for non-pinned tabs */}
        {!isPinned && (
          <button
            className="tab-pin"
            onClick={(e) => handlePinClick(e, note.id)}
            aria-label={`Pin ${title}`}
          >
            <Pin className="w-3 h-3" />
          </button>
        )}

        {/* Close button - only show for non-pinned tabs */}
        {!isPinned && (
          <button
            className="tab-close"
            onClick={(e) => handleCloseClick(e, note.id)}
            aria-label={`Close ${title}`}
          >
            <X className="w-3.5 h-3.5" />
          </button>
        )}

        {/* For pinned tabs, show unpin on hover */}
        {isPinned && (
          <button
            className="tab-unpin"
            onClick={(e) => handlePinClick(e, note.id)}
            aria-label={`Unpin ${title}`}
          >
            <Pin className="w-3 h-3" />
          </button>
        )}
      </div>
    );
  };

  return (
    <div className="tab-bar select-none">
      {/* Pinned tabs zone */}
      {pinnedTabs.length > 0 && (
        <>
          <div className="pinned-tabs">
            {pinnedTabs.map((note, i) => renderTab(note, i, true))}
          </div>
          <div className="tabs-divider" />
        </>
      )}

      {/* Regular tabs zone */}
      <div className="regular-tabs">
        {regularTabs.map((note, i) => renderTab(note, pinnedTabs.length + i, false))}
      </div>
    </div>
  );
}

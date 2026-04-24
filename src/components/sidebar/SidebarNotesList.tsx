import { ArrowUpAZ, ArrowDownAZ } from 'lucide-react';
import { SidebarSection } from './SidebarSection';
import { DraggableNoteItem } from './DraggableNoteItem';
import { NoNotesEmptyState } from '@/components/ui';
import type { NoteFile } from '@/types';

interface SidebarNotesListProps {
  /** Notes to render — unfiled (no folderPath, not daily/weekly) */
  notes: NoteFile[];
  /** Whether the section is collapsed */
  isCollapsed: boolean;
  onToggleSection: () => void;
  /** Full count label (may differ from notes.length when filtered) */
  count: number;
  title: string;
  sortOption: 'name-asc' | 'name-desc';
  onSortToggle: () => void;
  onNewNote: () => void;
  onNoteClick: (note: NoteFile, e: React.MouseEvent) => void;
  onNoteContextMenu: (note: NoteFile, e: React.MouseEvent) => void;
  isNoteActive: (note: NoteFile) => boolean;
  getNoteTags?: (notePath: string) => string[];
  /** Drag-over state for the root drop zone */
  isDragOverRoot: boolean;
  onRootDragEnter: (e: React.DragEvent) => void;
  onRootDragOver: (e: React.DragEvent) => void;
  onRootDragLeave: (e: React.DragEvent) => void;
  onRootDrop: (e: React.DragEvent) => void;
  /** Shown when the list is empty AND no tag filter is active */
  showEmptyState: boolean;
  /** Shown when the list is empty AND a tag filter is active */
  showFilteredEmptyState: boolean;
  filteredEmptyTagCount: number;
}

/**
 * The "Notes" sidebar section — standalone notes not in any folder and
 * not daily/weekly. Mirrors the prior inline JSX from Sidebar.tsx with
 * no behavior change (refactor only).
 */
export function SidebarNotesList({
  notes,
  isCollapsed,
  onToggleSection,
  count,
  title,
  sortOption,
  onSortToggle,
  onNewNote,
  onNoteClick,
  onNoteContextMenu,
  isNoteActive,
  getNoteTags,
  isDragOverRoot,
  onRootDragEnter,
  onRootDragOver,
  onRootDragLeave,
  onRootDrop,
  showEmptyState,
  showFilteredEmptyState,
  filteredEmptyTagCount,
}: SidebarNotesListProps) {
  return (
    <SidebarSection
      title={title}
      isCollapsed={isCollapsed}
      onToggle={onToggleSection}
      count={count}
      rightAction={
        <div className="flex items-center gap-0.5">
          <button
            onClick={onSortToggle}
            className="p-1 transition-colors"
            style={{ color: 'var(--text-muted)' }}
            onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--text-primary)')}
            onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--text-muted)')}
            title={sortOption === 'name-asc' ? 'Sort Z-A' : 'Sort A-Z'}
          >
            {sortOption === 'name-asc' ? (
              <ArrowUpAZ className="w-4 h-4" />
            ) : (
              <ArrowDownAZ className="w-4 h-4" />
            )}
          </button>
          <button
            onClick={onNewNote}
            className="p-1 transition-colors"
            style={{ color: 'var(--text-muted)' }}
            onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--text-primary)')}
            onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--text-muted)')}
            title="New note"
          >
            <svg
              className="w-4 h-4"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 4v16m8-8H4"
              />
            </svg>
          </button>
        </div>
      }
    >
      <div
        className="px-3 space-y-1 min-h-[20px] transition-colors"
        style={{
          borderRadius: 'var(--radius-sm)',
          backgroundColor: isDragOverRoot ? 'var(--accent-subtle)' : 'transparent',
          boxShadow: isDragOverRoot ? '0 0 0 2px var(--accent-primary)' : 'none',
        }}
        onDragEnter={onRootDragEnter}
        onDragOver={onRootDragOver}
        onDragLeave={onRootDragLeave}
        onDrop={onRootDrop}
      >
        {notes.map((note) => (
          <DraggableNoteItem
            key={note.path}
            note={note}
            isActive={isNoteActive(note)}
            onClick={onNoteClick}
            onContextMenu={onNoteContextMenu}
            tags={getNoteTags ? getNoteTags(note.path) : undefined}
          />
        ))}
        {showEmptyState && <NoNotesEmptyState onCreateNote={onNewNote} />}
        {showFilteredEmptyState && (
          <p className="px-3 py-2 text-sm" style={{ color: 'var(--text-muted)' }}>
            No notes match the selected {filteredEmptyTagCount === 1 ? 'tag' : 'tags'}
          </p>
        )}
      </div>
    </SidebarSection>
  );
}

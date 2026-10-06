import { SidebarSection } from './SidebarSection';
import { DraggableNoteItem } from './DraggableNoteItem';
import type { NoteFile } from '@/types';
import type { DropPlace } from '@/stores/sidebarOrderStore';
import type { SortOption } from '@/stores/settingsStore';
import { SignatureEmptyState } from '@/components/ui/SignatureMark';

interface SidebarNotesListProps {
  /** Notes to render — unfiled (no folderPath, not daily/weekly) */
  notes: NoteFile[];
  /** Whether the section is collapsed */
  isCollapsed: boolean;
  onToggleSection: () => void;
  /** Full count label (may differ from notes.length when filtered) */
  count: number;
  title: string;
  sortOption: SortOption;
  onSortToggle: () => void;
  onNewNote: () => void;
  onNoteClick: (note: NoteFile, e: React.MouseEvent) => void;
  onNoteSelectionClick?: (note: NoteFile, e: React.MouseEvent) => void;
  onNoteContextMenu: (note: NoteFile, e: React.MouseEvent) => void;
  isNoteActive: (note: NoteFile) => boolean;
  getNoteTags?: (notePath: string) => string[];
  /** Manual sort only — drop a note onto another to take its place. */
  onNoteReorder?: (draggedPath: string, targetPath: string, place: DropPlace) => void;
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

const SORT_LABELS: Record<SortOption, string> = {
  'name-asc': 'A–Z',
  'name-desc': 'Z–A',
  manual: 'Manual',
  'modified-desc': 'Modified (newest)',
  'modified-asc': 'Modified (oldest)',
  'created-desc': 'Created (newest)',
  'created-asc': 'Created (oldest)',
};

export function nextSortToggle(option: SortOption): SortOption {
  if (option === 'name-desc') return 'manual';
  if (option === 'manual') return 'name-asc';
  return 'name-desc';
}

/**
 * The "Notes" sidebar section — standalone notes not in any folder and
 * not daily/weekly.
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
  onNoteSelectionClick,
  onNoteContextMenu,
  isNoteActive,
  getNoteTags,
  onNoteReorder,
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
        <div className="flex items-center gap-2">
          <button
            onClick={onSortToggle}
            className="transition-colors"
            style={{ color: 'var(--text-muted)' }}
            onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--text-primary)')}
            onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--text-muted)')}
            aria-label={`Sort: ${SORT_LABELS[sortOption]}`}
            title={`Switch to ${SORT_LABELS[nextSortToggle(sortOption)]}`}
          >
            {SORT_LABELS[sortOption]}
          </button>
          <button
            onClick={onNewNote}
            className="transition-colors"
            style={{ color: 'var(--text-muted)' }}
            onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--text-primary)')}
            onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--text-muted)')}
            title="New note"
          >
            New
          </button>
        </div>
      }
    >
      <div
        className="px-3 min-h-[20px] transition-colors"
        style={{
          borderBottom: `1px solid ${isDragOverRoot ? 'var(--border-strong)' : 'transparent'}`,
        }}
        onDragEnter={onRootDragEnter}
        onDragOver={onRootDragOver}
        onDragLeave={onRootDragLeave}
        onDrop={onRootDrop}
      >
        {notes.map((note, index) => (
          <DraggableNoteItem
            key={note.path}
            note={note}
            isActive={isNoteActive(note)}
            onClick={onNoteClick}
            onSelectionClick={onNoteSelectionClick}
            onContextMenu={onNoteContextMenu}
            tags={getNoteTags ? getNoteTags(note.path) : undefined}
            index={index}
            onReorder={onNoteReorder}
          />
        ))}
        {showEmptyState && (
          <SignatureEmptyState className="px-3 py-2 text-xs">
            <div>
              <span>No notes yet.</span>{' '}
              <button
                onClick={onNewNote}
                className="pad-hover-inline"
                style={{ color: 'var(--text-secondary)' }}
              >
                Create note
              </button>
            </div>
          </SignatureEmptyState>
        )}
        {showFilteredEmptyState && (
          <SignatureEmptyState className="px-3 py-2 text-sm">
            <p>No notes match the selected {filteredEmptyTagCount === 1 ? 'tag' : 'tags'}</p>
          </SignatureEmptyState>
        )}
      </div>
    </SidebarSection>
  );
}

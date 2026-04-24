import { SidebarSection } from './SidebarSection';
import { DraggableNoteItem } from './DraggableNoteItem';
import type { NoteFile } from '@/types';

interface SidebarDailyListProps {
  notes: NoteFile[];
  isCollapsed: boolean;
  onToggleSection: () => void;
  onNoteClick: (note: NoteFile, e: React.MouseEvent) => void;
  onNoteContextMenu: (note: NoteFile, e: React.MouseEvent) => void;
  isNoteActive: (note: NoteFile) => boolean;
  /** Callback when the user clicks the "Today" shortcut in the section header */
  onOpenToday: () => void;
}

/**
 * The "Daily" sidebar section — shows daily notes sorted newest first.
 * Click the small "Today" affordance in the header to jump to today's note.
 */
export function SidebarDailyList({
  notes,
  isCollapsed,
  onToggleSection,
  onNoteClick,
  onNoteContextMenu,
  isNoteActive,
  onOpenToday,
}: SidebarDailyListProps) {
  // Sort daily notes newest first by date/name
  const sorted = [...notes].sort((a, b) => {
    const ad = a.date ?? a.name;
    const bd = b.date ?? b.name;
    return bd.localeCompare(ad);
  });

  return (
    <SidebarSection
      title="Daily"
      isCollapsed={isCollapsed}
      onToggle={onToggleSection}
      count={sorted.length}
      rightAction={
        <button
          onClick={onOpenToday}
          className="p-1 transition-colors text-[10px] font-semibold uppercase tracking-wide"
          style={{ color: 'var(--text-muted)' }}
          onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--text-primary)')}
          onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--text-muted)')}
          title="Open today's daily note"
        >
          Today
        </button>
      }
    >
      <div className="px-3 space-y-1 min-h-[20px]">
        {sorted.length === 0 ? (
          <p className="px-3 py-2 text-sm" style={{ color: 'var(--text-muted)' }}>
            No daily notes yet
          </p>
        ) : (
          sorted.map((note) => (
            <DraggableNoteItem
              key={note.path}
              note={note}
              isActive={isNoteActive(note)}
              onClick={onNoteClick}
              onContextMenu={onNoteContextMenu}
            />
          ))
        )}
      </div>
    </SidebarSection>
  );
}

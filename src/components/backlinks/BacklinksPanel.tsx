import { useMemo, useState } from 'react';
import { ChevronRight, FileText } from 'lucide-react';
import { useNoteStore } from '@/stores';
import { useNotes } from '@/hooks';
import { useBacklinks, type Backlink } from '@/hooks/useBacklinks';
import type { NoteFile } from '@/types';

/**
 * Collapsible "Linked mentions" panel mounted below the editor scroll area.
 *
 * Lists notes that contain a `[[wiki-link]]` pointing at the current note.
 * Collapsed by default with a count badge. Refreshes (debounced) each time
 * `isSaving` transitions false → true or the current note changes.
 */
export function BacklinksPanel() {
  const { currentNote, notes, isSaving } = useNoteStore();
  const { loadNote } = useNotes();
  const [isExpanded, setIsExpanded] = useState(false);

  // Resolve current note → backend filename (backend's get_backlinks wants the
  // exact filename including .md). For daily / weekly notes the filename
  // derives from date / week; for standalone notes, use the last path segment.
  const filename = useMemo<string | null>(() => {
    if (!currentNote) return null;
    if (currentNote.isDaily && currentNote.date) return `${currentNote.date}.md`;
    if (currentNote.isWeekly && currentNote.week) return `${currentNote.week}.md`;
    // currentNote.id is the full path (e.g. "notes/folder/foo.md"); the backend
    // scans by filename-only match, so strip any leading folder prefix.
    const segments = currentNote.id.split('/');
    return segments[segments.length - 1] || null;
  }, [currentNote]);

  // Toggling isSaving gives us a natural "after every save" refresh trigger.
  // We rely on the hook's internal debounce (500ms) to coalesce bursts.
  const refreshKey = `${filename ?? ''}:${isSaving ? '1' : '0'}`;
  const { backlinks, loading } = useBacklinks(filename, refreshKey);

  const handleRowClick = (bl: Backlink) => {
    const target: NoteFile | undefined = notes.find((n) => n.name === bl.fromNote);
    if (target) {
      loadNote(target);
    }
  };

  if (!currentNote) return null;

  const count = backlinks.length;

  return (
    <div
      className="flex-shrink-0"
      style={{ borderTop: '1px solid var(--border-default)', backgroundColor: 'var(--bg-panel)' }}
    >
      <button
        type="button"
        onClick={() => setIsExpanded((v) => !v)}
        className="w-full px-4 py-2 flex items-center justify-between text-xs transition-colors"
        style={{ color: 'var(--text-secondary)' }}
        onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = 'var(--hover-overlay)')}
        onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
        aria-expanded={isExpanded}
      >
        <span className="flex items-center gap-2">
          <ChevronRight
            className="w-3.5 h-3.5 transition-transform"
            style={{
              color: 'var(--text-muted)',
              transform: isExpanded ? 'rotate(90deg)' : 'rotate(0deg)',
            }}
          />
          <span>
            {'↖ Linked mentions '}
            <span style={{ color: 'var(--text-muted)' }}>({loading ? '…' : count})</span>
          </span>
        </span>
      </button>

      {isExpanded && (
        <div className="px-4 pb-3 pt-1 space-y-1 max-h-64 overflow-y-auto">
          {loading && count === 0 ? (
            <div className="py-2 text-xs" style={{ color: 'var(--text-muted)' }}>
              Scanning…
            </div>
          ) : count === 0 ? (
            <div className="py-2 text-xs" style={{ color: 'var(--text-muted)' }}>
              No notes link here yet.
            </div>
          ) : (
            backlinks.map((bl) => (
              <BacklinkRow key={`${bl.fromNote}:${bl.context}`} backlink={bl} onClick={() => handleRowClick(bl)} />
            ))
          )}
        </div>
      )}
    </div>
  );
}

interface BacklinkRowProps {
  backlink: Backlink;
  onClick: () => void;
}

function BacklinkRow({ backlink, onClick }: BacklinkRowProps) {
  const title = backlink.fromNote.replace(/\.md$/i, '');
  const snippet = renderSnippet(backlink.context);

  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full text-left px-2 py-1.5 rounded transition-colors flex items-start gap-2"
      style={{ backgroundColor: 'transparent' }}
      onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = 'var(--hover-overlay)')}
      onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
    >
      <FileText
        className="w-3.5 h-3.5 mt-0.5 flex-shrink-0"
        style={{ color: 'var(--text-muted)' }}
      />
      <span className="flex-1 min-w-0">
        <span
          className="block text-sm font-medium truncate"
          style={{ color: 'var(--text-primary)' }}
        >
          {title}
        </span>
        <span
          className="block text-xs mt-0.5 line-clamp-2"
          style={{ color: 'var(--text-muted)' }}
        >
          {snippet}
        </span>
      </span>
    </button>
  );
}

/**
 * Render a backlink snippet with any `[[wiki-links]]` visually emphasized.
 * Returns a fragment of alternating plain text and styled spans.
 */
function renderSnippet(context: string): React.ReactNode {
  if (!context) return null;
  const parts: React.ReactNode[] = [];
  const regex = /\[\[([^\]]+)\]\]/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let key = 0;
  while ((match = regex.exec(context)) !== null) {
    if (match.index > lastIndex) {
      parts.push(context.slice(lastIndex, match.index));
    }
    parts.push(
      <span
        key={`link-${key++}`}
        style={{ color: 'var(--accent-primary)', fontWeight: 500 }}
      >
        [[{match[1]}]]
      </span>
    );
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < context.length) {
    parts.push(context.slice(lastIndex));
  }
  return parts.length > 0 ? parts : context;
}

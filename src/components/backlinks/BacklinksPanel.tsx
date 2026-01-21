import { useState, useEffect, useMemo } from 'react';
import { Link2, ChevronDown, ChevronRight, FileText, Calendar } from 'lucide-react';
import { useNoteStore } from '@/stores';
import { useNotes } from '@/hooks';
import { findBacklinks, readNote, type BacklinkInfo } from '@/lib';
import type { NoteFile } from '@/types';

interface BacklinksPanelProps {
  notes: NoteFile[];
}

/**
 * Panel showing all notes that link to the current note.
 * Displays in the right panel below the calendar/timeline.
 */
export function BacklinksPanel({ notes }: BacklinksPanelProps) {
  const { currentNote } = useNoteStore();
  const { loadNote } = useNotes();
  const [isExpanded, setIsExpanded] = useState(true);
  const [backlinks, setBacklinks] = useState<BacklinkInfo[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [noteContents, setNoteContents] = useState<Map<string, string>>(new Map());

  // Build note info map
  const noteInfo = useMemo(() => {
    const map = new Map<string, { name: string; isDaily: boolean }>();
    for (const note of notes) {
      map.set(note.path, { name: note.name, isDaily: note.isDaily || false });
    }
    return map;
  }, [notes]);

  // Load note contents for backlink detection
  useEffect(() => {
    const loadContents = async () => {
      const contents = new Map<string, string>();

      for (const note of notes) {
        if (note.isLocked) continue;

        try {
          const content = await readNote(note.name, note.isDaily || false);
          contents.set(note.path, content);
        } catch {
          // Skip notes we can't read
        }
      }

      setNoteContents(contents);
    };

    loadContents();
  }, [notes]);

  // Find backlinks when current note changes
  useEffect(() => {
    if (!currentNote || noteContents.size === 0) {
      setBacklinks([]);
      return;
    }

    setIsLoading(true);

    // Use setTimeout to avoid blocking UI
    const timer = setTimeout(() => {
      // Use title for matching (Note type has title, not name)
      const links = findBacklinks(currentNote.title, noteContents, noteInfo);
      setBacklinks(links);
      setIsLoading(false);
    }, 0);

    return () => clearTimeout(timer);
  }, [currentNote, noteContents, noteInfo]);

  // Handle clicking a backlink
  const handleBacklinkClick = (backlink: BacklinkInfo) => {
    const note = notes.find(n => n.path === backlink.sourcePath);
    if (note) {
      loadNote(note);
    }
  };

  // Don't show panel if no note is selected
  if (!currentNote) {
    return null;
  }

  return (
    <div
      className="border-t"
      style={{ borderColor: 'var(--border-default)' }}
    >
      {/* Header */}
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full px-4 py-3 flex items-center justify-between text-sm font-medium transition-colors"
        style={{ color: 'var(--text-primary)' }}
        onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'var(--hover-overlay)'}
        onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
      >
        <span className="flex items-center gap-2">
          {isExpanded ? (
            <ChevronDown className="w-4 h-4" style={{ color: 'var(--text-muted)' }} />
          ) : (
            <ChevronRight className="w-4 h-4" style={{ color: 'var(--text-muted)' }} />
          )}
          <Link2 className="w-4 h-4" style={{ color: 'var(--accent-primary)' }} />
          Backlinks
        </span>
        <span
          className="px-2 py-0.5 text-xs font-medium rounded"
          style={{
            backgroundColor: backlinks.length > 0 ? 'var(--accent-subtle)' : 'var(--bg-inset)',
            color: backlinks.length > 0 ? 'var(--accent-primary)' : 'var(--text-muted)',
          }}
        >
          {isLoading ? '...' : backlinks.length}
        </span>
      </button>

      {/* Content */}
      {isExpanded && (
        <div className="px-4 pb-3">
          {isLoading ? (
            <div className="py-2 text-xs" style={{ color: 'var(--text-muted)' }}>
              Scanning notes...
            </div>
          ) : backlinks.length === 0 ? (
            <div className="py-2 text-xs" style={{ color: 'var(--text-muted)' }}>
              No notes link to this note yet.
            </div>
          ) : (
            <div className="space-y-1">
              {backlinks.map((backlink) => (
                <button
                  key={backlink.sourcePath}
                  onClick={() => handleBacklinkClick(backlink)}
                  className="w-full flex items-center gap-2 px-2 py-1.5 text-sm text-left rounded transition-all"
                  style={{
                    color: 'var(--text-secondary)',
                    backgroundColor: 'transparent',
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.backgroundColor = 'var(--hover-overlay)';
                    e.currentTarget.style.color = 'var(--text-primary)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.backgroundColor = 'transparent';
                    e.currentTarget.style.color = 'var(--text-secondary)';
                  }}
                >
                  {backlink.isDaily ? (
                    <Calendar className="w-3.5 h-3.5 flex-shrink-0" style={{ color: 'var(--accent-primary)' }} />
                  ) : (
                    <FileText className="w-3.5 h-3.5 flex-shrink-0" style={{ color: 'var(--text-muted)' }} />
                  )}
                  <span className="truncate">{backlink.sourceName}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

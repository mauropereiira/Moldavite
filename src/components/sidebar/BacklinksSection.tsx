import { useState, useEffect, useMemo } from 'react';
import { CollapsibleSection } from './CollapsibleSection';
import { useNoteStore } from '@/stores';
import { findBacklinks, readNote, noteFileBackendPath, type BacklinkInfo } from '@/lib';
import type { NoteFile } from '@/types';
import { SignatureEmptyState } from '@/components/ui/SignatureMark';

interface BacklinksSectionProps {
  notes: NoteFile[];
  isCollapsed: boolean;
  onToggle: () => void;
  onNoteClick: (note: NoteFile) => void;
}

/**
 * Sidebar section showing notes that link to the current note.
 */
export function BacklinksSection({
  notes,
  isCollapsed,
  onToggle,
  onNoteClick,
}: BacklinksSectionProps) {
  const { currentNote } = useNoteStore();
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
          const content = await readNote(noteFileBackendPath(note), note.isDaily || false);
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
      const links = findBacklinks(currentNote.title, noteContents, noteInfo);
      setBacklinks(links);
      setIsLoading(false);
    }, 0);

    return () => clearTimeout(timer);
  }, [currentNote, noteContents, noteInfo]);

  // Handle clicking a backlink
  const handleBacklinkClick = (backlink: BacklinkInfo) => {
    const note = notes.find((n) => n.path === backlink.sourcePath);
    if (note) {
      onNoteClick(note);
    }
  };

  // Don't show section if no note is selected
  if (!currentNote) {
    return null;
  }

  return (
    <CollapsibleSection
      title="Backlinks"
      isCollapsed={isCollapsed}
      onToggle={onToggle}
      count={backlinks.length}
    >
      <div className="px-3">
        {isLoading ? (
          <div className="py-2 text-xs" style={{ color: 'var(--text-muted)' }}>
            Scanning notes...
          </div>
        ) : backlinks.length === 0 ? (
          <SignatureEmptyState className="px-3 py-2 text-xs">
            <span>No backlinks yet.</span>
          </SignatureEmptyState>
        ) : (
          backlinks.map((backlink) => (
            <button
              key={backlink.sourcePath}
              onClick={() => handleBacklinkClick(backlink)}
              className="sidebar-item sidebar-item-animated w-full px-3 py-1.5 text-sm text-left"
            >
              <span className="truncate">{backlink.sourceName}</span>
            </button>
          ))
        )}
      </div>
    </CollapsibleSection>
  );
}

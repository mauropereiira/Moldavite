import { useState, useEffect, useMemo } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { CollapsibleSection } from './CollapsibleSection';
import { useNoteStore } from '@/stores';
import { findBacklinks, readNoteSnapshot, noteFileBackendPath, type BacklinkInfo } from '@/lib';
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
  // Only id (presence) and title (backlink matching) are read, so a
  // content-only edit in the editor does not re-render this section.
  const { currentNoteId, currentNoteTitle } = useNoteStore(
    useShallow((state) => ({
      currentNoteId: state.currentNote?.id ?? null,
      currentNoteTitle: state.currentNote?.title ?? null,
    }))
  );
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
    let cancelled = false;

    const loadContents = async () => {
      const contents = new Map<string, string>();

      for (const note of notes) {
        if (note.isLocked) continue;

        try {
          // Snapshot read: scanning for backlinks must not adopt the note's
          // save baseline, or a later save could overwrite an external edit
          // without preserving it as a conflict copy.
          const { content } = await readNoteSnapshot(
            noteFileBackendPath(note),
            note.isDaily || false,
            note.isWeekly || false
          );
          contents.set(note.path, content);
        } catch {
          // Skip notes we can't read
        }
        if (cancelled) return;
      }

      if (!cancelled) setNoteContents(contents);
    };

    loadContents();
    return () => {
      cancelled = true;
    };
  }, [notes]);

  // The result carries the inputs it was computed from, so a result belonging
  // to an earlier note or an earlier scan is recognised as stale during render
  // instead of being cleared from an effect.
  const [computed, setComputed] = useState<{
    title: string;
    contents: Map<string, string>;
    info: typeof noteInfo;
    links: BacklinkInfo[];
  } | null>(null);
  const isFresh =
    computed !== null &&
    computed.title === currentNoteTitle &&
    computed.contents === noteContents &&
    computed.info === noteInfo;
  const backlinks = isFresh ? computed.links : [];
  const isLoading = Boolean(currentNoteTitle) && noteContents.size > 0 && !isFresh;

  // Find backlinks when current note changes
  useEffect(() => {
    if (!currentNoteTitle || noteContents.size === 0) return;

    // Use setTimeout to avoid blocking UI
    const timer = setTimeout(() => {
      setComputed({
        title: currentNoteTitle,
        contents: noteContents,
        info: noteInfo,
        links: findBacklinks(currentNoteTitle, noteContents, noteInfo),
      });
    }, 0);

    return () => clearTimeout(timer);
  }, [currentNoteTitle, noteContents, noteInfo]);

  // Handle clicking a backlink
  const handleBacklinkClick = (backlink: BacklinkInfo) => {
    const note = notes.find((n) => n.path === backlink.sourcePath);
    if (note) {
      onNoteClick(note);
    }
  };

  // Don't show section if no note is selected
  if (!currentNoteId) {
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

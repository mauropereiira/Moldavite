import { useEffect, useRef, useState, useCallback } from 'react';
import { Search, FileText, Calendar } from 'lucide-react';
import { useQuickSwitcherStore } from '@/stores/quickSwitcherStore';
import { useNoteStore } from '@/stores/noteStore';
import { useNotes } from '@/hooks/useNotes';
import type { NoteFile } from '@/types';

/**
 * Fuzzy match: checks if query characters appear in order within the title.
 * "mtg" matches "Meeting Notes"
 */
function fuzzyMatch(query: string, title: string): { matches: boolean; indices: number[] } {
  const indices: number[] = [];
  let queryIndex = 0;
  const lowerQuery = query.toLowerCase();
  const lowerTitle = title.toLowerCase();

  for (let i = 0; i < lowerTitle.length && queryIndex < lowerQuery.length; i++) {
    if (lowerTitle[i] === lowerQuery[queryIndex]) {
      indices.push(i);
      queryIndex++;
    }
  }

  return {
    matches: queryIndex === lowerQuery.length,
    indices,
  };
}

/**
 * Get display title from note file name
 */
function getNoteTitle(noteFile: NoteFile): string {
  // Strip .md extension
  return noteFile.name.replace(/\.md$/, '');
}

/**
 * Get note type label
 */
function getNoteTypeLabel(noteFile: NoteFile): string {
  if (noteFile.isDaily) return 'Daily';
  if (noteFile.isWeekly) return 'Weekly';
  return 'Note';
}

/**
 * Highlight matched characters in the title
 */
function HighlightedTitle({ title, indices }: { title: string; indices: number[] }) {
  const chars = title.split('');
  const indexSet = new Set(indices);

  return (
    <span>
      {chars.map((char, i) => (
        <span
          key={i}
          className={indexSet.has(i) ? 'quick-switcher-match' : ''}
        >
          {char}
        </span>
      ))}
    </span>
  );
}

interface QuickSwitcherItemProps {
  note: NoteFile;
  isSelected: boolean;
  matchIndices: number[];
  onClick: () => void;
  onMouseEnter: () => void;
}

function QuickSwitcherItem({
  note,
  isSelected,
  matchIndices,
  onClick,
  onMouseEnter,
}: QuickSwitcherItemProps) {
  const title = getNoteTitle(note);
  const typeLabel = getNoteTypeLabel(note);

  return (
    <button
      className={`quick-switcher-item ${isSelected ? 'quick-switcher-item-selected' : ''}`}
      onClick={onClick}
      onMouseEnter={onMouseEnter}
    >
      <div className="quick-switcher-item-icon">
        {note.isDaily || note.isWeekly ? (
          <Calendar className="w-4 h-4" />
        ) : (
          <FileText className="w-4 h-4" />
        )}
      </div>
      <div className="quick-switcher-item-content">
        <div className="quick-switcher-item-title">
          <HighlightedTitle title={title} indices={matchIndices} />
        </div>
        <div className="quick-switcher-item-meta">
          {typeLabel}
        </div>
      </div>
    </button>
  );
}

export function QuickSwitcher() {
  const { isOpen, close } = useQuickSwitcherStore();
  const { recentNoteIds } = useNoteStore();
  const { notes, loadNote } = useNotes();

  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Filter and sort notes based on query
  const filteredNotes = useCallback(() => {
    if (!query.trim()) {
      // Show recent notes when query is empty
      const recentNotes: NoteFile[] = [];
      for (const id of recentNoteIds) {
        const note = notes.find((n) => n.path === id);
        if (note) recentNotes.push(note);
      }
      // Fill remaining slots with other notes
      const remaining = notes
        .filter((n) => !recentNoteIds.includes(n.path))
        .slice(0, 7 - recentNotes.length);
      return [...recentNotes, ...remaining].map((note) => ({
        note,
        indices: [] as number[],
      }));
    }

    // Fuzzy search by title (derived from name)
    const matches = notes
      .map((note) => {
        const title = getNoteTitle(note);
        const { matches, indices } = fuzzyMatch(query, title);
        return { note, matches, indices };
      })
      .filter((item) => item.matches)
      .sort((a, b) => {
        // Prioritize matches at the start
        const aStartMatch = a.indices[0] === 0 ? 0 : 1;
        const bStartMatch = b.indices[0] === 0 ? 0 : 1;
        return aStartMatch - bStartMatch;
      });

    return matches.map(({ note, indices }) => ({ note, indices }));
  }, [query, notes, recentNoteIds]);

  const results = filteredNotes();

  // Reset selection when query changes
  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  // Auto-focus input when opened
  useEffect(() => {
    if (isOpen) {
      setQuery('');
      setSelectedIndex(0);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [isOpen]);

  // Handle keyboard navigation
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault();
          setSelectedIndex((i) => Math.min(i + 1, results.length - 1));
          break;
        case 'ArrowUp':
          e.preventDefault();
          setSelectedIndex((i) => Math.max(i - 1, 0));
          break;
        case 'Enter':
          e.preventDefault();
          if (results[selectedIndex]) {
            selectNote(results[selectedIndex].note);
          }
          break;
        case 'Escape':
          e.preventDefault();
          close();
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, results, selectedIndex, close]);

  // Click outside to close
  useEffect(() => {
    if (!isOpen) return;

    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        close();
      }
    };

    // Delay to avoid closing on the same click that opened
    setTimeout(() => {
      document.addEventListener('mousedown', handleClickOutside);
    }, 0);

    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen, close]);

  const selectNote = async (noteFile: NoteFile) => {
    close();
    try {
      await loadNote(noteFile);
    } catch (error) {
      console.error('[QuickSwitcher] Failed to load note:', error);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="quick-switcher-backdrop">
      <div ref={containerRef} className="quick-switcher-container">
        <div className="quick-switcher-input-wrapper">
          <Search className="quick-switcher-search-icon" />
          <input
            ref={inputRef}
            type="text"
            className="quick-switcher-input"
            placeholder="Search notes..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>

        <div className="quick-switcher-results">
          {results.length === 0 ? (
            <div className="quick-switcher-empty">
              No notes found
            </div>
          ) : (
            results.map((result, index) => (
              <QuickSwitcherItem
                key={result.note.path}
                note={result.note}
                isSelected={index === selectedIndex}
                matchIndices={result.indices}
                onClick={() => selectNote(result.note)}
                onMouseEnter={() => setSelectedIndex(index)}
              />
            ))
          )}
        </div>

        <div className="quick-switcher-footer">
          <span><kbd>↑↓</kbd> navigate</span>
          <span><kbd>↵</kbd> open</span>
          <span><kbd>esc</kbd> close</span>
        </div>
      </div>
    </div>
  );
}

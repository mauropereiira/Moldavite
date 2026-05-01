import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import {
  Search,
  FileText,
  Calendar,
  Star,
  Settings as SettingsIcon,
  Sun,
  Plus,
  FileStack,
  Network,
  Clock,
  Keyboard,
  History,
  Pin,
  Command as CommandIcon,
} from 'lucide-react';
import { useQuickSwitcherStore } from '@/stores/quickSwitcherStore';
import { useNoteStore } from '@/stores/noteStore';
import { useThemeStore } from '@/stores/themeStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { useTimelineStore } from '@/stores/timelineStore';
import { useGraphStore } from '@/stores/graphStore';
import { useNotes } from '@/hooks/useNotes';
import {
  filterCommands,
  commandCategoryLabel,
  type QuickSwitcherCommand,
} from './commands';
import type { NoteFile } from '@/types';

/**
 * Fuzzy match: checks if query characters appear in order within the title.
 * "mtg" matches "Meeting Notes"
 */
function fuzzyMatch(
  query: string,
  title: string,
): { matches: boolean; indices: number[] } {
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

function getNoteTitle(noteFile: NoteFile): string {
  return noteFile.name.replace(/\.md$/, '');
}

function getNoteTypeLabel(noteFile: NoteFile): string {
  if (noteFile.isDaily) return 'Daily';
  if (noteFile.isWeekly) return 'Weekly';
  return 'Note';
}

function HighlightedTitle({
  title,
  indices,
}: {
  title: string;
  indices: number[];
}) {
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

/**
 * Dispatch a synthetic Cmd+key event so we can reuse the existing global
 * keyboard handlers (e.g. ShortcutHelpHost / template picker) without
 * duplicating their state plumbing here.
 */
function dispatchModKey(key: string) {
  const event = new KeyboardEvent('keydown', {
    key,
    metaKey: true,
    ctrlKey: true,
    bubbles: true,
    cancelable: true,
  });
  window.dispatchEvent(event);
}

/** Discriminated union for unified keyboard navigation across rows. */
type Row =
  | { kind: 'note'; note: NoteFile; indices: number[]; isPinned?: boolean }
  | { kind: 'command'; command: QuickSwitcherCommand; titleIndices: number[] }
  | { kind: 'recent-search'; query: string };

interface NoteRowProps {
  note: NoteFile;
  isSelected: boolean;
  matchIndices: number[];
  isPinned: boolean;
  onClick: () => void;
  onMouseEnter: () => void;
  onTogglePin: (e: React.MouseEvent) => void;
}

function NoteRow({
  note,
  isSelected,
  matchIndices,
  isPinned,
  onClick,
  onMouseEnter,
  onTogglePin,
}: NoteRowProps) {
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
        <div className="quick-switcher-item-meta">{typeLabel}</div>
      </div>
      <button
        type="button"
        aria-label={isPinned ? 'Unpin note' : 'Pin note'}
        className={`quick-switcher-pin ${isPinned ? 'quick-switcher-pin-active' : ''}`}
        onClick={onTogglePin}
        // Stop the parent button onClick handler firing when pin is clicked.
        onMouseDown={(e) => e.stopPropagation()}
      >
        <Star className="w-4 h-4" fill={isPinned ? 'currentColor' : 'none'} />
      </button>
    </button>
  );
}

interface CommandRowProps {
  command: QuickSwitcherCommand;
  isSelected: boolean;
  titleIndices: number[];
  onClick: () => void;
  onMouseEnter: () => void;
}

function commandIcon(id: string) {
  switch (id) {
    case 'open-settings':
      return <SettingsIcon className="w-4 h-4" />;
    case 'open-today':
      return <Calendar className="w-4 h-4" />;
    case 'new-note':
      return <Plus className="w-4 h-4" />;
    case 'new-note-from-template':
      return <FileStack className="w-4 h-4" />;
    case 'open-graph':
      return <Network className="w-4 h-4" />;
    case 'toggle-timeline':
      return <Clock className="w-4 h-4" />;
    case 'toggle-theme':
      return <Sun className="w-4 h-4" />;
    case 'shortcut-help':
      return <Keyboard className="w-4 h-4" />;
    default:
      return <CommandIcon className="w-4 h-4" />;
  }
}

function CommandRow({
  command,
  isSelected,
  titleIndices,
  onClick,
  onMouseEnter,
}: CommandRowProps) {
  return (
    <button
      className={`quick-switcher-item quick-switcher-item-command ${isSelected ? 'quick-switcher-item-selected' : ''}`}
      onClick={onClick}
      onMouseEnter={onMouseEnter}
    >
      <div className="quick-switcher-item-icon quick-switcher-item-icon-command">
        {commandIcon(command.id)}
      </div>
      <div className="quick-switcher-item-content">
        <div className="quick-switcher-item-title">
          <HighlightedTitle title={command.title} indices={titleIndices} />
        </div>
        <div className="quick-switcher-item-meta">
          {commandCategoryLabel(command.category)}
        </div>
      </div>
    </button>
  );
}

interface RecentSearchRowProps {
  query: string;
  isSelected: boolean;
  onClick: () => void;
  onMouseEnter: () => void;
}

function RecentSearchRow({
  query,
  isSelected,
  onClick,
  onMouseEnter,
}: RecentSearchRowProps) {
  return (
    <button
      className={`quick-switcher-item ${isSelected ? 'quick-switcher-item-selected' : ''}`}
      onClick={onClick}
      onMouseEnter={onMouseEnter}
    >
      <div className="quick-switcher-item-icon">
        <History className="w-4 h-4" />
      </div>
      <div className="quick-switcher-item-content">
        <div className="quick-switcher-item-title">{query}</div>
        <div className="quick-switcher-item-meta">Recent search</div>
      </div>
    </button>
  );
}

function SectionHeader({
  label,
  icon,
}: {
  label: string;
  icon?: React.ReactNode;
}) {
  return (
    <div className="quick-switcher-section-header">
      {icon}
      <span>{label}</span>
    </div>
  );
}

export function QuickSwitcher() {
  const {
    isOpen,
    close,
    recentSearches,
    pinnedNoteIds,
    addRecentSearch,
    togglePinned,
  } = useQuickSwitcherStore();
  const { recentNoteIds } = useNoteStore();
  const { notes, loadNote, loadDailyNote, createNote } = useNotes();
  const { theme, setTheme } = useThemeStore();
  const { setIsSettingsOpen } = useSettingsStore();
  const { toggle: toggleTimeline } = useTimelineStore();
  const { open: openGraph } = useGraphStore();

  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  /**
   * Compute the rendered rows + the section breakpoints used to inject
   * headers between groups. Rows are kept flat so up/down navigation is a
   * trivial index walk.
   */
  const { rows, headers } = useMemo(() => {
    const rows: Row[] = [];
    /** Map from row index → header to render BEFORE that row. */
    const headers = new Map<number, { label: string; icon?: React.ReactNode }>();

    const noteByPath = new Map(notes.map((n) => [n.path, n] as const));
    const trimmed = query.trim();

    if (!trimmed) {
      // Empty input: pinned → recent notes → recent searches → quick actions.
      const pinned = pinnedNoteIds
        .map((id) => noteByPath.get(id))
        .filter((n): n is NoteFile => Boolean(n));

      if (pinned.length > 0) {
        headers.set(rows.length, {
          label: 'Pinned',
          icon: <Pin className="w-3 h-3" />,
        });
        for (const note of pinned) {
          rows.push({ kind: 'note', note, indices: [], isPinned: true });
        }
      }

      const pinnedSet = new Set(pinnedNoteIds);
      const recents: NoteFile[] = [];
      for (const id of recentNoteIds) {
        if (pinnedSet.has(id)) continue;
        const note = noteByPath.get(id);
        if (note) recents.push(note);
      }
      // Pad up to 7 with "other" notes (excluding pinned + recents already shown).
      const shown = new Set([
        ...pinnedNoteIds,
        ...recents.map((n) => n.path),
      ]);
      const padding = notes
        .filter((n) => !shown.has(n.path))
        .slice(0, Math.max(0, 7 - recents.length));
      const recentRows = [...recents, ...padding];

      if (recentRows.length > 0) {
        headers.set(rows.length, { label: 'Recent notes' });
        for (const note of recentRows) {
          rows.push({
            kind: 'note',
            note,
            indices: [],
            isPinned: pinnedSet.has(note.path),
          });
        }
      }

      if (recentSearches.length > 0) {
        headers.set(rows.length, {
          label: 'Recent searches',
          icon: <History className="w-3 h-3" />,
        });
        for (const q of recentSearches) {
          rows.push({ kind: 'recent-search', query: q });
        }
      }

      // Quick actions catalog (full list, in canonical order).
      const allCommands = filterCommands('');
      if (allCommands.length > 0) {
        headers.set(rows.length, {
          label: 'Quick actions',
          icon: <CommandIcon className="w-3 h-3" />,
        });
        for (const c of allCommands) {
          rows.push({
            kind: 'command',
            command: c.command,
            titleIndices: c.titleIndices,
          });
        }
      }
    } else {
      // Non-empty input: matching notes first, then matching commands.
      const pinnedSet = new Set(pinnedNoteIds);
      const noteMatches = notes
        .map((note) => {
          const title = getNoteTitle(note);
          const m = fuzzyMatch(trimmed, title);
          return { note, ...m };
        })
        .filter((r) => r.matches)
        .sort((a, b) => {
          const aStart = a.indices[0] === 0 ? 0 : 1;
          const bStart = b.indices[0] === 0 ? 0 : 1;
          return aStart - bStart;
        });

      for (const r of noteMatches) {
        rows.push({
          kind: 'note',
          note: r.note,
          indices: r.indices,
          isPinned: pinnedSet.has(r.note.path),
        });
      }

      const commandMatches = filterCommands(trimmed);
      if (commandMatches.length > 0) {
        headers.set(rows.length, {
          label: 'Actions',
          icon: <CommandIcon className="w-3 h-3" />,
        });
        for (const c of commandMatches) {
          rows.push({
            kind: 'command',
            command: c.command,
            titleIndices: c.titleIndices,
          });
        }
      }
    }

    return { rows, headers };
  }, [query, notes, recentNoteIds, recentSearches, pinnedNoteIds]);

  // Reset selection when the visible result set changes.
  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  // Auto-focus input when opened.
  useEffect(() => {
    if (isOpen) {
      setQuery('');
      setSelectedIndex(0);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [isOpen]);

  const runCommand = useCallback(
    (id: string) => {
      switch (id) {
        case 'open-settings':
          setIsSettingsOpen(true);
          return;
        case 'open-today': {
          const today = new Date();
          useNoteStore.getState().setSelectedDate(today);
          loadDailyNote(today).catch((e) =>
            console.error('[QuickSwitcher] loadDailyNote failed', e),
          );
          return;
        }
        case 'new-note':
          createNote('Untitled').catch((e) =>
            console.error('[QuickSwitcher] createNote failed', e),
          );
          return;
        case 'new-note-from-template':
          // Re-trigger the existing Cmd+T handler so the template picker
          // (owned by Editor scope) opens without us having to duplicate it.
          dispatchModKey('t');
          return;
        case 'toggle-timeline':
          toggleTimeline();
          return;
        case 'toggle-theme': {
          const next =
            theme === 'light' ? 'dark' : theme === 'dark' ? 'system' : 'light';
          setTheme(next);
          return;
        }
        case 'shortcut-help':
          dispatchModKey('/');
          return;
        case 'open-graph':
          openGraph();
          return;
        default:
          console.warn('[QuickSwitcher] unknown command', id);
      }
    },
    [
      setIsSettingsOpen,
      loadDailyNote,
      createNote,
      toggleTimeline,
      theme,
      setTheme,
      openGraph,
    ],
  );

  const selectNote = useCallback(
    async (note: NoteFile) => {
      close();
      try {
        await loadNote(note);
      } catch (error) {
        console.error('[QuickSwitcher] Failed to load note:', error);
      }
    },
    [close, loadNote],
  );

  const activate = useCallback(
    (row: Row) => {
      const trimmed = query.trim();
      if (trimmed) addRecentSearch(trimmed);

      switch (row.kind) {
        case 'note':
          void selectNote(row.note);
          return;
        case 'command':
          close();
          runCommand(row.command.id);
          return;
        case 'recent-search':
          setQuery(row.query);
          // Move focus back to the input so the user can keep typing.
          setTimeout(() => inputRef.current?.focus(), 0);
          return;
      }
    },
    [query, addRecentSearch, selectNote, close, runCommand],
  );

  // Keyboard navigation.
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault();
          setSelectedIndex((i) => Math.min(i + 1, Math.max(rows.length - 1, 0)));
          break;
        case 'ArrowUp':
          e.preventDefault();
          setSelectedIndex((i) => Math.max(i - 1, 0));
          break;
        case 'Enter':
          e.preventDefault();
          if (rows[selectedIndex]) activate(rows[selectedIndex]);
          break;
        case 'Escape':
          e.preventDefault();
          close();
          break;
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, rows, selectedIndex, close, activate]);

  // Click outside to close.
  useEffect(() => {
    if (!isOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        close();
      }
    };
    setTimeout(() => {
      document.addEventListener('mousedown', handleClickOutside);
    }, 0);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen, close]);

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
            placeholder="Search notes or run a command…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>

        <div className="quick-switcher-results">
          {rows.length === 0 ? (
            <div className="quick-switcher-empty">No matches</div>
          ) : (
            rows.map((row, index) => {
              const header = headers.get(index);
              const key =
                row.kind === 'note'
                  ? `note:${row.note.path}`
                  : row.kind === 'command'
                    ? `cmd:${row.command.id}`
                    : `recent:${row.query}`;
              return (
                <div key={key}>
                  {header && (
                    <SectionHeader label={header.label} icon={header.icon} />
                  )}
                  {row.kind === 'note' && (
                    <NoteRow
                      note={row.note}
                      isSelected={index === selectedIndex}
                      matchIndices={row.indices}
                      isPinned={!!row.isPinned}
                      onClick={() => activate(row)}
                      onMouseEnter={() => setSelectedIndex(index)}
                      onTogglePin={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        togglePinned(row.note.path);
                      }}
                    />
                  )}
                  {row.kind === 'command' && (
                    <CommandRow
                      command={row.command}
                      isSelected={index === selectedIndex}
                      titleIndices={row.titleIndices}
                      onClick={() => activate(row)}
                      onMouseEnter={() => setSelectedIndex(index)}
                    />
                  )}
                  {row.kind === 'recent-search' && (
                    <RecentSearchRow
                      query={row.query}
                      isSelected={index === selectedIndex}
                      onClick={() => activate(row)}
                      onMouseEnter={() => setSelectedIndex(index)}
                    />
                  )}
                </div>
              );
            })
          )}
        </div>

        <div className="quick-switcher-footer">
          <span>
            <kbd>↑↓</kbd> navigate
          </span>
          <span>
            <kbd>↵</kbd> open
          </span>
          <span>
            <kbd>esc</kbd> close
          </span>
        </div>
      </div>
    </div>
  );
}

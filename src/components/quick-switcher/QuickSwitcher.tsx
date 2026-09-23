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
  X,
  Cloud,
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
  QUICK_SWITCHER_COMMANDS,
  type QuickSwitcherCommand,
} from './commands';
import { usePluginCommandStore } from '@/stores/pluginCommandStore';
import type { ContentMatch } from '@/stores/searchStore';
import type { NoteFile } from '@/types';
import { safeInvoke as invoke } from '@/lib/ipc';
import { applyImpactOrigin } from '@/lib/impactOrigin';
import { isMobilePlatform } from '@/lib/platform';
import { SignatureEmptyState } from '@/components/ui/SignatureMark';
import { DialogSurface } from '@/components/ui/DialogSurface';
import { HighlightedText } from '@/components/ui/HighlightedText';

const CONTENT_SEARCH_DEBOUNCE_MS = 150;
const CONTENT_SEARCH_LIMIT = 30;

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

function getNoteTitle(noteFile: NoteFile): string {
  return noteFile.name.replace(/\.md$/, '');
}

function getNoteTypeLabel(noteFile: NoteFile): string {
  if (noteFile.isDaily) return 'Daily';
  if (noteFile.isWeekly) return 'Weekly';
  return 'Note';
}

function HighlightedTitle({ title, indices }: { title: string; indices: number[] }) {
  const chars = title.split('');
  const indexSet = new Set(indices);
  return (
    <span>
      {chars.map((char, i) => (
        <span key={i} className={indexSet.has(i) ? 'quick-switcher-match' : ''}>
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
  | { kind: 'note'; note: NoteFile; indices: number[]; isPinned?: boolean; snippet?: string }
  | { kind: 'command'; command: QuickSwitcherCommand; titleIndices: number[] }
  | { kind: 'recent-search'; query: string };

interface NoteRowProps {
  note: NoteFile;
  isSelected: boolean;
  matchIndices: number[];
  /** The matching line of a hit in the note's text, and the words to mark in it. */
  snippet?: { text: string; term: string };
  isPinned: boolean;
  onClick: () => void;
  onMouseEnter: () => void;
  onTogglePin: (e: React.MouseEvent) => void;
}

function NoteRow({
  note,
  isSelected,
  matchIndices,
  snippet,
  isPinned,
  onClick,
  onMouseEnter,
  onTogglePin,
}: NoteRowProps) {
  const title = getNoteTitle(note);
  const typeLabel = getNoteTypeLabel(note);

  return (
    <div
      className={`quick-switcher-item ${isSelected ? 'quick-switcher-item-selected' : ''}`}
      onMouseEnter={onMouseEnter}
    >
      <button
        type="button"
        className="flex flex-1 min-w-0 items-center gap-3 text-left"
        onClick={onClick}
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
            {note.notDownloaded && (
              <Cloud
                className="ml-1.5 inline w-3 h-3 align-baseline"
                role="img"
                aria-label="In iCloud, not downloaded"
                style={{ color: 'var(--text-muted)' }}
              >
                <title>In iCloud, not downloaded</title>
              </Cloud>
            )}
          </div>
          <div className={`quick-switcher-item-meta${snippet ? ' search-preview truncate' : ''}`}>
            {snippet ? <HighlightedText text={snippet.text} term={snippet.term} /> : typeLabel}
          </div>
        </div>
      </button>
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
    </div>
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

function CommandRow({ command, isSelected, titleIndices, onClick, onMouseEnter }: CommandRowProps) {
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
        <div className="quick-switcher-item-meta">{commandCategoryLabel(command.category)}</div>
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

function RecentSearchRow({ query, isSelected, onClick, onMouseEnter }: RecentSearchRowProps) {
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

function SectionHeader({ label, icon }: { label: string; icon?: React.ReactNode }) {
  return (
    <div className="quick-switcher-section-header">
      {icon}
      <span>{label}</span>
    </div>
  );
}

export function QuickSwitcher() {
  const { isOpen, close, recentSearches, pinnedNoteIds, addRecentSearch, togglePinned } =
    useQuickSwitcherStore();
  const recentNoteIds = useNoteStore((state) => state.recentNoteIds);
  const { notes, loadNote, loadDailyNote, createNote } = useNotes();
  const { theme, setTheme } = useThemeStore();
  const { setIsSettingsOpen } = useSettingsStore();
  const { toggle: toggleTimeline } = useTimelineStore();
  const { open: openGraph } = useGraphStore();

  const [query, setQuery] = useState('');
  const [contentHits, setContentHits] = useState<{ query: string; hits: ContentMatch[] }>({
    query: '',
    hits: [],
  });
  const [selectedIndex, setSelectedIndex] = useState(0);
  const isMobile = isMobilePlatform();
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const setContainerRef = useCallback((node: HTMLDivElement | null) => {
    containerRef.current = node;
    applyImpactOrigin(node);
  }, []);

  /**
   * Compute the rendered rows + the section breakpoints used to inject
   * headers between groups. Rows are kept flat so up/down navigation is a
   * trivial index walk.
   */
  const pluginCommands = usePluginCommandStore((s) => s.commands);

  const { rows, headers } = useMemo(() => {
    const rows: Row[] = [];
    /** Map from row index → header to render BEFORE that row. */
    const headers = new Map<number, { label: string; icon?: React.ReactNode }>();

    const commandCatalog: QuickSwitcherCommand[] = [
      ...QUICK_SWITCHER_COMMANDS.filter((c) => !(isMobile && c.desktopOnly)),
      ...pluginCommands.map((c) => ({
        id: c.id,
        title: c.label,
        category: 'plugins' as const,
        keywords: ['plugin'],
      })),
    ];

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
      const shown = new Set([...pinnedNoteIds, ...recents.map((n) => n.path)]);
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

      const allCommands = filterCommands('', commandCatalog);
      if (allCommands.length > 0) {
        headers.set(rows.length, {
          label: 'Quick actions',
          icon: isMobile ? undefined : <CommandIcon className="w-3 h-3" />,
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

      // The backend search answers after the title matches, so its hits go
      // below them and never move the row a quick Enter would open.
      const titleMatched = new Set(noteMatches.map((r) => r.note.path));
      const textMatches = (contentHits.query === trimmed ? contentHits.hits : [])
        .filter((hit) => !titleMatched.has(hit.path))
        .flatMap((hit) => {
          const note = noteByPath.get(hit.path);
          return note ? [{ note, snippet: hit.snippet }] : [];
        });
      if (textMatches.length > 0) {
        headers.set(rows.length, { label: 'In note text' });
        for (const m of textMatches) {
          rows.push({
            kind: 'note',
            note: m.note,
            indices: [],
            isPinned: pinnedSet.has(m.note.path),
            snippet: m.snippet,
          });
        }
      }

      const commandMatches = filterCommands(trimmed, commandCatalog);
      if (commandMatches.length > 0) {
        headers.set(rows.length, {
          label: 'Actions',
          icon: isMobile ? undefined : <CommandIcon className="w-3 h-3" />,
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
  }, [
    query,
    contentHits,
    notes,
    recentNoteIds,
    recentSearches,
    pinnedNoteIds,
    pluginCommands,
    isMobile,
  ]);

  useEffect(() => {
    const trimmed = query.trim();
    if (!isOpen || !trimmed) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      invoke<ContentMatch[]>('search_notes_content', {
        query: trimmed,
        maxResults: CONTENT_SEARCH_LIMIT,
      })
        .then((hits) => {
          if (!cancelled) setContentHits({ query: trimmed, hits });
        })
        .catch((error: unknown) => {
          console.error('[QuickSwitcher] text search failed:', error);
        });
    }, CONTENT_SEARCH_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [isOpen, query]);

  // Reset selection when the visible result set changes, and clear the query
  // when the switcher opens. Adjusted during render rather than in an effect,
  // so no frame ever shows a highlight or a query belonging to the last pass.
  const [renderedQuery, setRenderedQuery] = useState(query);
  if (renderedQuery !== query) {
    setRenderedQuery(query);
    setSelectedIndex(0);
  }

  const [wasOpen, setWasOpen] = useState(isOpen);
  if (wasOpen !== isOpen) {
    setWasOpen(isOpen);
    if (isOpen) {
      setQuery('');
      setSelectedIndex(0);
    }
  }

  useEffect(() => {
    if (!isOpen) return;
    const timer = setTimeout(() => inputRef.current?.focus(), 50);
    return () => clearTimeout(timer);
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
            console.error('[QuickSwitcher] loadDailyNote failed', e)
          );
          return;
        }
        case 'new-note':
          createNote('Untitled').catch((e) =>
            console.error('[QuickSwitcher] createNote failed', e)
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
          const next = theme === 'light' ? 'dark' : theme === 'dark' ? 'system' : 'light';
          setTheme(next);
          return;
        }
        case 'shortcut-help':
          dispatchModKey('/');
          return;
        case 'switch-forge':
          // Sidebar listens for this event and opens the Forge dropdown.
          window.dispatchEvent(new Event('moldavite:open-forge-switcher'));
          return;
        case 'open-graph':
          openGraph();
          return;
        default:
          // Plugin-registered commands (namespaced `pluginId:localId`).
          void usePluginCommandStore.getState().execute(id);
      }
    },
    [setIsSettingsOpen, loadDailyNote, createNote, toggleTimeline, theme, setTheme, openGraph]
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
    [close, loadNote]
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
    [query, addRecentSearch, selectNote, close, runCommand]
  );

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      // Once focus leaves the search field, native controls own their keys.
      // In particular, Enter on a Pin button must not activate the selected row.
      if (e.target !== inputRef.current) return;

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
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, rows, selectedIndex, close, activate]);

  useEffect(() => {
    if (!isOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      // The rail's Search button toggles this surface itself. Closing on its
      // mousedown would leave its click re-opening what the user just dismissed.
      if (target?.closest?.('[data-surface="search"]')) return;
      if (containerRef.current && !containerRef.current.contains(target)) {
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
      <DialogSurface
        ref={setContainerRef}
        aria-label="Quick switcher"
        onEscape={close}
        className="quick-switcher-container impact-surface"
      >
        <div className="quick-switcher-input-wrapper">
          <Search className="quick-switcher-search-icon" />
          <input
            ref={inputRef}
            type="text"
            className="quick-switcher-input"
            placeholder={isMobile ? 'Search notes' : 'Search notes or run a command…'}
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          {/* A phone has no Escape key, and the search covers the whole screen. */}
          {isMobilePlatform() && (
            <button
              type="button"
              className="quick-switcher-close"
              aria-label="Close search"
              onClick={close}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
                width: 'var(--touch-target)',
                height: 'var(--touch-target)',
                color: 'var(--text-secondary)',
              }}
            >
              <X size={20} strokeWidth={1.5} aria-hidden="true" />
            </button>
          )}
        </div>

        <div className="quick-switcher-results">
          {rows.length === 0 ? (
            <SignatureEmptyState className="quick-switcher-empty" vertical>
              <span>No matches</span>
            </SignatureEmptyState>
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
                  {header && <SectionHeader label={header.label} icon={header.icon} />}
                  {row.kind === 'note' && (
                    <NoteRow
                      note={row.note}
                      isSelected={index === selectedIndex}
                      matchIndices={row.indices}
                      snippet={row.snippet ? { text: row.snippet, term: query.trim() } : undefined}
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
      </DialogSurface>
    </div>
  );
}

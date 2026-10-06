import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { format } from 'date-fns';
import { ChevronRight, Info } from 'lucide-react';
import { useNoteStore, useOverlayStore, useTimelineStore } from '@/stores';
import { useNotes } from '@/hooks';
import { listTrash } from '@/lib/fileSystem';
import { countNoteActivity, listNoteActivity, type NoteActivityEntry } from '@/lib/noteActivity';
import { isMobilePlatform } from '@/lib/platform';
import { CloseButton } from '@/components/ui/CloseButton';
import type { NoteFile, TrashedNote } from '@/types';
import {
  actionLabel,
  changesLabel,
  dayHeading,
  folderLabel,
  noteTitle,
  recentDays,
  type ActivityDay,
} from './activity';

/** Rows an opened day shows first, and how many more each "Show more" adds. */
export const DAY_PAGE = 10;
export const MORE_PAGE = 20;
/** Saves land in the note list every few hundred ms; the history needs far less. */
const REFRESH_DELAY_MS = 1500;
const MAX_POLLS = 20;

const MUTED = { color: 'var(--text-muted)' } as const;

function trashedPaths(items: TrashedNote[]): Set<string> {
  const paths = new Set<string>();
  for (const item of items) {
    const original = item.originalPath.replace(/\.locked$/, '');
    if (item.isFolder) {
      for (const file of item.containedFiles) {
        paths.add(`notes/${original}/${file.replace(/\.locked$/, '')}`);
      }
    } else {
      paths.add(`${item.isDaily ? 'daily' : item.isWeekly ? 'weekly' : 'notes'}/${original}`);
    }
  }
  return paths;
}

function infoText(recordingSince: number | null): string {
  const since = recordingSince
    ? `, read when this device started recording on ${format(recordingSince, 'MMMM d, yyyy')}`
    : '';
  return (
    'What happened to your notes: created, edited, renamed, moved, trashed, locked. ' +
    'This device keeps the record in its own app data, outside the Forge, so each device ' +
    'has its own and none of it is uploaded. It holds note names and times, never what a ' +
    `note says. Entries marked “file date” come from the files’ own dates${since}. ` +
    'Changes older than 180 days drop off.'
  );
}

/**
 * The history of what happened to notes in this Forge, from the activity log
 * the backend keeps on this device. A week of days at a time, each day closed
 * to its count until opened; only open days load rows, a page at a time.
 * Nothing here reads a note.
 */
export function TimelineView() {
  const notes = useNoteStore((state) => state.notes);
  const close = useTimelineStore((state) => state.close);
  const { loadNote } = useNotes();
  const [now] = useState(() => new Date());
  const [weeks, setWeeks] = useState(1);
  const days = useMemo(() => recentDays(weeks, now), [weeks, now]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [hasEarlier, setHasEarlier] = useState(false);
  const [recordingSince, setRecordingSince] = useState<number | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [open, setOpen] = useState(() => new Set(days.slice(0, 2).map((day) => day.key)));
  const [rows, setRows] = useState<Record<string, NoteActivityEntry[]>>({});
  const [trash, setTrash] = useState<Set<string>>(new Set());
  const [showInfo, setShowInfo] = useState(false);
  const latest = useRef({ open, rows, days });
  latest.current = { open, rows, days };
  const loadedRef = useRef(false);

  const notesByPath = useMemo(() => new Map(notes.map((note) => [note.path, note])), [notes]);

  const loadDay = useCallback(async (day: ActivityDay, limit: number) => {
    const page = await listNoteActivity({ atMs: day.end, id: 0 }, day.start, limit);
    setRows((current) => ({ ...current, [day.key]: page.entries }));
  }, []);

  const refresh = useCallback(async () => {
    const { days, open, rows } = latest.current;
    try {
      const ascending = [...days].reverse();
      const result = await countNoteActivity([
        ...ascending.map((day) => day.start),
        ascending[ascending.length - 1].end,
      ]);
      const next: Record<string, number> = {};
      ascending.forEach((day, index) => (next[day.key] = result.counts[index] ?? 0));
      setCounts(next);
      setHasEarlier(result.hasEarlier);
      setRecordingSince(result.recordingSinceMs);
      await Promise.all(
        days
          .filter((day) => open.has(day.key) && next[day.key] > 0)
          .map((day) => loadDay(day, Math.max(DAY_PAGE, rows[day.key]?.length ?? 0)))
      );
    } catch (error) {
      console.error('[Timeline] Failed to load note history:', error);
    } finally {
      loadedRef.current = true;
      setLoaded(true);
    }
  }, [loadDay]);

  // A save or an outside change updates the note list, which is the cue to
  // count again.
  useEffect(() => {
    const delay = loadedRef.current ? REFRESH_DELAY_MS : 0;
    const id = window.setTimeout(() => void refresh(), delay);
    return () => window.clearTimeout(id);
  }, [notes, refresh]);

  useEffect(() => {
    if (loadedRef.current) void refresh();
  }, [weeks, refresh]);

  // The first launch reads file dates in the background; look again until it has.
  const pollsRef = useRef(0);
  useEffect(() => {
    if (!loaded || recordingSince !== null || pollsRef.current >= MAX_POLLS) return;
    const id = window.setTimeout(() => {
      pollsRef.current += 1;
      void refresh();
    }, REFRESH_DELAY_MS);
    return () => window.clearTimeout(id);
  }, [loaded, recordingSince, refresh, counts]);

  useEffect(() => {
    listTrash()
      .then((items) => setTrash(trashedPaths(items)))
      .catch(() => undefined);
  }, [notes]);

  const toggleDay = (day: ActivityDay) => {
    const opening = !open.has(day.key);
    setOpen((current) => {
      const next = new Set(current);
      if (opening) next.add(day.key);
      else next.delete(day.key);
      return next;
    });
    // A closed day is not refreshed, so its rows may be from before the last change.
    if (opening) {
      void loadDay(day, Math.max(DAY_PAGE, rows[day.key]?.length ?? 0)).catch(() => undefined);
    }
  };

  const showMore = async (day: ActivityDay) => {
    const shown = rows[day.key] ?? [];
    const last = shown[shown.length - 1];
    if (!last) return;
    try {
      const page = await listNoteActivity(last, day.start, MORE_PAGE);
      setRows((current) => ({ ...current, [day.key]: [...shown, ...page.entries] }));
    } catch (error) {
      console.error('[Timeline] Failed to load more of the day:', error);
    }
  };

  const openNote = (note: NoteFile) => {
    close();
    void loadNote(note);
  };

  const openTrash = () => {
    close();
    useOverlayStore.getState().openSurface('trash');
  };

  const weeksOfDays = Array.from({ length: weeks }, (_, week) =>
    days.slice(week * 7, week * 7 + 7)
  );
  const nothingYet = loaded && !hasEarlier && days.every((day) => !counts[day.key]);

  return (
    <div
      className="timeline-view flex flex-col h-full"
      style={{ backgroundColor: 'var(--bg-editor)', color: 'var(--text-primary)' }}
    >
      <div
        className="timeline-view-header flex items-center justify-between gap-6 px-6 py-3"
        style={{ borderBottom: '1px solid var(--border-default)' }}
      >
        <div className="flex items-center gap-3">
          <h2
            className="m-0"
            style={{
              color: 'var(--text-primary)',
              fontFamily: 'var(--font-display)',
              fontSize: '17px',
              fontWeight: 500,
              letterSpacing: '-0.015em',
            }}
          >
            Timeline
          </h2>
          <button
            type="button"
            onClick={() => setShowInfo((shown) => !shown)}
            className="pad-hover focus-ring"
            style={{ ...MUTED, lineHeight: 0 }}
            aria-label="About the Timeline"
            aria-expanded={showInfo}
            aria-controls="timeline-info"
            title="About the Timeline"
          >
            <Info className="h-4 w-4" strokeWidth={1.5} aria-hidden="true" />
          </button>
        </div>
        <CloseButton onClick={close} label="Close Timeline" />
      </div>

      {showInfo && (
        <p
          id="timeline-info"
          className="timeline-view-info px-6 py-3 text-xs"
          style={{
            color: 'var(--text-secondary)',
            borderBottom: '1px solid var(--border-muted)',
            maxWidth: '72ch',
          }}
        >
          {infoText(recordingSince)}
        </p>
      )}

      <div className="timeline-view-feed flex-1 overflow-y-auto px-6 pb-6">
        {nothingYet && (
          <p className="py-16 text-center text-sm" style={MUTED}>
            {recordingSince === null
              ? 'Reading your notes’ dates…'
              : 'Nothing has happened to your notes yet.'}
          </p>
        )}

        {loaded &&
          !nothingYet &&
          weeksOfDays.map((week) => {
            const active = week.filter((day) => counts[day.key] > 0);
            if (active.length === 0) {
              const from = format(week[week.length - 1].start, 'd MMM');
              return (
                <p key={week[0].key} className="py-3 text-xs" style={MUTED}>
                  {`No changes from ${from} to ${format(week[0].start, 'd MMM')}.`}
                </p>
              );
            }
            return active.map((day) => (
              <TimelineDay
                key={day.key}
                day={day}
                now={now}
                count={counts[day.key]}
                isOpen={open.has(day.key)}
                rows={rows[day.key]}
                onToggle={() => toggleDay(day)}
                onShowMore={() => void showMore(day)}
                renderRow={(entry) => (
                  <ActivityRow
                    entry={entry}
                    note={notesByPath.get(entry.notePath)}
                    inTrash={trash.has(entry.notePath)}
                    onOpen={openNote}
                    onOpenTrash={isMobilePlatform() ? openTrash : undefined}
                  />
                )}
              />
            ));
          })}

        {hasEarlier && (
          <div className="pt-4">
            <button
              type="button"
              onClick={() => setWeeks((count) => count + 1)}
              className="pad-hover focus-ring text-xs"
              style={MUTED}
            >
              Previous week
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

interface TimelineDayProps {
  day: ActivityDay;
  now: Date;
  count: number;
  isOpen: boolean;
  rows: NoteActivityEntry[] | undefined;
  onToggle: () => void;
  onShowMore: () => void;
  renderRow: (entry: NoteActivityEntry) => ReactNode;
}

function TimelineDay({
  day,
  now,
  count,
  isOpen,
  rows,
  onToggle,
  onShowMore,
  renderRow,
}: TimelineDayProps) {
  const { name, date } = dayHeading(day, now);
  const listId = `timeline-day-${day.key}`;
  const remaining = count - (rows?.length ?? 0);

  return (
    <section aria-label={name} className="timeline-day">
      <h3
        className="timeline-day-header sticky top-0 z-10 py-2"
        style={{ backgroundColor: 'var(--bg-editor)' }}
      >
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={isOpen}
          aria-controls={listId}
          className="pad-hover focus-ring flex w-full items-center gap-2 text-left"
        >
          <ChevronRight
            className="h-3 w-3 flex-shrink-0"
            style={{ ...MUTED, transform: isOpen ? 'rotate(90deg)' : undefined }}
            aria-hidden="true"
          />
          <span className="text-sm" style={{ color: 'var(--text-primary)', fontWeight: 500 }}>
            {name}
          </span>
          <span className="truncate text-xs" style={MUTED}>
            {date ? `${date} · ${changesLabel(count)}` : changesLabel(count)}
          </span>
        </button>
      </h3>
      {isOpen && (
        <div id={listId}>
          <ul className="flex flex-col">
            {(rows ?? []).map((entry) => (
              <li key={entry.id}>{renderRow(entry)}</li>
            ))}
          </ul>
          {rows && remaining > 0 && (
            <div className="py-2 pl-4">
              <button
                type="button"
                onClick={onShowMore}
                className="pad-hover focus-ring text-xs"
                style={MUTED}
              >
                Show {Math.min(MORE_PAGE, remaining)} more
              </button>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

interface ActivityRowProps {
  entry: NoteActivityEntry;
  note: NoteFile | undefined;
  inTrash: boolean;
  onOpen: (note: NoteFile) => void;
  onOpenTrash?: () => void;
}

function ActivityRow({ entry, note, inTrash, onOpen, onOpenTrash }: ActivityRowProps) {
  const status = note ? (note.isLocked ? 'Locked' : null) : inTrash ? 'In Trash' : 'No longer here';
  const fromFiles = entry.source === 'files';
  const onClick = note ? () => onOpen(note) : inTrash ? onOpenTrash : undefined;

  const body = (
    <>
      <span className="flex min-w-0 items-baseline gap-2">
        <span className="note-card-title min-w-0 flex-1 truncate text-sm">
          {noteTitle(entry.path)}
        </span>
        {status && (
          <span className="flex-shrink-0 text-[10px]" style={MUTED}>
            {status}
          </span>
        )}
        <time
          dateTime={new Date(entry.atMs).toISOString()}
          className="flex-shrink-0 text-[11px] tabular-nums"
          style={MUTED}
        >
          {format(entry.atMs, 'HH:mm')}
        </time>
      </span>
      <span className="block truncate text-[11px]" style={MUTED}>
        {folderLabel(entry.path)} · {actionLabel(entry)}
        {fromFiles && ' · file date'}
      </span>
    </>
  );

  const title = fromFiles ? 'Read from the file’s date, not seen happening' : undefined;

  if (!onClick) {
    return (
      <div
        className="note-card block w-full text-left"
        style={{ opacity: 0.6 }}
        title={title ?? (inTrash ? 'Restore it from the Trash on the rail' : undefined)}
      >
        {body}
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={onClick}
      className="note-card focus-ring block w-full text-left"
      title={title}
    >
      {body}
    </button>
  );
}

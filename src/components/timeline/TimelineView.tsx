import { useEffect, useMemo, useRef, useState } from 'react';
import { format, parseISO, isValid as isValidDate } from 'date-fns';
import { useNoteStore, useTimelineStore } from '@/stores';
import { useCalendarStore } from '@/stores/calendarStore';
import { useNotes } from '@/hooks';
import { readNote, noteFileBackendPath } from '@/lib';
import { fetchCalendarEvents, listCalendarSources } from '@/lib/calendar';
import type { CalendarEvent, NoteFile } from '@/types';
import { eventsOverlappingLocalDay } from '@/components/calendar/timeLayout';

type BucketId = 'today' | 'yesterday' | 'thisWeek' | 'thisMonth' | 'earlier';

interface BucketDef {
  id: BucketId;
  label: string;
}

const BUCKETS: BucketDef[] = [
  { id: 'today', label: 'Today' },
  { id: 'yesterday', label: 'Yesterday' },
  { id: 'thisWeek', label: 'This week' },
  { id: 'thisMonth', label: 'This month' },
  { id: 'earlier', label: 'Earlier' },
];

const MAX_PREVIEW_CHARS = 120;
const PREVIEW_CACHE_LIMIT = 400;

/**
 * How many notes the feed shows before asking. Every row costs a file read for
 * its preview, so an unpaged Timeline opened a whole library at once: a
 * few-hundred-note Forge spent hundreds of round trips before painting a feed
 * whose first screen holds a dozen rows. Paging makes the cost track what is
 * actually being read.
 */
const PAGE_SIZE = 50;

/**
 * Dedicated chronological feed that replaces the editor pane when the
 * Timeline is open. Notes are grouped by freshness buckets. On macOS with
 * calendar permission granted, the day's calendar events are interleaved as
 * greyed pill rows above the notes for Today and Yesterday.
 */
export function TimelineView() {
  const { notes } = useNoteStore();
  const { close } = useTimelineStore();
  const { loadNote } = useNotes();
  const [previews, setPreviews] = useState<Map<string, string>>(new Map());
  const [todayEvents, setTodayEvents] = useState<CalendarEvent[]>([]);
  const [yesterdayEvents, setYesterdayEvents] = useState<CalendarEvent[]>([]);

  // Bucket notes up front. We sort each bucket by a best-available proxy for
  // "modified_at": daily notes by `date` descending, standalone alphabetically
  // (we don't have an fs-mtime exposed by the backend — see report).
  const buckets = useMemo(() => bucketNotes(notes), [notes]);

  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const totalNotes = useMemo(
    () => BUCKETS.reduce((sum, bucket) => sum + buckets[bucket.id].length, 0),
    [buckets]
  );

  // One budget spent down the buckets in order, so the page boundary falls
  // wherever it falls rather than giving every bucket a quota of its own —
  // fifty notes from today should not be cut short to reserve room for
  // "Earlier".
  const visibleBuckets = useMemo(() => {
    let remaining = visibleCount;
    const out = {} as Record<BucketId, NoteFile[]>;
    for (const bucket of BUCKETS) {
      const take = Math.min(remaining, buckets[bucket.id].length);
      out[bucket.id] = take > 0 ? buckets[bucket.id].slice(0, take) : [];
      remaining -= take;
    }
    return out;
  }, [buckets, visibleCount]);

  const visibleNotes = useMemo(
    () => BUCKETS.flatMap((bucket) => visibleBuckets[bucket.id]),
    [visibleBuckets]
  );

  // A new Forge, or a filter that shrinks the list, should start from the top
  // again rather than keep a page count the feed no longer has rows for.
  useEffect(() => setVisibleCount(PAGE_SIZE), [totalNotes]);

  // Kick off calendar-event fetch. This goes through the calendar library
  // rather than invoking directly, so it sees every connected source and
  // honours the calendar selection — a direct invoke would have shown Apple
  // events only once Google existed. One range covers both days.
  //
  // Failures stay silent: the spec forbids nagging the user from the Timeline,
  // and an unconnected or unavailable source is not an error here.
  useEffect(() => {
    let cancelled = false;

    const loadEvents = async () => {
      try {
        const sources = await listCalendarSources();
        if (cancelled) return;
        if (!sources.some((s) => s.available && s.connected)) return;

        const today = new Date();
        const yesterday = new Date(today);
        yesterday.setDate(today.getDate() - 1);
        const todayStr = format(today, 'yyyy-MM-dd');
        const yesterdayStr = format(yesterday, 'yyyy-MM-dd');

        const { selectedCalendarIds, legacySelectedAppleCalendarId } = useCalendarStore.getState();
        if (legacySelectedAppleCalendarId) return;
        const { events } = await fetchCalendarEvents(yesterdayStr, todayStr, selectedCalendarIds);

        if (!cancelled) {
          // Events belong to every local day they overlap. Provider offsets
          // may differ, and all-day end dates are already exclusive.
          setTodayEvents(eventsOverlappingLocalDay(events, today));
          setYesterdayEvents(eventsOverlappingLocalDay(events, yesterday));
        }
      } catch {
        // No calendar source available in this build — silently skip.
      }
    };

    loadEvents();
    return () => {
      cancelled = true;
    };
  }, []);

  // Previews are read only for the rows on screen, and kept once read so
  // showing another page does not re-read the pages already shown. The cache is
  // still capped: a library read all the way to the end should not be held in
  // memory in full.
  const previewCacheRef = useRef<Map<string, string>>(new Map());
  useEffect(() => {
    let cancelled = false;

    const loadPreviews = async () => {
      const cache = previewCacheRef.current;
      const missing = visibleNotes.filter(
        (note) => !note.isLocked && !cache.has(note.path) && cache.size < PREVIEW_CACHE_LIMIT
      );
      if (missing.length === 0) return;

      const next = new Map(cache);
      for (const note of missing) {
        try {
          const raw = await readNote(noteFileBackendPath(note), note.isDaily, note.isWeekly);
          next.set(note.path, stripForPreview(raw));
        } catch {
          // skip unreadable notes
        }
        if (cancelled) return;
      }
      previewCacheRef.current = next;
      if (!cancelled) setPreviews(next);
    };

    loadPreviews();
    return () => {
      cancelled = true;
    };
  }, [visibleNotes]);

  const handleRowClick = (note: NoteFile) => {
    close();
    loadNote(note);
  };

  return (
    <div
      className="flex flex-col h-full"
      style={{ backgroundColor: 'var(--bg-editor)', color: 'var(--text-primary)' }}
    >
      {/* Header */}
      <div
        className="flex items-center justify-between px-6 py-4"
        style={{ borderBottom: '1px solid var(--border-muted)' }}
      >
        <h2
          style={{
            color: 'var(--text-primary)',
            fontFamily: 'var(--font-display)',
            fontSize: '18px',
            fontWeight: 400,
            letterSpacing: '-0.015em',
          }}
        >
          Timeline
        </h2>
        <button
          type="button"
          onClick={close}
          className="focus-ring text-xs transition-colors"
          style={{ color: 'var(--text-muted)', borderBottom: '1px solid currentColor' }}
          onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--text-primary)')}
          onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--text-muted)')}
          title="Close Timeline"
          aria-label="Close Timeline"
        >
          Close
        </button>
      </div>

      {/* Feed */}
      <div className="flex-1 overflow-y-auto px-6 py-6">
        {BUCKETS.every((b) => buckets[b.id].length === 0) && (
          <div className="py-16 text-center text-sm" style={{ color: 'var(--text-muted)' }}>
            No notes yet — create one to see it here.
          </div>
        )}

        {BUCKETS.map((bucket) => {
          const items = visibleBuckets[bucket.id];
          const events =
            bucket.id === 'today' ? todayEvents : bucket.id === 'yesterday' ? yesterdayEvents : [];
          if (items.length === 0 && events.length === 0) return null;

          return (
            <section key={bucket.id} className="mb-8">
              <h3
                className="mb-3 text-[10px] uppercase"
                style={{ color: 'var(--text-muted)', letterSpacing: '0.14em' }}
              >
                {bucket.label}
              </h3>

              {events.length > 0 && (
                <div className="mb-2">
                  {events.map((event) => (
                    <EventPill key={event.id} event={event} />
                  ))}
                </div>
              )}

              <ul className="space-y-1">
                {items.map((note) => (
                  <li key={note.path}>
                    <NoteRow
                      note={note}
                      preview={previews.get(note.path) ?? ''}
                      onClick={() => handleRowClick(note)}
                    />
                  </li>
                ))}
              </ul>
            </section>
          );
        })}

        {visibleCount < totalNotes && (
          <button
            type="button"
            onClick={() => setVisibleCount((count) => count + PAGE_SIZE)}
            className="focus-ring w-full py-3 text-xs transition-colors"
            style={{ color: 'var(--text-muted)', borderTop: '1px solid var(--border-muted)' }}
            onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--text-primary)')}
            onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--text-muted)')}
          >
            Show more — {visibleCount} of {totalNotes}
          </button>
        )}
      </div>
    </div>
  );
}

interface NoteRowProps {
  note: NoteFile;
  preview: string;
  onClick: () => void;
}

function NoteRow({ note, preview, onClick }: NoteRowProps) {
  const title = note.name.replace(/\.md$/i, '');
  const folder = note.folderPath ?? '';

  return (
    <button
      type="button"
      onClick={onClick}
      className="focus-ring flex w-full items-start py-2 text-left transition-colors"
      style={{ borderBottom: '1px solid var(--border-muted)' }}
      onMouseEnter={(e) => (e.currentTarget.style.borderBottomColor = 'var(--border-strong)')}
      onMouseLeave={(e) => (e.currentTarget.style.borderBottomColor = 'var(--border-muted)')}
    >
      <span className="flex-1 min-w-0">
        <span className="flex items-baseline gap-2">
          <span className="text-sm font-medium truncate" style={{ color: 'var(--text-primary)' }}>
            {title}
          </span>
          {folder && (
            <span className="text-xs truncate" style={{ color: 'var(--text-muted)' }}>
              {folder}
            </span>
          )}
        </span>
        {preview && (
          <span
            className="block text-xs mt-0.5 line-clamp-1"
            style={{ color: 'var(--text-muted)' }}
          >
            {preview}
          </span>
        )}
      </span>
    </button>
  );
}

function EventPill({ event }: { event: CalendarEvent }) {
  const time = formatEventTime(event);
  const sourceColor = event.calendarColor || 'var(--calendar-google)';
  return (
    <div
      className="flex items-start gap-2 py-2"
      style={{ borderBottom: '1px solid var(--border-muted)' }}
    >
      <span
        className="mt-1.5 h-1.5 w-1.5 flex-shrink-0"
        style={{ backgroundColor: sourceColor }}
        aria-hidden="true"
      />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-xs" style={{ color: 'var(--text-secondary)' }}>
          {event.title || '(untitled event)'}
        </span>
        {(time || event.location) && (
          <span className="block truncate text-[10px]" style={{ color: 'var(--text-muted)' }}>
            {[time, event.location].filter(Boolean).join(' · ')}
          </span>
        )}
      </span>
    </div>
  );
}

/**
 * Sort notes into the five buckets. Daily notes use their `date` field;
 * standalone and weekly notes use `modifiedAt` when the backend provides
 * it, falling back to "Earlier" + alphabetical when it doesn't.
 */
function bucketNotes(notes: NoteFile[]): Record<BucketId, NoteFile[]> {
  const result: Record<BucketId, NoteFile[]> = {
    today: [],
    yesterday: [],
    thisWeek: [],
    thisMonth: [],
    earlier: [],
  };

  const now = new Date();
  const todayStr = format(now, 'yyyy-MM-dd');
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  const yesterdayStr = format(yesterday, 'yyyy-MM-dd');
  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);
  const startOfYesterday = new Date(yesterday);
  startOfYesterday.setHours(0, 0, 0, 0);

  const weekAgo = new Date(now);
  weekAgo.setDate(now.getDate() - 7);
  const monthAgo = new Date(now);
  monthAgo.setMonth(now.getMonth() - 1);

  for (const note of notes) {
    if (note.isDaily && note.date) {
      if (note.date === todayStr) {
        result.today.push(note);
      } else if (note.date === yesterdayStr) {
        result.yesterday.push(note);
      } else {
        const d = parseISO(note.date);
        if (isValidDate(d)) {
          if (d >= weekAgo) result.thisWeek.push(note);
          else if (d >= monthAgo) result.thisMonth.push(note);
          else result.earlier.push(note);
        } else {
          result.earlier.push(note);
        }
      }
    } else if (typeof note.modifiedAt === 'number') {
      const d = new Date(note.modifiedAt * 1000);
      if (d >= startOfToday) result.today.push(note);
      else if (d >= startOfYesterday) result.yesterday.push(note);
      else if (d >= weekAgo) result.thisWeek.push(note);
      else if (d >= monthAgo) result.thisMonth.push(note);
      else result.earlier.push(note);
    } else {
      result.earlier.push(note);
    }
  }

  // Within each bucket, sort by modifiedAt desc when present, else daily
  // date desc, else alphabetical.
  const sortBucket = (arr: NoteFile[]) =>
    arr.sort((a, b) => {
      if (typeof a.modifiedAt === 'number' && typeof b.modifiedAt === 'number') {
        return b.modifiedAt - a.modifiedAt;
      }
      if (a.isDaily && b.isDaily && a.date && b.date) return b.date.localeCompare(a.date);
      return a.name.localeCompare(b.name);
    });
  for (const key of Object.keys(result) as BucketId[]) {
    sortBucket(result[key]);
  }

  return result;
}

/**
 * Reduce a note's raw markdown to a short inline preview.
 * Strips common markdown punctuation and collapses whitespace.
 */
function stripForPreview(raw: string): string {
  if (!raw) return '';
  const text = raw
    // Drop ATX headings markers
    .replace(/^#{1,6}\s+/gm, '')
    // Drop simple inline markdown markers (bold/italic/code/links)
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g, '$1')
    .replace(/[*_`~]+/g, '')
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return text.length > MAX_PREVIEW_CHARS ? `${text.slice(0, MAX_PREVIEW_CHARS).trimEnd()}…` : text;
}

function formatEventTime(event: CalendarEvent): string {
  if (event.isAllDay) return 'All day';
  try {
    const start = parseISO(event.start);
    if (!isValidDate(start)) return '';
    return format(start, 'HH:mm');
  } catch {
    return '';
  }
}

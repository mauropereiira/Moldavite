import { useEffect, useMemo, useState } from 'react';
import { Calendar, FileText, X } from 'lucide-react';
import { format, parseISO, isValid as isValidDate } from 'date-fns';
import { invoke } from '@tauri-apps/api/core';
import { useNoteStore, useTimelineStore } from '@/stores';
import { useNotes } from '@/hooks';
import { readNote } from '@/lib';
import type { CalendarEvent, CalendarPermission, NoteFile } from '@/types';

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

  // Kick off calendar-event fetch. If the permission probe fails for any
  // reason (non-macOS, user denied, etc.), stay silent — the spec explicitly
  // forbids nagging the user from the Timeline.
  useEffect(() => {
    let cancelled = false;

    const loadEvents = async () => {
      try {
        const permission = await invoke<CalendarPermission>('get_calendar_permission');
        if (cancelled) return;
        if (permission !== 'Authorized' && permission !== 'FullAccess') return;

        const today = new Date();
        const yesterday = new Date(today);
        yesterday.setDate(today.getDate() - 1);
        const todayStr = format(today, 'yyyy-MM-dd');
        const yesterdayStr = format(yesterday, 'yyyy-MM-dd');

        const [todays, yests] = await Promise.all([
          invoke<CalendarEvent[]>('fetch_calendar_events', {
            startDate: todayStr,
            endDate: todayStr,
            calendarId: null,
          }),
          invoke<CalendarEvent[]>('fetch_calendar_events', {
            startDate: yesterdayStr,
            endDate: yesterdayStr,
            calendarId: null,
          }),
        ]);

        if (!cancelled) {
          setTodayEvents(todays);
          setYesterdayEvents(yests);
        }
      } catch {
        // Non-macOS build, or calendar plugin unavailable — silently skip.
      }
    };

    loadEvents();
    return () => {
      cancelled = true;
    };
  }, []);

  // Lazy-load previews for all visible notes. We cap the cache size so a huge
  // library doesn't blow memory — rows scroll off-screen fine without it.
  useEffect(() => {
    let cancelled = false;
    const visible = notes.filter((n) => !n.isLocked).slice(0, PREVIEW_CACHE_LIMIT);

    const loadPreviews = async () => {
      const next = new Map<string, string>();
      for (const note of visible) {
        try {
          const raw = await readNote(note.name, note.isDaily, note.isWeekly);
          next.set(note.path, stripForPreview(raw));
        } catch {
          // skip unreadable notes
        }
        if (cancelled) return;
      }
      if (!cancelled) setPreviews(next);
    };

    loadPreviews();
    return () => {
      cancelled = true;
    };
  }, [notes]);

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
        style={{ borderBottom: '1px solid var(--border-default)' }}
      >
        <div className="flex items-center gap-2">
          <Calendar className="w-4 h-4" style={{ color: 'var(--accent-primary)' }} />
          <h2 className="text-base font-semibold">Timeline</h2>
        </div>
        <button
          type="button"
          onClick={close}
          className="p-1.5 rounded transition-colors"
          style={{ color: 'var(--text-muted)' }}
          onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = 'var(--hover-overlay)')}
          onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
          title="Close Timeline"
          aria-label="Close Timeline"
        >
          <X className="w-4 h-4" />
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
          const items = buckets[bucket.id];
          const events =
            bucket.id === 'today' ? todayEvents : bucket.id === 'yesterday' ? yesterdayEvents : [];
          if (items.length === 0 && events.length === 0) return null;

          return (
            <section key={bucket.id} className="mb-8">
              <h3
                className="text-xs font-semibold uppercase tracking-wide mb-3"
                style={{ color: 'var(--text-muted)' }}
              >
                {bucket.label}
              </h3>

              {events.length > 0 && (
                <div className="space-y-1.5 mb-2">
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
      className="w-full text-left px-3 py-2 rounded transition-colors flex items-start gap-3"
      style={{ backgroundColor: 'transparent' }}
      onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = 'var(--hover-overlay)')}
      onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
    >
      <FileText
        className="w-4 h-4 mt-0.5 flex-shrink-0"
        style={{ color: 'var(--text-muted)' }}
      />
      <span className="flex-1 min-w-0">
        <span className="flex items-baseline gap-2">
          <span
            className="text-sm font-medium truncate"
            style={{ color: 'var(--text-primary)' }}
          >
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
  return (
    <div
      className="flex items-center gap-2 px-3 py-1.5 rounded-full text-xs"
      style={{
        backgroundColor: 'var(--bg-inset)',
        color: 'var(--text-muted)',
        border: '1px solid var(--border-muted)',
        width: 'fit-content',
      }}
    >
      <Calendar className="w-3 h-3" />
      {time && <span>{time}</span>}
      <span className="truncate max-w-xs">{event.title || '(untitled event)'}</span>
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
  return text.length > MAX_PREVIEW_CHARS
    ? `${text.slice(0, MAX_PREVIEW_CHARS).trimEnd()}…`
    : text;
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

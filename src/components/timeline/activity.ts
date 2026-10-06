import { addDays, format, isSameYear, isValid, parse, startOfDay } from 'date-fns';
import { getWeeklyNoteTitle } from '@/lib/fileSystem';
import type { NoteActivityEntry } from '@/lib/noteActivity';

/** A save in the same minute as the create is part of making the note. */
const SAME_MINUTE_MS = 60 * 1000;

export interface ActivityDay {
  /** `yyyy-MM-dd` of the local day. */
  key: string;
  start: number;
  end: number;
}

/** The local days of the last `weeks` weeks, today first. DST days stay whole. */
export function recentDays(weeks: number, now = new Date()): ActivityDay[] {
  const today = startOfDay(now);
  return Array.from({ length: weeks * 7 }, (_, index) => {
    const start = addDays(today, -index);
    return {
      key: format(start, 'yyyy-MM-dd'),
      start: start.getTime(),
      end: addDays(start, 1).getTime(),
    };
  });
}

/** "Today", "Yesterday" or "Monday 5 Oct", plus the date for the first two. */
export function dayHeading(day: ActivityDay, now = new Date()): { name: string; date: string } {
  const date = format(day.start, isSameYear(day.start, now) ? 'EEEE d MMM' : 'EEEE d MMM yyyy');
  const offset = Math.round((startOfDay(now).getTime() - day.start) / 86_400_000);
  if (offset === 0) return { name: 'Today', date };
  if (offset === 1) return { name: 'Yesterday', date };
  return { name: date, date: '' };
}

export function changesLabel(count: number): string {
  return count === 1 ? '1 change' : `${count} changes`;
}

function leaf(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1);
}

/** The name a note goes by in the app, from its Forge-relative path alone. */
export function noteTitle(path: string): string {
  const stem = leaf(path).replace(/\.md$/i, '');
  if (path.startsWith('daily/')) {
    const date = parse(stem, 'yyyy-MM-dd', new Date());
    return isValid(date) ? format(date, 'MMMM d, yyyy') : stem;
  }
  if (path.startsWith('weekly/')) return getWeeklyNoteTitle(stem);
  return stem;
}

/** Daily, Weekly, a folder's path, or Notes for the top level. */
export function folderLabel(path: string): string {
  if (path.startsWith('daily/')) return 'Daily';
  if (path.startsWith('weekly/')) return 'Weekly';
  const inner = path.replace(/^notes\//, '');
  const slash = inner.lastIndexOf('/');
  return slash === -1 ? 'Notes' : inner.slice(0, slash);
}

/** What happened, in words: "Created, then edited", "Moved from Projects". */
export function actionLabel(entry: NoteActivityEntry): string {
  const by = entry.source === 'agent' ? ' by an agent' : '';
  switch (entry.action) {
    case 'created':
      return entry.atMs - entry.firstMs >= SAME_MINUTE_MS
        ? `Created${by}, then edited`
        : `Created${by}`;
    case 'edited':
      return `Edited${by}`;
    case 'renamed':
      return entry.oldPath ? `Renamed from ${noteTitle(entry.oldPath)}` : 'Renamed';
    case 'moved':
      return entry.oldPath ? `Moved from ${folderLabel(entry.oldPath)}` : 'Moved';
    case 'trashed':
      return 'Moved to Trash';
    case 'deleted':
      return 'Deleted';
    case 'restored':
      return 'Restored from Trash';
    case 'locked':
      return 'Locked';
    case 'unlocked':
      return 'Unlocked';
  }
}

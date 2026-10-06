import type { NoteFile } from '@/types';
import { localDayInterval } from './timeLayout';

export type DayChangeKind = 'created' | 'created-edited' | 'edited';

export interface DayChange {
  note: NoteFile;
  kind: DayChangeKind;
  /** The latest change inside the day, in milliseconds. */
  at: number;
  createdAt?: number;
}

/** A save in the same minute as the create is part of making the note. */
const SAME_MINUTE_SECONDS = 60;

/**
 * Linux (Android included) has no call that sets a file's birth time, so the
 * atomic rename every save does resets it there, and every save would read as
 * a create. macOS, iOS and Windows keep it across saves (`persist::keep_created`).
 */
export function fileBirthTimesKept(): boolean {
  return typeof navigator === 'undefined' || !/Linux/i.test(navigator.userAgent);
}

/**
 * The notes created or last edited on the local day holding `day`, newest
 * first. Times are the file's own, in Unix seconds from the listing: a past
 * day shows only notes whose latest edit fell on it, since a file keeps one
 * modified time.
 * Without kept birth times every change is reported as an edit.
 */
export function changesOnDay(
  notes: NoteFile[],
  day: Date,
  birthTimesKept = fileBirthTimesKept()
): DayChange[] {
  const { start, end } = localDayInterval(day);
  const inDay = (seconds: number | undefined): seconds is number =>
    seconds !== undefined && seconds * 1000 >= start.getTime() && seconds * 1000 < end.getTime();

  const changes: DayChange[] = [];
  for (const note of notes) {
    const created = birthTimesKept && inDay(note.createdAt) ? note.createdAt : undefined;
    const modified = inDay(note.modifiedAt) ? note.modifiedAt : undefined;
    if (created === undefined && modified === undefined) continue;

    const editedLater =
      created !== undefined && modified !== undefined
        ? modified - created >= SAME_MINUTE_SECONDS
        : false;
    const kind: DayChangeKind =
      created === undefined ? 'edited' : editedLater ? 'created-edited' : 'created';
    changes.push({
      note,
      kind,
      at: Math.max(created ?? -Infinity, modified ?? -Infinity) * 1000,
      createdAt: created === undefined ? undefined : created * 1000,
    });
  }

  return changes.sort((a, b) => b.at - a.at || a.note.path.localeCompare(b.note.path));
}

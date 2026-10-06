import { safeInvoke as invoke } from './ipc';

export type NoteActivityAction =
  | 'created'
  | 'edited'
  | 'renamed'
  | 'moved'
  | 'trashed'
  | 'deleted'
  | 'restored'
  | 'locked'
  | 'unlocked';

/** `files` rows were read from file dates rather than seen happening. */
export type NoteActivitySource = 'app' | 'agent' | 'outside' | 'files';

/** One row of the Rust `list_note_activity` response. Paths are Forge-relative. */
export interface NoteActivityEntry {
  id: number;
  firstMs: number;
  atMs: number;
  action: NoteActivityAction;
  path: string;
  oldPath: string | null;
  /** Where the note is now, after any later rename or move. */
  notePath: string;
  source: NoteActivitySource;
}

export interface NoteActivityPage {
  entries: NoteActivityEntry[];
  hasMore: boolean;
  recordingSinceMs: number | null;
}

export interface NoteActivityCounts {
  /** Rows in each span between consecutive bounds. */
  counts: number[];
  /** Whether any row is older than the first bound. */
  hasEarlier: boolean;
  recordingSinceMs: number | null;
}

/**
 * Newest first: rows before `before` (the last row shown, or a day's end with
 * id 0) and at or after `sinceMs`.
 */
export function listNoteActivity(
  before: Pick<NoteActivityEntry, 'atMs' | 'id'>,
  sinceMs: number,
  limit: number
): Promise<NoteActivityPage> {
  return invoke<NoteActivityPage>('list_note_activity', {
    beforeAtMs: before.atMs,
    beforeId: before.id,
    sinceMs,
    limit,
  });
}

/** Rows per span between ascending `bounds`, such as local day starts. */
export function countNoteActivity(bounds: number[]): Promise<NoteActivityCounts> {
  return invoke<NoteActivityCounts>('count_note_activity', { bounds });
}

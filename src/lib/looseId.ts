/**
 * Addressing for loose notes: Markdown files opened from outside the Forge.
 *
 * A loose tab's id is `loose:<session id>`, never a Forge path, so every place
 * that derives a Forge filename from a tab (autosave, leave-save, the external
 * change banner) has to branch on `isLooseId` first. Without that branch a
 * loose tab falls through to the title fallback and is written into the Forge
 * as `<title>.md`. Kept free of imports so stores can use it without a cycle.
 */

import type { LooseNoteInfo, Note } from '@/types';

const LOOSE_ID_PREFIX = 'loose:';

export function looseNoteId(looseId: string): string {
  return `${LOOSE_ID_PREFIX}${looseId}`;
}

export function isLooseId(id: string | null | undefined): boolean {
  return typeof id === 'string' && id.startsWith(LOOSE_ID_PREFIX);
}

export function isLooseNote(note: Pick<Note, 'id' | 'loose'> | null | undefined): boolean {
  return !!note && (isLooseId(note.id) || !!note.loose);
}

/** Opened for reading only, until the user chooses to edit a lossy file anyway. */
export function isLooseViewOnly(note: Pick<Note, 'id' | 'loose'> | null | undefined): boolean {
  if (!note || !isLooseNote(note)) return false;
  if (!note.loose) return true;
  return note.loose.readOnly && !note.loose.editAnyway;
}

/** The file's folder and name as the user would write them on this system. */
export function looseDisplayPath(loose: Pick<LooseNoteInfo, 'dir' | 'name'>): string {
  const separator = loose.dir.includes('\\') && !loose.dir.includes('/') ? '\\' : '/';
  return `${loose.dir.replace(/[\\/]+$/, '')}${separator}${loose.name}`;
}

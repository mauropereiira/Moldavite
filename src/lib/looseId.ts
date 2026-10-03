/**
 * Addressing for loose notes: Markdown files opened from outside the Forge.
 *
 * A loose tab's id is `loose:<session id>`, never a Forge path, so every place
 * that derives a Forge filename from a tab (autosave, leave-save, the external
 * change banner) has to branch on `isLooseId` first. Without that branch a
 * loose tab falls through to the title fallback and is written into the Forge
 * as `<title>.md`. A dropped file whose path the platform could not recover
 * opens as `dropped:<random id>`: `isLooseId` covers it too, but it has no session id,
 * so it is always view-only and nothing can save it. Kept free of imports so
 * stores can use it without a cycle.
 */

import type { LooseNoteInfo, Note } from '@/types';

const LOOSE_ID_PREFIX = 'loose:';
const DROPPED_ID_PREFIX = 'dropped:';

export function looseNoteId(looseId: string): string {
  return `${LOOSE_ID_PREFIX}${looseId}`;
}

export function looseSessionId(noteId: string): string {
  if (!noteId.startsWith(LOOSE_ID_PREFIX)) throw new Error('This file opened without its location');
  return noteId.slice(LOOSE_ID_PREFIX.length);
}

/** 32 random hex digits. Not `crypto.randomUUID`: Safari 15 before 15.4 lacks it. */
export function randomHexId(): string {
  const bytes = window.crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function droppedNoteId(): string {
  return `${DROPPED_ID_PREFIX}${randomHexId()}`;
}

export function isDroppedId(id: string | null | undefined): boolean {
  return typeof id === 'string' && id.startsWith(DROPPED_ID_PREFIX);
}

export function isLooseId(id: string | null | undefined): boolean {
  return typeof id === 'string' && (id.startsWith(LOOSE_ID_PREFIX) || isDroppedId(id));
}

export function isLooseNote(note: Pick<Note, 'id' | 'loose'> | null | undefined): boolean {
  return !!note && (isLooseId(note.id) || !!note.loose);
}

/** Opened for reading only, until the user chooses to edit a lossy file anyway. */
export function isLooseViewOnly(note: Pick<Note, 'id' | 'loose'> | null | undefined): boolean {
  if (!note || !isLooseNote(note)) return false;
  if (!note.loose || isDroppedId(note.id)) return true;
  return note.loose.readOnly && !note.loose.editAnyway;
}

/** The file's folder and name as the user would write them on this system. */
export function looseDisplayPath(loose: Pick<LooseNoteInfo, 'dir' | 'name'>): string {
  const separator = loose.dir.includes('\\') && !loose.dir.includes('/') ? '\\' : '/';
  return `${loose.dir.replace(/[\\/]+$/, '')}${separator}${loose.name}`;
}

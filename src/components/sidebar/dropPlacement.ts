/**
 * Where a reorder drag would land, read from the pointer's position inside the
 * row it is over, plus the hairline that shows it.
 *
 * Shared by note rows and folder rows so the two read the same way — the only
 * difference is that a folder row keeps a band through its middle that still
 * means "put this inside me".
 */

import type React from 'react';
import type { DropPlace } from '@/stores/sidebarOrderStore';

/** How much of a folder row's height, at each end, reorders rather than nests. */
const FOLDER_EDGE_FRACTION = 0.3;

/**
 * Do these two note addresses sit in the same list?
 *
 * The two sides arrive in different shapes and must be normalised before they
 * are compared. `NoteFile.folderPath` is `null` for a note at the root — the
 * backend's `Option<String>` serialises `None` that way — while parsing the
 * folder out of a dragged note's relative path yields `undefined`. `null` and
 * `undefined` are not `===`, so comparing them raw made every root-note
 * reorder bail out at the drop, after the insert line had already promised it
 * would work. Notes inside a folder compared string-to-string and were fine,
 * which is what hid it.
 */
export function isSameFolder(a: string | null | undefined, b: string | null | undefined): boolean {
  return (a ?? null) === (b ?? null);
}

/** Above the row's midpoint drops before it, below drops after it. */
export function dropPlaceFromPointer(e: React.DragEvent): DropPlace {
  const rect = e.currentTarget.getBoundingClientRect();
  return e.clientY < rect.top + rect.height / 2 ? 'before' : 'after';
}

/**
 * The same reading for a folder row, which has a third answer: the middle band
 * means drop *into* this folder, the gesture folders already had.
 */
export function folderDropIntent(e: React.DragEvent): DropPlace | 'nest' {
  const rect = e.currentTarget.getBoundingClientRect();
  if (rect.height === 0) return 'nest';
  const offset = (e.clientY - rect.top) / rect.height;
  if (offset < FOLDER_EDGE_FRACTION) return 'before';
  if (offset > 1 - FOLDER_EDGE_FRACTION) return 'after';
  return 'nest';
}

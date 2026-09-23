/**
 * Hands a field that does not exist yet the focus on a phone, with the
 * keyboard up: a new note's title, or the search field of a page being opened.
 *
 * iOS raises the software keyboard only for a focus made inside a user
 * gesture, and a new note's title does not exist until its file has been
 * created, after the tap has ended. So the tap focuses a stand-in field, and
 * the real field takes the focus from it once it is mounted: moving focus from
 * one field to another keeps the keyboard up.
 */

let pendingNoteId: string | null = null;
let standIn: HTMLInputElement | null = null;

function releaseKeyboard(): void {
  standIn?.remove();
  standIn = null;
}

/** Call synchronously in the tap that opens the field. */
export function holdKeyboard(): void {
  releaseKeyboard();
  const input = document.createElement('input');
  input.type = 'text';
  input.tabIndex = -1;
  input.setAttribute('aria-hidden', 'true');
  // 16px keeps iOS from zooming the page into the field.
  input.style.cssText =
    'position:fixed;top:0;left:0;width:1px;height:1px;opacity:0;pointer-events:none;font-size:16px;';
  document.body.appendChild(input);
  input.addEventListener('blur', releaseKeyboard, { once: true });
  input.focus({ preventScroll: true });
  standIn = input;
  // Nothing took the focus (creation failed, say): let the keyboard go.
  window.setTimeout(() => {
    if (standIn === input) input.blur();
  }, 3000);
}

export function requestTitleFocus(noteId: string): void {
  pendingNoteId = noteId;
}

/** True once, for the note whose title was asked to take focus. */
export function takeTitleFocus(noteId: string): boolean {
  if (pendingNoteId !== noteId) return false;
  pendingNoteId = null;
  return true;
}

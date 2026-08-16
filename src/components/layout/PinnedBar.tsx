/**
 * A strip of pinned notes above the editor.
 *
 * It exists only when something is pinned. An empty bar is worse than no bar:
 * it costs a row of vertical space in an app whose whole layout argument is
 * that the note is the only thing on screen that has earned its place.
 *
 * Pins are `quickSwitcherStore.pinnedNoteIds` — the same list the Quick
 * Switcher already showed. Adding a second pin concept would mean a note could
 * be pinned in one surface and not the other, which nobody would be able to
 * explain. (Tabs have their own `isPinned`, which is a different idea: it means
 * "don't reuse this tab", not "keep this note to hand".)
 *
 * Opening a pinned note goes through the normal load path, so if that note is
 * already open it focuses the existing tab rather than opening a second copy.
 */

import { useNoteStore, useQuickSwitcherStore } from '@/stores';
import { useNotes } from '@/hooks';
import type { NoteFile } from '@/types';

/** `NoteFile` carries a filename, not a display title — strip the folder and
 *  the extension so the bar reads as names rather than paths. */
const noteLabel = (note: NoteFile) => note.name.replace(/\.md$/, '').split('/').pop() ?? note.name;

export function PinnedBar() {
  const { pinnedNoteIds, togglePinned } = useQuickSwitcherStore();
  const { notes, currentNote } = useNoteStore();
  const { loadNote } = useNotes();

  // A pin can outlive its note — deleted outside the app, or in another Forge.
  // Resolve against the live list rather than trusting the stored ids, so a
  // stale pin is simply absent instead of rendering a row that cannot open.
  const pinned = pinnedNoteIds
    .map((id) => notes.find((note) => note.path === id))
    .filter((note): note is NonNullable<typeof note> => Boolean(note));

  if (pinned.length === 0) return null;

  return (
    <nav className="pinned-bar" aria-label="Pinned notes">
      {pinned.map((note) => {
        const isCurrent = currentNote?.id === note.path;
        return (
          <span key={note.path} className="pinned-bar-item" data-current={isCurrent || undefined}>
            <button
              type="button"
              className="pinned-bar-open"
              aria-current={isCurrent ? 'page' : undefined}
              onClick={() => void loadNote(note)}
            >
              {noteLabel(note)}
            </button>
            <button
              type="button"
              className="pinned-bar-unpin"
              // The title alone is the accessible name for the open button, so
              // the unpin button has to name the note too — otherwise a screen
              // reader hears a row of identical "Unpin" controls.
              aria-label={`Unpin ${noteLabel(note)}`}
              title={`Unpin ${noteLabel(note)}`}
              onClick={() => togglePinned(note.path)}
            >
              ×
            </button>
          </span>
        );
      })}
    </nav>
  );
}

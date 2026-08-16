/**
 * A strip of pinned notes across the top of the app.
 *
 * It exists only when something is pinned. An empty bar is worse than no bar:
 * it costs a row of vertical space in an app whose whole layout argument is
 * that the note is the only thing on screen that has earned its place.
 *
 * It behaves like browser tabs, because that is what people already know. A
 * handful stay on the bar and the rest collapse into a menu — twelve pins
 * wrapped onto three lines and pushed the app down, which is the opposite of
 * the speed the bar is for. Order is the user's: drag a pin to move it, or use
 * the arrow keys when one is focused, so the reordering is not mouse-only.
 *
 * Pins are `quickSwitcherStore.pinnedNoteIds` — the same list the Quick
 * Switcher shows. A second pin concept would mean a note could be pinned in one
 * surface and not the other, which nobody could explain. (Tabs keep their own
 * `isPinned`, which means "don't reuse this tab" — a different idea.)
 *
 * Opening a pinned note goes through the normal load path, so if it is already
 * open it focuses that tab rather than opening a second copy.
 */

import { useState } from 'react';
import { useNoteStore, useQuickSwitcherStore } from '@/stores';
import { useNotes } from '@/hooks';
import { Dropdown, DropdownItem } from '@/components/ui/Dropdown';
import type { NoteFile } from '@/types';

/** `NoteFile` carries a filename, not a display title — strip the folder and
 *  the extension so the bar reads as names rather than paths. */
const noteLabel = (note: NoteFile) => note.name.replace(/\.md$/, '').split('/').pop() ?? note.name;

/**
 * How many stay on the bar. Four is about what fits beside the window controls
 * at a normal width without the bar becoming the loudest thing on screen.
 */
const VISIBLE_PINS = 4;

export function PinnedBar() {
  const { pinnedNoteIds, togglePinned, movePinnedNote } = useQuickSwitcherStore();
  const { notes, currentNote } = useNoteStore();
  const { loadNote } = useNotes();
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [overIndex, setOverIndex] = useState<number | null>(null);

  // A pin can outlive its note — deleted outside the app, or belonging to
  // another Forge. Resolve against the live list rather than trusting the
  // stored ids, so a stale pin is simply absent instead of a row that cannot
  // open. Indices are kept against the *stored* list so reordering addresses
  // the real array rather than the filtered view.
  const resolved = pinnedNoteIds
    .map((id, index) => ({ index, note: notes.find((n) => n.path === id) }))
    .filter((entry): entry is { index: number; note: NoteFile } => Boolean(entry.note));

  if (resolved.length === 0) return null;

  const onBar = resolved.slice(0, VISIBLE_PINS);
  const overflow = resolved.slice(VISIBLE_PINS);

  const open = (note: NoteFile) => void loadNote(note);

  return (
    <nav className="pinned-bar" aria-label="Pinned notes">
      {onBar.map(({ index, note }, position) => {
        const isCurrent = currentNote?.id === note.path;
        return (
          <span
            key={note.path}
            className="pinned-bar-item"
            data-current={isCurrent || undefined}
            data-drop={overIndex === index && dragIndex !== index ? '' : undefined}
            draggable
            onDragStart={(event) => {
              setDragIndex(index);
              event.dataTransfer.effectAllowed = 'move';
              // Firefox refuses to start a drag without payload.
              event.dataTransfer.setData('text/plain', note.path);
            }}
            onDragOver={(event) => {
              event.preventDefault();
              event.dataTransfer.dropEffect = 'move';
              setOverIndex(index);
            }}
            onDragLeave={() => setOverIndex((current) => (current === index ? null : current))}
            onDrop={(event) => {
              event.preventDefault();
              if (dragIndex !== null) movePinnedNote(dragIndex, index);
              setDragIndex(null);
              setOverIndex(null);
            }}
            onDragEnd={() => {
              setDragIndex(null);
              setOverIndex(null);
            }}
          >
            <button
              type="button"
              className="pinned-bar-open"
              aria-current={isCurrent ? 'page' : undefined}
              onClick={() => open(note)}
              onKeyDown={(event) => {
                // The keyboard path to the same reordering. A drag-only control
                // is unusable without a mouse, and this bar is meant to be the
                // fast way around.
                if (!event.altKey || (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight')) {
                  return;
                }
                event.preventDefault();
                movePinnedNote(index, index + (event.key === 'ArrowLeft' ? -1 : 1));
              }}
            >
              {noteLabel(note)}
            </button>
            <button
              type="button"
              className="pinned-bar-unpin"
              // The label alone is the accessible name for the open button, so
              // the unpin button has to name the note too — otherwise a screen
              // reader hears a row of identical "Unpin" controls.
              aria-label={`Unpin ${noteLabel(note)}`}
              title={`Unpin ${noteLabel(note)}`}
              onClick={() => togglePinned(note.path)}
            >
              ×
            </button>
            {position === onBar.length - 1 && overflow.length > 0 && (
              <span className="pinned-bar-sep" aria-hidden="true" />
            )}
          </span>
        );
      })}

      {overflow.length > 0 && (
        <Dropdown
          position="left"
          trigger={
            <button
              type="button"
              className="pinned-bar-more"
              aria-label={`${overflow.length} more pinned notes`}
              title={`${overflow.length} more pinned notes`}
            >
              +{overflow.length}
            </button>
          }
        >
          {overflow.map(({ note }) => (
            <DropdownItem key={note.path} onClick={() => open(note)}>
              {noteLabel(note)}
            </DropdownItem>
          ))}
        </Dropdown>
      )}
    </nav>
  );
}

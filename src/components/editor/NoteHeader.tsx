import { useEffect, useRef, useState } from 'react';
import { format, parseISO, isValid } from 'date-fns';
import type { Note } from '@/types';
import { getNoteTitleError } from '@/lib/validation';
import { takeTitleFocus } from '@/lib/noteTitleFocus';

/**
 * The note's masthead: title set large in the display face, with the date
 * beneath as a letterspaced label, over a hairline.
 *
 * The app previously opened straight into body text with the title implied by
 * the sidebar selection — fine when a filled sidebar card told you where you
 * were, wrong once the sidebar became quiet type. In a system with no boxes
 * and no fills, hierarchy has to be carried typographically, so the page
 * states its own name.
 *
 * The title is editable here. It used to be deliberately read-only, on the
 * grounds that renaming lived in the context menu and the more-options menu and
 * two sources of truth on one string is a smell. That reasoning was wrong about
 * which one is the source: the title on the page is where you look when a note
 * is called "Untitled", and sending you to a menu to fix the word you are
 * already staring at is the kind of small friction that makes a note stay
 * called "Untitled". The menus still work; they now agree with this field
 * rather than owning it.
 *
 * Daily and weekly notes stay read-only: they are named by date, and the rename
 * command rejects them for that reason.
 *
 * Blur to elsewhere in the app commits (switching apps does not), and Enter
 * commits then hands the caret to the body. A name the
 * rename would reject is reported under the field while it is typed; Enter
 * keeps it there to fix, and blur puts the file's name back.
 */
export function NoteHeader({
  note,
  onRename,
  onSubmit,
}: {
  note: Note | null;
  /** Resolves the on-disk file itself; the header only supplies the new name. */
  onRename?: (title: string) => Promise<void>;
  /** Enter committed the name: move on to the body. */
  onSubmit?: () => void;
}) {
  const title = note ? note.title.replace(/\.md$/, '') : '';

  // Daily and weekly notes are named by date; render that as a real date
  // rather than repeating the filename back at the reader.
  const asDate = note?.date ? parseISO(note.date) : parseISO(title);
  const isDateNamed = Boolean(
    note && (note.isDaily || /^\d{4}-\d{2}-\d{2}$/.test(title)) && isValid(asDate)
  );

  const heading = isDateNamed ? format(asDate, 'd MMMM') : title;
  const [draft, setDraft] = useState(heading);
  const [lastHeading, setLastHeading] = useState(heading);
  const [renameError, setRenameError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  // Escape restores the name and then blurs, and blurring is what commits — so
  // without this the abandoned edit would be saved by the very act of leaving
  // the field. A ref rather than state because `commit` must see it in the same
  // tick the blur fires.
  const abandonedRef = useRef(false);
  // Enter has already committed by the time its hand-off to the body blurs
  // the field, possibly before the new name has rendered here.
  const submittedRef = useRef(false);

  // Follow the note: without this the field keeps the previous note's title
  // when you switch, which reads as the wrong note being open. Adjusted during
  // render rather than in an effect — React's own recommendation for deriving
  // state from props, and it avoids a second render with the stale name
  // painted on screen first.
  if (heading !== lastHeading) {
    setLastHeading(heading);
    setDraft(heading);
    setRenameError(null);
  }

  const noteId = note?.id;
  const canRename = Boolean(onRename && note) && !isDateNamed && !note?.isWeekly;

  useEffect(() => {
    if (!noteId || !canRename || !takeTitleFocus(noteId)) return;
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [noteId, canRename]);

  if (!note) return null;

  const label = isDateNamed
    ? format(asDate, 'EEEE · yyyy')
    : note.updatedAt
      ? `Edited ${format(new Date(note.updatedAt), 'd MMM yyyy')}`
      : null;

  const headingStyle = {
    fontFamily: 'var(--font-display)',
    fontSize: 'clamp(26px, 3vw, 32px)',
    lineHeight: 1.15,
    fontWeight: 400,
    letterSpacing: '-0.02em',
    color: 'var(--text-primary)',
    margin: 0,
    overflowWrap: 'anywhere' as const,
  };

  const trimmed = draft.trim();
  const draftError = trimmed && trimmed !== heading ? getNoteTitleError(trimmed) : null;
  const error = draftError ?? renameError;

  const commit = async (): Promise<boolean> => {
    if (abandonedRef.current) {
      abandonedRef.current = false;
      return false;
    }
    if (!trimmed || trimmed === heading || draftError) {
      setDraft(heading);
      return !draftError;
    }
    try {
      await onRename?.(trimmed);
      return true;
    } catch (renameFailure) {
      setRenameError(
        renameFailure instanceof Error ? renameFailure.message : String(renameFailure)
      );
      // Left with Enter, the name stays to be fixed. Once the field is left,
      // the page must not show a name the file does not have.
      if (document.activeElement !== inputRef.current) setDraft(heading);
      return false;
    }
  };

  const submit = async () => {
    if (draftError) return;
    if (!(await commit()) || !onSubmit) return;
    submittedRef.current = true;
    onSubmit();
  };

  return (
    <header
      className="note-header"
      style={{
        maxWidth: 'var(--editor-measure)',
        margin: '0 auto',
        padding: '48px 0 20px',
        borderBottom: '1px solid var(--border-muted)',
      }}
    >
      {canRename ? (
        <h1 style={{ margin: 0 }}>
          <input
            ref={inputRef}
            value={draft}
            aria-label="Note title"
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? 'note-title-error' : undefined}
            enterKeyHint="next"
            spellCheck={false}
            onChange={(event) => {
              setDraft(event.target.value);
              setRenameError(null);
              submittedRef.current = false;
            }}
            onBlur={() => {
              if (submittedRef.current) {
                submittedRef.current = false;
                return;
              }
              // Switching apps blurs the field too, mid-word. That is not
              // leaving it: the window gives it the focus back on return.
              if (!document.hasFocus() || document.visibilityState === 'hidden') return;
              void commit();
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                void submit();
              } else if (event.key === 'Escape') {
                event.preventDefault();
                abandonedRef.current = true;
                setDraft(heading);
                inputRef.current?.blur();
              }
            }}
            style={{
              ...headingStyle,
              width: '100%',
              padding: 0,
              border: 0,
              background: 'transparent',
              outline: 'none',
            }}
          />
        </h1>
      ) : (
        <h1 style={headingStyle}>{heading}</h1>
      )}
      {canRename && error && (
        <p
          id="note-title-error"
          role="alert"
          style={{ marginTop: '6px', fontSize: '12px', color: 'var(--error)' }}
        >
          {error}
        </p>
      )}
      {label && (
        <p
          style={{
            marginTop: '10px',
            fontFamily: 'var(--font-display)',
            fontSize: '10px',
            letterSpacing: '0.14em',
            textTransform: 'uppercase',
            color: 'var(--text-muted)',
          }}
        >
          {label}
        </p>
      )}
    </header>
  );
}

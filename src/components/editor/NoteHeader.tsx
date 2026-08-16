import { useRef, useState } from 'react';
import { format, parseISO, isValid } from 'date-fns';
import type { Note } from '@/types';

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
 */
export function NoteHeader({
  note,
  onRename,
}: {
  note: Note | null;
  /** Resolves the on-disk file itself; the header only supplies the new name. */
  onRename?: (title: string) => Promise<void>;
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
  const inputRef = useRef<HTMLInputElement>(null);
  // Escape restores the name and then blurs, and blurring is what commits — so
  // without this the abandoned edit would be saved by the very act of leaving
  // the field. A ref rather than state because `commit` must see it in the same
  // tick the blur fires.
  const abandonedRef = useRef(false);

  // Follow the note: without this the field keeps the previous note's title
  // when you switch, which reads as the wrong note being open. Adjusted during
  // render rather than in an effect — React's own recommendation for deriving
  // state from props, and it avoids a second render with the stale name
  // painted on screen first.
  if (heading !== lastHeading) {
    setLastHeading(heading);
    setDraft(heading);
  }

  if (!note) return null;

  const label = isDateNamed
    ? format(asDate, 'EEEE · yyyy')
    : note.updatedAt
      ? `Edited ${format(new Date(note.updatedAt), 'd MMM yyyy')}`
      : null;

  const canRename = Boolean(onRename) && !isDateNamed && !note.isWeekly;

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

  const commit = async () => {
    if (abandonedRef.current) {
      abandonedRef.current = false;
      return;
    }
    const next = draft.trim();
    if (!next || next === heading) {
      setDraft(heading);
      return;
    }
    try {
      await onRename?.(next);
    } catch {
      // `renameNote` reports the reason itself; put the old name back so the
      // page never shows a name the file does not have.
      setDraft(heading);
    }
  };

  return (
    <header
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
            spellCheck={false}
            onChange={(event) => setDraft(event.target.value)}
            onBlur={() => void commit()}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                inputRef.current?.blur();
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

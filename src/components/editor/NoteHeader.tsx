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
 * Read-only on purpose: renaming already lives in the note context menu and
 * the footer's more-options, and duplicating it here would put two sources of
 * truth on the same string.
 */
export function NoteHeader({ note }: { note: Note | null }) {
  if (!note) return null;

  const title = note.title.replace(/\.md$/, '');

  // Daily and weekly notes are named by date; render that as a real date
  // rather than repeating the filename back at the reader.
  const asDate = note.date ? parseISO(note.date) : parseISO(title);
  const isDateNamed = (note.isDaily || /^\d{4}-\d{2}-\d{2}$/.test(title)) && isValid(asDate);

  const heading = isDateNamed ? format(asDate, 'd MMMM') : title;
  const label = isDateNamed
    ? format(asDate, 'EEEE · yyyy')
    : note.updatedAt
      ? `Edited ${format(new Date(note.updatedAt), 'd MMM yyyy')}`
      : null;

  return (
    <header
      style={{
        maxWidth: 'var(--editor-measure)',
        margin: '0 auto',
        padding: '48px 0 20px',
        borderBottom: '1px solid var(--border-muted)',
      }}
    >
      <h1
        style={{
          fontFamily: 'var(--font-display)',
          fontSize: 'clamp(26px, 3vw, 32px)',
          lineHeight: 1.15,
          fontWeight: 400,
          letterSpacing: '-0.02em',
          color: 'var(--text-primary)',
          margin: 0,
          overflowWrap: 'anywhere',
        }}
      >
        {heading}
      </h1>
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

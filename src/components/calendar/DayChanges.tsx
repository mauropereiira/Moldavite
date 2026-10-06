import { useMemo } from 'react';
import { format, isToday } from 'date-fns';
import { useNotes } from '@/hooks';
import { filenameToNote } from '@/lib/fileSystem';
import { useNoteStore } from '@/stores';
import type { NoteFile } from '@/types';
import { changesOnDay, type DayChange } from './noteChanges';

const KIND_LABEL: Record<DayChange['kind'], string> = {
  created: 'Created',
  'created-edited': 'Created, then edited',
  edited: 'Edited',
};

function folderLabel(note: NoteFile): string {
  if (note.isDaily) return 'Daily';
  if (note.isWeekly) return 'Weekly';
  return note.folderPath ?? 'Notes';
}

function timeDescription(change: DayChange): string {
  const at = format(change.at, 'HH:mm');
  if (change.kind === 'edited') return `Edited at ${at}`;
  const created = format(change.createdAt ?? change.at, 'HH:mm');
  return change.kind === 'created'
    ? `Created at ${created}`
    : `Created at ${created}, edited at ${at}`;
}

/**
 * What changed on the selected day: the notes created or edited then, from
 * the times their files carry. Names only, so a locked note shows nothing of
 * what it holds.
 */
export function DayChanges({ onNavigate }: { onNavigate?: () => void }) {
  const selectedDate = useNoteStore((state) => state.selectedDate);
  const notes = useNoteStore((state) => state.notes);
  const { loadNote } = useNotes();
  const changes = useMemo(() => changesOnDay(notes, selectedDate), [notes, selectedDate]);
  const today = isToday(selectedDate);

  const open = (note: NoteFile) => {
    void loadNote(note);
    onNavigate?.();
  };

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <div className="pb-3">
        <div
          className="text-[10px] uppercase"
          style={{ color: 'var(--text-muted)', letterSpacing: '0.14em' }}
        >
          Changed
        </div>
        <h3
          style={{
            color: 'var(--text-primary)',
            fontFamily: 'var(--font-display)',
            fontSize: '15px',
            fontWeight: 400,
            letterSpacing: 0,
          }}
        >
          {today ? 'Today' : format(selectedDate, 'EEE, MMM d')}
        </h3>
      </div>

      {changes.length === 0 ? (
        <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
          {today ? 'Nothing has changed today yet.' : 'Nothing changed on this day.'}
        </p>
      ) : (
        <ul aria-label="Notes changed" className="min-h-0 flex-1 overflow-y-auto">
          {changes.map((change) => (
            <li key={change.note.path}>
              <button
                type="button"
                onClick={() => open(change.note)}
                className="note-card focus-ring block w-full text-left"
                title={timeDescription(change)}
              >
                <span className="flex min-w-0 items-baseline gap-2">
                  <span className="note-card-title min-w-0 flex-1 truncate text-sm">
                    {filenameToNote(change.note, '').title}
                  </span>
                  {change.note.isLocked && (
                    <span
                      className="flex-shrink-0 text-[10px]"
                      style={{ color: 'var(--text-muted)' }}
                    >
                      Locked
                    </span>
                  )}
                  <time
                    dateTime={new Date(change.at).toISOString()}
                    className="flex-shrink-0 text-[11px] tabular-nums"
                    style={{ color: 'var(--text-muted)' }}
                  >
                    {format(change.at, 'HH:mm')}
                  </time>
                </span>
                <span className="block truncate text-[11px]" style={{ color: 'var(--text-muted)' }}>
                  {folderLabel(change.note)} · {KIND_LABEL[change.kind]}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

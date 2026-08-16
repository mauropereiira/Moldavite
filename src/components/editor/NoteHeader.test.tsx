import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { NoteHeader } from './NoteHeader';
import type { Note } from '@/types';

const note = (over: Partial<Note> = {}) =>
  ({
    id: 'notes/untitled.md',
    title: 'Untitled',
    content: '',
    isDaily: false,
    isWeekly: false,
    ...over,
  }) as Note;

describe('NoteHeader', () => {
  it('renames from the title itself, without going through a menu', async () => {
    const onRename = vi.fn().mockResolvedValue(undefined);
    render(<NoteHeader note={note()} onRename={onRename} />);

    const field = screen.getByLabelText('Note title');
    await userEvent.clear(field);
    await userEvent.type(field, 'Roadmap{Enter}');

    expect(onRename).toHaveBeenCalledWith('Roadmap');
  });

  it('abandons the edit on Escape and shows the real name again', async () => {
    const onRename = vi.fn();
    render(<NoteHeader note={note()} onRename={onRename} />);

    const field = screen.getByLabelText('Note title');
    await userEvent.clear(field);
    await userEvent.type(field, 'Half a thou{Escape}');

    expect(onRename).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Note title')).toHaveValue('Untitled');
  });

  // Renaming to nothing would leave a note that cannot be addressed at all.
  it('refuses an empty title and restores the previous one', async () => {
    const onRename = vi.fn();
    render(<NoteHeader note={note()} onRename={onRename} />);

    const field = screen.getByLabelText('Note title');
    await userEvent.clear(field);
    await userEvent.tab();

    expect(onRename).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Note title')).toHaveValue('Untitled');
  });

  // A failed rename must not leave the page displaying a name the file on disk
  // does not have — `renameNote` reports the reason itself.
  it('puts the old name back when the rename fails', async () => {
    const onRename = vi.fn().mockRejectedValue(new Error('Invalid note name'));
    render(<NoteHeader note={note()} onRename={onRename} />);

    const field = screen.getByLabelText('Note title');
    await userEvent.clear(field);
    await userEvent.type(field, 'bad/name{Enter}');

    expect(onRename).toHaveBeenCalled();
    expect(await screen.findByLabelText('Note title')).toHaveValue('Untitled');
  });

  // Daily notes are named by date and the rename command rejects them, so
  // offering an editable field here would be a promise the app cannot keep.
  it('leaves a daily note read-only', () => {
    render(
      <NoteHeader
        note={note({ id: '2026-08-16.md', title: '2026-08-16', isDaily: true, date: '2026-08-16' })}
        onRename={vi.fn()}
      />
    );

    expect(screen.queryByLabelText('Note title')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '16 August' })).toBeInTheDocument();
  });
});

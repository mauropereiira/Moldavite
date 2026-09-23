import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { NoteHeader } from './NoteHeader';
import type { Note } from '@/types';
import { requestTitleFocus } from '@/lib/noteTitleFocus';

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

  it('reports a name the rename would reject under the field while it is typed', async () => {
    const onRename = vi.fn();
    render(<NoteHeader note={note()} onRename={onRename} />);

    const field = screen.getByLabelText('Note title');
    await userEvent.clear(field);
    await userEvent.type(field, 'bad/name{Enter}');

    expect(screen.getByRole('alert')).toHaveTextContent(
      'Title can only contain letters, numbers, spaces, and hyphens'
    );
    expect(field).toHaveAttribute('aria-invalid', 'true');
    expect(field).toHaveValue('bad/name');
    expect(field).toHaveFocus();
    expect(onRename).not.toHaveBeenCalled();

    await userEvent.tab();

    expect(field).toHaveValue('Untitled');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  // A failed rename must not leave the page displaying a name the file on disk
  // does not have once the field is left.
  it('shows why a rename failed and puts the old name back on leaving', async () => {
    const onRename = vi.fn().mockRejectedValue(new Error('A note with this name already exists'));
    const onSubmit = vi.fn();
    render(<NoteHeader note={note()} onRename={onRename} onSubmit={onSubmit} />);

    const field = screen.getByLabelText('Note title');
    await userEvent.clear(field);
    await userEvent.type(field, 'Roadmap{Enter}');

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'A note with this name already exists'
    );
    expect(field).toHaveValue('Roadmap');
    expect(onSubmit).not.toHaveBeenCalled();

    await userEvent.tab();

    expect(field).toHaveValue('Untitled');
  });

  it('hands the caret to the body after Enter, renaming once', async () => {
    const onRename = vi.fn().mockResolvedValue(undefined);
    const onSubmit = vi.fn(() => (document.activeElement as HTMLElement).blur());
    render(<NoteHeader note={note()} onRename={onRename} onSubmit={onSubmit} />);

    const field = screen.getByLabelText('Note title');
    await userEvent.clear(field);
    await userEvent.type(field, 'Roadmap{Enter}');

    await vi.waitFor(() => expect(onSubmit).toHaveBeenCalledOnce());
    expect(onRename).toHaveBeenCalledOnce();
    expect(onRename).toHaveBeenCalledWith('Roadmap');
  });

  // A new note on the phone opens on its name, ready to be typed over.
  it('takes the focus with the name selected when the new note asks for it', () => {
    requestTitleFocus('notes/untitled.md');
    render(<NoteHeader note={note()} onRename={vi.fn()} />);

    const field = screen.getByLabelText('Note title') as HTMLInputElement;
    expect(field).toHaveFocus();
    expect([field.selectionStart, field.selectionEnd]).toEqual([0, 'Untitled'.length]);
  });

  it('leaves the focus alone for a note that did not ask', () => {
    render(<NoteHeader note={note()} onRename={vi.fn()} />);

    expect(screen.getByLabelText('Note title')).not.toHaveFocus();
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

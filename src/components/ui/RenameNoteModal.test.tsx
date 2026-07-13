import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { NoteFile } from '@/types';
import { RenameNoteModal } from './RenameNoteModal';

const note: NoteFile = {
  name: 'Original title.md',
  path: 'notes/Original title.md',
  isDaily: false,
  isWeekly: false,
  isLocked: false,
};

describe('RenameNoteModal', () => {
  it('starts with the current title, validates, and submits with Enter', async () => {
    const user = userEvent.setup();
    const onRename = vi.fn().mockResolvedValue(undefined);
    render(<RenameNoteModal note={note} onRename={onRename} onClose={vi.fn()} />);

    const input = screen.getByRole('textbox', { name: 'Note title' });
    expect(input).toHaveValue('Original title');

    await user.clear(input);
    await user.type(input, 'bad/title');
    await user.click(screen.getByRole('button', { name: 'Rename' }));
    expect(
      screen.getByText('Title can only contain letters, numbers, spaces, and hyphens')
    ).toBeInTheDocument();
    expect(onRename).not.toHaveBeenCalled();

    await user.clear(input);
    await user.type(input, 'New title{Enter}');
    expect(onRename).toHaveBeenCalledWith(note, 'New title');
  });

  it('cancels with Escape', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<RenameNoteModal note={note} onRename={vi.fn()} onClose={onClose} />);

    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledOnce();
  });
});

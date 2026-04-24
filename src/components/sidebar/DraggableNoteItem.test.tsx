import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DraggableNoteItem } from './DraggableNoteItem';
import type { NoteFile } from '@/types';

const baseNote: NoteFile = {
  name: 'Hello.md',
  path: 'notes/Hello.md',
  isDaily: false,
  isWeekly: false,
  isLocked: false,
};

describe('DraggableNoteItem', () => {
  it('renders the note name without the .md suffix', () => {
    render(
      <DraggableNoteItem
        note={baseNote}
        isActive={false}
        onClick={vi.fn()}
        onContextMenu={vi.fn()}
      />,
    );
    expect(screen.getByText('Hello')).toBeInTheDocument();
  });

  it('passes the note back to onClick', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(
      <DraggableNoteItem
        note={baseNote}
        isActive={false}
        onClick={onClick}
        onContextMenu={vi.fn()}
      />,
    );
    await user.click(screen.getByRole('button', { name: /Hello/i }));
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(onClick.mock.calls[0][0]).toBe(baseNote);
  });
});

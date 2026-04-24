import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DraggableNoteItem } from './DraggableNoteItem';
import { useNoteSelectionStore } from '@/stores';
import type { NoteFile } from '@/types';

const baseNote: NoteFile = {
  name: 'Hello.md',
  path: 'notes/Hello.md',
  isDaily: false,
  isWeekly: false,
  isLocked: false,
};

describe('DraggableNoteItem', () => {
  beforeEach(() => {
    useNoteSelectionStore.getState().clear();
  });

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

  it('routes shift-click to onSelectionClick instead of onClick', () => {
    const onClick = vi.fn();
    const onSelectionClick = vi.fn();
    render(
      <DraggableNoteItem
        note={baseNote}
        isActive={false}
        onClick={onClick}
        onSelectionClick={onSelectionClick}
        onContextMenu={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /Hello/i }), { shiftKey: true });
    expect(onSelectionClick).toHaveBeenCalledTimes(1);
    expect(onClick).not.toHaveBeenCalled();
  });

  it('cmd-click falls through to onClick when no selection exists (open-in-new-tab)', () => {
    const onClick = vi.fn();
    const onSelectionClick = vi.fn();
    render(
      <DraggableNoteItem
        note={baseNote}
        isActive={false}
        onClick={onClick}
        onSelectionClick={onSelectionClick}
        onContextMenu={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /Hello/i }), { metaKey: true });
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(onSelectionClick).not.toHaveBeenCalled();
  });

  it('cmd-click routes to onSelectionClick when a selection already exists', () => {
    useNoteSelectionStore.getState().toggle('notes/Other.md');
    const onClick = vi.fn();
    const onSelectionClick = vi.fn();
    render(
      <DraggableNoteItem
        note={baseNote}
        isActive={false}
        onClick={onClick}
        onSelectionClick={onSelectionClick}
        onContextMenu={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /Hello/i }), { metaKey: true });
    expect(onSelectionClick).toHaveBeenCalledTimes(1);
    expect(onClick).not.toHaveBeenCalled();
  });

  it('preserves drag data for single-note drag after selection changes', () => {
    render(
      <DraggableNoteItem
        note={baseNote}
        isActive={false}
        onClick={vi.fn()}
        onContextMenu={vi.fn()}
      />,
    );
    // The draggable container is the group wrapping the row.
    const row = screen.getByRole('button', { name: /Hello/i });
    const draggable = row.parentElement as HTMLElement;
    const dataTransfer = {
      data: new Map<string, string>(),
      setData(type: string, value: string) {
        this.data.set(type, value);
      },
      getData(type: string) {
        return this.data.get(type) ?? '';
      },
      effectAllowed: '',
      types: [] as string[],
    };
    fireEvent.dragStart(draggable, { dataTransfer });
    expect(dataTransfer.getData('application/x-note-path')).toBe('Hello.md');
    expect(dataTransfer.getData('text/plain')).toBe('Hello.md');
  });
});

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, render, screen, fireEvent } from '@testing-library/react';
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
  let dragFrame: ((time: number) => void) | null;

  beforeEach(() => {
    useNoteSelectionStore.getState().clear();
    dragFrame = null;
    vi.stubGlobal(
      'requestAnimationFrame',
      vi.fn((callback: (time: number) => void) => {
        dragFrame = callback;
        return 17;
      })
    );
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
  });

  afterEach(() => vi.unstubAllGlobals());

  it('renders the note name without the .md suffix', () => {
    render(
      <DraggableNoteItem
        note={baseNote}
        isActive={false}
        onClick={vi.fn()}
        onContextMenu={vi.fn()}
      />
    );
    expect(screen.getByText('Hello')).toBeInTheDocument();
  });

  it('truncates long titles before Options without shortening the accessible name', () => {
    const title = 'An exceptionally long note title that cannot fit beside the options action';
    render(
      <DraggableNoteItem
        note={{ ...baseNote, name: `${title}.md`, path: `notes/${title}.md` }}
        isActive={false}
        onClick={vi.fn()}
        onContextMenu={vi.fn()}
      />
    );

    const row = screen.getByRole('button', { name: title });
    const visibleTitle = screen.getByText(title);

    expect(visibleTitle).toHaveTextContent(title);
    expect(visibleTitle).toHaveClass('min-w-0', 'truncate');
    expect(visibleTitle.parentElement).toHaveClass('min-w-0');
    expect(row).toHaveAccessibleName(title);
    expect(row.style.paddingRight).toBe('3.5rem');
  });

  it('reveals Note options when the control receives keyboard focus', () => {
    render(
      <DraggableNoteItem
        note={baseNote}
        isActive={false}
        onClick={vi.fn()}
        onContextMenu={vi.fn()}
      />
    );

    expect(screen.getByRole('button', { name: 'Note options' })).toHaveClass(
      'focus-visible:opacity-100'
    );
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
      />
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
      />
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
      />
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
      />
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
      />
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

  it('dims the source only on the frame after the native drag preview is captured', () => {
    render(
      <DraggableNoteItem
        note={baseNote}
        isActive={false}
        onClick={vi.fn()}
        onContextMenu={vi.fn()}
      />
    );
    const draggable = screen.getByRole('button', { name: /Hello/i }).parentElement as HTMLElement;
    const dataTransfer = {
      setData: vi.fn(),
      getData: vi.fn(() => ''),
      effectAllowed: '',
      types: [] as string[],
    };

    fireEvent.dragStart(draggable, { dataTransfer });
    expect(draggable).not.toHaveClass('sidebar-note-drag-source');

    act(() => dragFrame?.(16));
    expect(draggable).toHaveClass('sidebar-note-drag-source');

    fireEvent.dragEnd(draggable, { dataTransfer });
    expect(draggable).not.toHaveClass('sidebar-note-drag-source');
  });

  it.each([
    ['daily', { ...baseNote, path: 'daily/2026-08-25.md', isDaily: true }],
    ['weekly', { ...baseNote, path: 'weekly/2026-W35.md', isWeekly: true }],
    ['locked', { ...baseNote, isLocked: true }],
  ])('does not advertise %s notes as movable into standalone folders', (_label, note) => {
    render(
      <DraggableNoteItem note={note} isActive={false} onClick={vi.fn()} onContextMenu={vi.fn()} />
    );

    const draggable = screen.getByRole('button', { name: /Hello/i }).parentElement as HTMLElement;
    expect(draggable).toHaveAttribute('draggable', 'false');
  });

  it('keeps a locked standalone note draggable when manual reordering is available', () => {
    render(
      <DraggableNoteItem
        note={{ ...baseNote, isLocked: true }}
        isActive={false}
        onClick={vi.fn()}
        onContextMenu={vi.fn()}
        onReorder={vi.fn()}
      />
    );

    const draggable = screen.getByRole('button', { name: /Hello/i }).parentElement as HTMLElement;
    expect(draggable).toHaveAttribute('draggable', 'true');
  });
});

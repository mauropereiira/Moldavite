import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { IconRailTrash } from './IconRailTrash';
import type { TrashedNote } from '@/types';

const note: TrashedNote = {
  id: '1',
  filename: 'Plan.md',
  originalPath: 'Plan.md',
  isDaily: false,
  isWeekly: false,
  isFolder: false,
  containedFiles: [],
  trashedAt: 0,
  daysRemaining: 7,
};

const restoreNote = vi.fn(async () => undefined);
const permanentlyDelete = vi.fn(async (_id: string) => undefined);
const emptyTrash = vi.fn(async () => undefined);

vi.mock('@/hooks/useTrash', () => ({
  useTrash: () => ({
    trashedNotes: [note],
    loadTrash: vi.fn(async () => undefined),
    restoreNote,
    permanentlyDelete,
    emptyTrash,
    cleanupOld: vi.fn(async () => undefined),
  }),
}));

vi.mock('@/components/sidebar/TrashPopover', () => ({
  TrashPopover: ({
    onClose,
    onPreview,
    onPermanentDelete,
    onEmptyTrash,
  }: {
    onClose: () => void;
    onPreview: (note: TrashedNote) => void;
    onPermanentDelete: (id: string) => void;
    onEmptyTrash: () => void;
  }) => (
    <div>
      <button onClick={() => onPreview(note)}>Preview</button>
      <button onClick={onClose}>Outside press</button>
      <button onClick={() => onPermanentDelete(note.id)}>Delete from popover</button>
      <button onClick={onEmptyTrash}>Empty from popover</button>
    </div>
  ),
}));

vi.mock('@/components/sidebar/TrashPreviewModal', () => ({
  TrashPreviewModal: ({ onRestore }: { onRestore: (id: string) => void }) => (
    <button onClick={() => onRestore('1')}>Restore from preview</button>
  ),
}));

describe('IconRailTrash', () => {
  // A press in the preview lands outside the popover, which used to close the
  // whole rail Trash and unmount the preview before its click arrived.
  it('keeps the preview when the popover sees a press outside it', async () => {
    const onClose = vi.fn();
    render(<IconRailTrash anchor={document.createElement('button')} onClose={onClose} />);

    fireEvent.click(screen.getByRole('button', { name: 'Preview' }));
    const restore = await screen.findByRole('button', { name: 'Restore from preview' });
    fireEvent.click(screen.getByRole('button', { name: 'Outside press' }));

    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(restore);
    expect(restoreNote).toHaveBeenCalledWith('1');
  });

  it('asks before deleting a note for good, and keeps the popover open meanwhile', async () => {
    const onClose = vi.fn();
    render(<IconRailTrash anchor={document.createElement('button')} onClose={onClose} />);

    fireEvent.click(screen.getByRole('button', { name: 'Delete from popover' }));
    expect(permanentlyDelete).not.toHaveBeenCalled();
    const dialog = screen.getByRole('dialog', { name: 'Delete permanently?' });
    expect(dialog).toHaveTextContent('"Plan" will be deleted permanently. This cannot be undone.');

    fireEvent.click(screen.getByRole('button', { name: 'Outside press' }));
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(permanentlyDelete).toHaveBeenCalledWith('1'));
  });

  it('asks before emptying the Trash', async () => {
    render(<IconRailTrash anchor={document.createElement('button')} onClose={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: 'Empty from popover' }));
    expect(emptyTrash).not.toHaveBeenCalled();
    const dialog = screen.getByRole('dialog', { name: 'Empty the Trash?' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Empty trash' }));
    await waitFor(() => expect(emptyTrash).toHaveBeenCalled());
  });
});

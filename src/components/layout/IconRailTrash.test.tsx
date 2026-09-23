import { fireEvent, render, screen } from '@testing-library/react';
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

vi.mock('@/hooks/useTrash', () => ({
  useTrash: () => ({
    trashedNotes: [note],
    loadTrash: vi.fn(async () => undefined),
    restoreNote,
    permanentlyDelete: vi.fn(async () => undefined),
    emptyTrash: vi.fn(async () => undefined),
    cleanupOld: vi.fn(async () => undefined),
  }),
}));

vi.mock('@/components/sidebar/TrashPopover', () => ({
  TrashPopover: ({
    onClose,
    onPreview,
  }: {
    onClose: () => void;
    onPreview: (note: TrashedNote) => void;
  }) => (
    <div>
      <button onClick={() => onPreview(note)}>Preview</button>
      <button onClick={onClose}>Outside press</button>
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
});

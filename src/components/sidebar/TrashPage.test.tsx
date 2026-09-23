import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TrashPage } from './TrashPage';
import type { TrashedNote } from '@/types';

const trash = vi.hoisted(() => ({
  notes: [] as TrashedNote[],
  loadTrash: vi.fn(async () => undefined),
  restoreNote: vi.fn(async (_id: string) => undefined),
  permanentlyDelete: vi.fn(async (_id: string) => undefined),
  emptyTrash: vi.fn(async () => undefined),
  cleanupOld: vi.fn(async () => undefined),
}));

vi.mock('@/hooks/useTrash', () => ({
  useTrash: () => ({ trashedNotes: trash.notes, ...trash }),
}));

vi.mock('./TrashPreviewModal', () => ({
  TrashPreviewModal: ({
    note,
    onRestore,
  }: {
    note: TrashedNote;
    onRestore: (id: string) => void;
  }) => (
    <div role="dialog" aria-label="Preview">
      <button onClick={() => onRestore(note.id)}>Restore from preview</button>
    </div>
  ),
}));

const item = (id: string, filename: string): TrashedNote => ({
  id,
  filename,
  originalPath: filename,
  isDaily: false,
  isWeekly: false,
  isFolder: false,
  containedFiles: [],
  trashedAt: 0,
  daysRemaining: 6,
});

async function renderPage() {
  render(<TrashPage isOpen onClose={vi.fn()} />);
  return screen.findByRole('region', { name: 'Trash' });
}

describe('TrashPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    trash.notes = [item('1', 'Plan.md'), item('2', 'Diary.md.locked')];
  });

  it('gives each note its own touch-sized Restore and Delete', async () => {
    await renderPage();

    const restore = screen.getByRole('button', { name: 'Restore Plan' });
    const remove = screen.getByRole('button', { name: 'Delete Plan permanently' });
    expect(restore.style.minHeight).toBe('var(--touch-target)');
    expect(remove.style.minHeight).toBe('var(--touch-target)');
    expect(screen.getByText(/^Locked · /)).toBeInTheDocument();

    fireEvent.click(restore);
    expect(trash.restoreNote).toHaveBeenCalledWith('1');
  });

  it('asks before deleting a note for good', async () => {
    await renderPage();

    fireEvent.click(screen.getByRole('button', { name: 'Delete Diary permanently' }));
    expect(trash.permanentlyDelete).not.toHaveBeenCalled();

    const dialog = screen.getByRole('dialog', { name: 'Delete permanently?' });
    expect(dialog).toHaveTextContent('"Diary" will be deleted permanently. This cannot be undone.');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(trash.permanentlyDelete).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Delete Diary permanently' }));
    fireEvent.click(
      within(screen.getByRole('dialog', { name: 'Delete permanently?' })).getByRole('button', {
        name: 'Delete',
      })
    );
    await waitFor(() => expect(trash.permanentlyDelete).toHaveBeenCalledWith('2'));
  });

  it('restores from the preview with one tap', async () => {
    await renderPage();

    fireEvent.click(screen.getByRole('button', { name: /^Plan/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Restore from preview' }));

    expect(trash.restoreNote).toHaveBeenCalledWith('1');
  });

  it('asks before emptying the Trash', async () => {
    await renderPage();

    fireEvent.click(screen.getByRole('button', { name: 'Empty trash' }));
    expect(trash.emptyTrash).not.toHaveBeenCalled();

    const dialog = screen.getByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Empty trash' }));
    await waitFor(() => expect(trash.emptyTrash).toHaveBeenCalled());
  });
});

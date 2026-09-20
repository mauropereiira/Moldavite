import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TrashedNote } from '@/types';

const invokeMock = vi.fn();

vi.mock('@/lib/ipc', () => ({
  safeInvoke: (...args: unknown[]) => invokeMock(...args),
}));

import { TrashPreviewModal } from './TrashPreviewModal';

function trashed(id: string, filename: string): TrashedNote {
  return {
    id,
    filename,
    originalPath: `notes/${filename}`,
    isDaily: false,
    isWeekly: false,
    isFolder: false,
    containedFiles: [],
    trashedAt: 1758326400,
    daysRemaining: 7,
  };
}

beforeEach(() => {
  invokeMock.mockReset();
});

describe('TrashPreviewModal', () => {
  it('does not show the previous note body while the next one loads', async () => {
    const pending = new Promise<string>(() => {});
    invokeMock.mockImplementation(async (command: string, args?: Record<string, unknown>) => {
      if (command !== 'read_trashed_note') return undefined;
      return args?.trashId === 'trash-1' ? 'Secrets of the first note' : pending;
    });

    const props = {
      onClose: () => {},
      onRestore: () => {},
      onPermanentDelete: () => {},
    };
    const view = render(<TrashPreviewModal note={trashed('trash-1', 'first.md')} {...props} />);
    await waitFor(() => expect(screen.getByText(/Secrets of the first note/)).toBeInTheDocument());

    view.rerender(<TrashPreviewModal note={trashed('trash-2', 'second.md')} {...props} />);

    await screen.findByText('second');
    expect(screen.queryByText(/Secrets of the first note/)).not.toBeInTheDocument();
  });
});

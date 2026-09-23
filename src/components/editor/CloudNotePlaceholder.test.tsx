import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Note } from '@/types';

const invokeMock = vi.fn();

vi.mock('@/lib/ipc', () => ({
  safeInvoke: (...args: unknown[]) => invokeMock(...args),
}));

import { CloudNotePlaceholder } from './CloudNotePlaceholder';
import { useCloudDownloadStore } from '@/lib/cloudNotes';

const note: Note = {
  id: 'notes/Plan.md',
  title: 'Plan',
  content: '',
  createdAt: new Date(0),
  updatedAt: new Date(0),
  isDaily: false,
  isWeekly: false,
  cloudPending: true,
};

beforeEach(() => {
  invokeMock.mockReset();
  invokeMock.mockResolvedValue({ downloaded: false, error: null });
  useCloudDownloadStore.setState({ downloads: {} });
});

describe('CloudNotePlaceholder', () => {
  it('offers Download, then shows progress', async () => {
    render(<CloudNotePlaceholder note={note} />);
    expect(screen.getByRole('heading', { name: 'This note is in iCloud' })).toBeInTheDocument();

    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Download' })));

    expect(invokeMock).toHaveBeenCalledWith('icloud_download_note', {
      filename: 'Plan.md',
      isDaily: false,
      isWeekly: false,
    });
    expect(screen.getByText('Downloading…')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Download' })).toBeNull();
  });

  it('shows a failure inline with Try again', async () => {
    invokeMock.mockResolvedValue({ downloaded: false, error: 'Not enough storage.' });
    render(<CloudNotePlaceholder note={note} />);

    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Download' })));

    expect(screen.getByRole('alert')).toHaveTextContent('Not enough storage.');
    invokeMock.mockResolvedValue({ downloaded: false, error: null });
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Try again' })));
    expect(invokeMock).toHaveBeenCalledTimes(2);
    expect(screen.getByText('Downloading…')).toBeInTheDocument();
  });
});

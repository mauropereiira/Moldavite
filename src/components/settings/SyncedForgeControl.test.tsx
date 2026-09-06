import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import SyncedForgeControl from './SyncedForgeControl';
import { openForgeInFinder } from '@/lib/fileSystem';
vi.mock('@/lib/fileSystem', () => ({ openForgeInFinder: vi.fn().mockResolvedValue(undefined) }));

const state = vi.hoisted(() => ({
  forges: [
    { id: 'icloud://moldavite', name: 'Synced Forge', isSynced: true, isActive: false, path: '' },
  ],
  loadForges: vi.fn().mockResolvedValue(undefined),
  setSyncedForge: vi.fn(),
}));
vi.mock('@/stores', () => ({ useForgeStore: () => state }));

beforeEach(() => {
  state.setSyncedForge.mockReset();
  state.forges[0].isActive = false;
  state.forges[0].path = '';
  vi.mocked(openForgeInFinder).mockClear();
});

it('shows a failed connection inside the control so modal users can read it', async () => {
  state.setSyncedForge.mockRejectedValue(new Error('iCloud Drive is unavailable'));
  render(<SyncedForgeControl />);
  fireEvent.click(screen.getByRole('switch', { name: 'Use synced Forge' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('iCloud Drive is unavailable');
  expect(screen.getByRole('switch')).toHaveAttribute('aria-checked', 'false');
  expect(screen.getByRole('switch')).toBeEnabled();
});

it('lets Mac users open the connected synced folder', () => {
  state.forges[0].isActive = true;
  state.forges[0].path = '/icloud/Documents';
  render(<SyncedForgeControl />);
  fireEvent.click(screen.getByRole('button', { name: 'Open synced folder in Finder' }));
  expect(openForgeInFinder).toHaveBeenCalledOnce();
});

it('does not offer Finder until the synced folder is connected', () => {
  render(<SyncedForgeControl />);
  expect(
    screen.queryByRole('button', { name: 'Open synced folder in Finder' })
  ).not.toBeInTheDocument();
});

import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import SyncedForgeControl from './SyncedForgeControl';

const state = vi.hoisted(() => ({
  forges: [{ id: 'icloud://moldavite', name: 'Synced Forge', isSynced: true, isActive: false, path: '' }],
  loadForges: vi.fn().mockResolvedValue(undefined),
  setSyncedForge: vi.fn(),
}));
vi.mock('@/stores', () => ({ useForgeStore: () => state }));

beforeEach(() => { state.setSyncedForge.mockReset(); });

it('shows a failed connection inside the control so modal users can read it', async () => {
  state.setSyncedForge.mockRejectedValue(new Error('iCloud Drive is unavailable'));
  render(<SyncedForgeControl />);
  fireEvent.click(screen.getByRole('switch', { name: 'Use synced Forge' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('iCloud Drive is unavailable');
  expect(screen.getByRole('switch')).toHaveAttribute('aria-checked', 'false');
  expect(screen.getByRole('switch')).toBeEnabled();
});

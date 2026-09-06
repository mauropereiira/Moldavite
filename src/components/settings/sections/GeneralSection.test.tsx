import { act, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useSettingsStore } from '@/stores';

const platform = vi.hoisted(() => ({ mobile: false }));
vi.mock('@/lib/platform', () => ({ isMobilePlatform: () => platform.mobile }));

vi.mock('@tauri-apps/plugin-dialog', () => ({ open: vi.fn(), save: vi.fn() }));

const FORGE = '/Users/someone/Documents/Moldavite/Default';
vi.mock('@/lib', async () => {
  const actual = await vi.importActual<typeof import('@/lib')>('@/lib');
  return {
    ...actual,
    getNotesDirectory: () => Promise.resolve(FORGE),
    getForgesRoot: () => Promise.resolve('/Users/someone/Documents/Moldavite'),
  };
});

import { GeneralSection } from './GeneralSection';

async function renderSection() {
  render(<GeneralSection />);
  // Let the mount-time directory lookups settle.
  await act(async () => {});
}

describe('GeneralSection', () => {
  beforeEach(() => {
    useSettingsStore.getState().resetToDefaults();
  });

  it('offers the folder picker and Finder button on the desktop', async () => {
    platform.mobile = false;
    await renderSection();

    expect(screen.getByText('Forges folder')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Change' })).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /Open Forge in Finder|Show in Explorer/ })
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Rescan Forge' })).toBeInTheDocument();
    expect(screen.getByText(FORGE)).toHaveClass('break-all');
  });

  it('hides the folder picker and Finder button on a phone and the internal container path', async () => {
    platform.mobile = true;
    await renderSection();

    expect(screen.queryByText('Forges folder')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Change' })).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /Open Forge in Finder|Show in Explorer/ })
    ).not.toBeInTheDocument();
    expect(screen.queryByText(/does not move your files/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Rescan Forge' })).toBeInTheDocument();

    expect(screen.queryByText(FORGE)).not.toBeInTheDocument();
  });
});

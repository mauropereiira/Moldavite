import { act, fireEvent, render, screen } from '@testing-library/react';
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
    expect(screen.getByText('/Users/someone/Documents/Moldavite')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Change' })).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /Open in Finder|Show in Explorer/ })
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Rescan' })).toBeInTheDocument();
  });

  // The long paragraphs moved behind (i): the Forge path and the note that
  // changing the folder moves nothing are one hover away, not on the page.
  it('keeps the Forge path and the move warning behind (i)', async () => {
    platform.mobile = false;
    await renderSection();

    expect(screen.queryByText(/This Forge is at/)).not.toBeInTheDocument();
    expect(screen.queryByText(/doesn't move any files/)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'About This Forge' }));
    expect(screen.getByRole('tooltip')).toHaveTextContent(`This Forge is at ${FORGE}`);
    const next = screen.getByRole('button', { name: 'About Forges folder' });
    fireEvent.pointerDown(next);
    fireEvent.click(next);
    expect(screen.getByRole('tooltip')).toHaveTextContent(/doesn't move any files/);
  });

  it('hides the folder picker and Finder button on a phone and the internal container path', async () => {
    platform.mobile = true;
    await renderSection();

    expect(screen.queryByText('Forges folder')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Change' })).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /Open in Finder|Show in Explorer/ })
    ).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Rescan' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'About This Forge' }));
    expect(screen.getByRole('tooltip')).not.toHaveTextContent(FORGE);
  });

  // Data has the same actions; General repeated them.
  it('does not repeat the backup controls that live in Data', async () => {
    await renderSection();

    expect(screen.queryByText(/Encrypted backup/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Export|Import/ })).not.toBeInTheDocument();
  });

  // Auto-save is fixed at 300 ms with no setting, and Delete all notes moved to Data.
  it('keeps only auto-lock below the Forge', async () => {
    await renderSection();

    expect(screen.queryByText(/Auto-save|save status/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Danger zone|Delete all notes/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('radio', { name: '30 min' }));
    expect(useSettingsStore.getState().autoLockTimeout).toBe(30);
  });
});

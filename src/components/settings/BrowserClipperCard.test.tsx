import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BrowserClipperCard } from './BrowserClipperCard';

const invoke = vi.fn();
const shellOpen = vi.fn();

vi.mock('@/lib/ipc', () => ({ safeInvoke: (...args: unknown[]) => invoke(...args) }));
vi.mock('@tauri-apps/plugin-shell', () => ({ open: (...args: unknown[]) => shellOpen(...args) }));

const installButton = () => screen.findByRole('button', { name: /install extension/i });

describe('BrowserClipperCard', () => {
  beforeEach(() => {
    invoke.mockReset().mockResolvedValue([{ label: 'Chrome', connected: false }]);
    shellOpen.mockReset().mockResolvedValue(undefined);
  });

  it('never navigates until the steps are acknowledged', async () => {
    render(<BrowserClipperCard />);

    fireEvent.click(await installButton());
    expect(shellOpen).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: /skip for now/i }));
    expect(shellOpen).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).toBeNull();

    fireEvent.click(await installButton());
    fireEvent.click(screen.getByRole('button', { name: /understood/i }));

    expect(shellOpen).toHaveBeenCalledTimes(1);
    expect(shellOpen.mock.calls[0][0]).toContain('/tree/main/extension');
  });

  it('shows one set of steps at a time', async () => {
    render(<BrowserClipperCard />);
    fireEvent.click(await installButton());
    // Scoped to the sheet: "Developer mode" also appears in the card's own
    // status line, which is the point of it being there.
    const sheet = within(screen.getByRole('dialog'));

    fireEvent.click(sheet.getByRole('button', { name: /chrome, edge & brave/i }));
    expect(sheet.getByText(/Load unpacked/)).toBeVisible();

    fireEvent.click(sheet.getByRole('button', { name: /^firefox$/i }));
    expect(sheet.queryByText(/Load unpacked/)).toBeNull();
    expect(sheet.getByText(/signed by Mozilla/)).toBeVisible();
  });

  it('reports which browsers are paired', async () => {
    invoke.mockResolvedValue([
      { label: 'Chrome', connected: true },
      { label: 'Firefox', connected: false },
    ]);

    render(<BrowserClipperCard />);

    await waitFor(() => expect(screen.getByText(/Connected: Chrome/)).toBeVisible());
  });

  it('tells you what to do next when nothing is paired', async () => {
    render(<BrowserClipperCard />);

    await waitFor(() => expect(screen.getByText(/Not connected yet/)).toBeVisible());
    expect(screen.getByText(/Developer mode/)).toBeVisible();
  });

  it('surfaces a failure to pair instead of claiming success', async () => {
    invoke.mockImplementation((command: string) =>
      command === 'connect_browser_bridge'
        ? Promise.reject(new Error('No supported browser was found on this machine.'))
        : Promise.resolve([{ label: 'Chrome', connected: false }])
    );

    render(<BrowserClipperCard />);
    fireEvent.click(await screen.findByRole('button', { name: /connect browser/i }));

    await waitFor(() => expect(screen.getByText(/No supported browser was found/)).toBeVisible());
  });
});

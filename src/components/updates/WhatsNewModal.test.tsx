import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import { WhatsNewModal } from './WhatsNewModal';
import { useWhatsNewStore } from '@/stores/whatsNewStore';

const mocks = vi.hoisted(() => ({
  getVersion: vi.fn<() => Promise<string>>(),
  shellOpen: vi.fn<() => Promise<void>>(),
}));

vi.mock('@tauri-apps/api/app', () => ({ getVersion: mocks.getVersion }));
vi.mock('@tauri-apps/plugin-shell', () => ({ open: mocks.shellOpen }));

const RELEASES_URL = 'https://github.com/mauropereiira/Moldavite/releases';

const ENTRY = {
  version: '1.9.0',
  date: '2026-08-14',
  groups: [
    {
      title: 'Added',
      items: [
        {
          headline: 'Pasted Markdown keeps its formatting.',
          fullText:
            'Pasted Markdown keeps its formatting. Detailed prose that should stay out of the popup.',
        },
        {
          headline: 'Install with Homebrew.',
          fullText: 'Install with Homebrew. A long installation explanation follows here.',
        },
      ],
    },
    {
      title: 'Fixed',
      items: [
        {
          headline: 'The graph no longer traps you.',
          fullText: 'The graph no longer traps you. Several implementation details follow.',
        },
        {
          headline: 'Sidebar browsing no longer leaves hidden tabs piling up.',
          fullText:
            'Sidebar browsing no longer leaves hidden tabs piling up. More supporting prose follows.',
        },
      ],
    },
  ],
};

describe('WhatsNewModal', () => {
  beforeEach(() => {
    localStorage.clear();
    mocks.getVersion.mockReset();
    mocks.getVersion.mockResolvedValue('1.4.0');
    mocks.shellOpen.mockReset();
    mocks.shellOpen.mockResolvedValue();
    useWhatsNewStore.setState({ lastSeenVersion: '1.4.0', isOpen: false, entry: null });
  });

  it('renders nothing when closed', () => {
    const { container } = render(<WhatsNewModal />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders the version and Added headlines without their prose bodies', () => {
    render(<WhatsNewModal />);
    act(() => {
      useWhatsNewStore.getState().open(ENTRY);
    });
    expect(
      screen.getByRole('heading', { name: /what's new in version 1\.9\.0/i })
    ).toHaveTextContent('1.9.0');
    expect(screen.getByText('Released 2026-08-14')).toBeInTheDocument();
    expect(screen.getByText('Pasted Markdown keeps its formatting.')).toBeInTheDocument();
    expect(screen.getByText('Install with Homebrew.')).toBeInTheDocument();
    expect(
      screen.queryByText(/Detailed prose that should stay out of the popup/i)
    ).not.toBeInTheDocument();
  });

  it('keeps fixes collapsed by default and expands their headlines on click', () => {
    render(<WhatsNewModal />);
    act(() => useWhatsNewStore.getState().open(ENTRY));

    const fixes = screen.getByRole('button', { name: '2 fixes' });
    expect(fixes).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('The graph no longer traps you.')).not.toBeInTheDocument();

    fireEvent.click(fixes);
    expect(fixes).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('The graph no longer traps you.')).toBeInTheDocument();
    expect(
      screen.getByText('Sidebar browsing no longer leaves hidden tabs piling up.')
    ).toBeInTheDocument();
    expect(screen.queryByText(/implementation details follow/i)).not.toBeInTheDocument();
  });

  it('opens the full release notes in the system browser', () => {
    render(<WhatsNewModal />);
    act(() => useWhatsNewStore.getState().open(ENTRY));

    fireEvent.click(screen.getByRole('button', { name: 'Full release notes' }));
    expect(mocks.shellOpen).toHaveBeenCalledWith(RELEASES_URL);
  });

  it('closes when the dismiss button is clicked', () => {
    render(<WhatsNewModal />);
    act(() => useWhatsNewStore.getState().open(ENTRY));
    fireEvent.click(screen.getByRole('button', { name: /got it/i }));
    expect(useWhatsNewStore.getState().isOpen).toBe(false);
  });

  it('closes on Escape', () => {
    render(<WhatsNewModal />);
    act(() => useWhatsNewStore.getState().open(ENTRY));
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(useWhatsNewStore.getState().isOpen).toBe(false);
  });

  it('shows once per upgrade and records the current version', async () => {
    useWhatsNewStore.setState({ lastSeenVersion: '1.3.1', isOpen: false, entry: null });
    const first = render(<WhatsNewModal />);

    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    expect(useWhatsNewStore.getState().lastSeenVersion).toBe('1.4.0');

    first.unmount();
    useWhatsNewStore.setState({ isOpen: false, entry: null });
    render(<WhatsNewModal />);
    await waitFor(() => expect(mocks.getVersion).toHaveBeenCalledTimes(2));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('never shows on first launch but initializes the seen version', async () => {
    useWhatsNewStore.setState({ lastSeenVersion: null, isOpen: false, entry: null });
    render(<WhatsNewModal />);

    await waitFor(() => expect(useWhatsNewStore.getState().lastSeenVersion).toBe('1.4.0'));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});

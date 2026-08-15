import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { WordPressMenu } from './WordPressMenu';
import { useWordPressStore } from '@/stores/wordpressStore';
import { useNoteStore } from '@/stores';

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn().mockResolvedValue(() => undefined),
}));

const status = vi.fn();
const sites = vi.fn();
const publish = vi.fn();
const connect = vi.fn();

vi.mock('@/lib/wordpress', async () => {
  const actual = await vi.importActual<typeof import('@/lib/wordpress')>('@/lib/wordpress');
  return {
    ...actual,
    wordpressStatus: () => status(),
    wordpressSites: () => sites(),
    wordpressPublish: (args: unknown) => publish(args),
    wordpressConnect: () => connect(),
    wordpressDisconnect: vi.fn().mockResolvedValue(undefined),
  };
});

describe('WordPressMenu', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useWordPressStore.setState({
      available: false,
      connected: false,
      connecting: false,
      publishing: false,
      sites: [],
      chosenSiteId: null,
      error: null,
      postsByNote: {},
    });
    useNoteStore.setState({
      currentNote: {
        id: 'notes/a.md',
        title: 'A note',
        content: '<p>Body</p>',
      } as never,
    });
  });

  // A build without WordPress.com credentials cannot connect anything. Showing
  // a disabled button there invites a click and then explains itself; showing
  // nothing is honest.
  it('renders nothing when the build has no WordPress.com credentials', async () => {
    status.mockResolvedValue({ available: false, connected: false, error: 'not configured' });
    const { container } = render(<WordPressMenu />);
    await waitFor(() => expect(status).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });

  it('offers to connect when available but signed out', async () => {
    status.mockResolvedValue({ available: true, connected: false, error: null });
    render(<WordPressMenu />);
    await screen.findByRole('button', { name: 'WordPress' });
    await userEvent.click(screen.getByRole('button', { name: 'WordPress' }));
    expect(await screen.findByText('Connect WordPress.com…')).toBeInTheDocument();
    expect(screen.queryByText(/^Publish to/)).not.toBeInTheDocument();
  });

  it('publishes to the chosen site, and lets you change it', async () => {
    status.mockResolvedValue({ available: true, connected: true, error: null });
    sites.mockResolvedValue([
      { id: 1, name: 'Main blog', url: 'https://a.com' },
      { id: 2, name: 'Side blog', url: 'https://b.com' },
    ]);
    publish.mockResolvedValue({ id: 99, url: 'https://a.com/?p=99', updated: false });

    render(<WordPressMenu />);
    await waitFor(() => expect(sites).toHaveBeenCalled());
    // Two sites and none remembered: the user must choose rather than have one
    // picked for them.
    useWordPressStore.getState().chooseSite(1);

    await userEvent.click(screen.getByRole('button', { name: 'WordPress' }));
    await userEvent.click(await screen.findByText('Publish to Main blog'));

    await waitFor(() => expect(publish).toHaveBeenCalled());
    expect(publish.mock.calls[0][0]).toMatchObject({ siteId: 1, title: 'A note' });
  });

  // Re-publishing the same note must update the post the first publish made,
  // or every save scatters another draft across the blog.
  it('sends the remembered post id when the note was published before', async () => {
    status.mockResolvedValue({ available: true, connected: true, error: null });
    sites.mockResolvedValue([{ id: 7, name: 'Only blog', url: 'https://a.com' }]);
    publish.mockResolvedValue({ id: 42, url: null, updated: true });
    useWordPressStore.setState({ postsByNote: { '7:notes/a.md': 42 } });

    render(<WordPressMenu />);
    await waitFor(() => expect(sites).toHaveBeenCalled());

    await userEvent.click(screen.getByRole('button', { name: 'WordPress' }));
    await userEvent.click(await screen.findByText('Publish to Only blog'));

    await waitFor(() => expect(publish).toHaveBeenCalled());
    expect(publish.mock.calls[0][0]).toMatchObject({ existingPostId: 42 });
  });

  // Signing out of one account must not leave its post ids behind to be
  // written over a different account's posts.
  it('forgets the site and post map on disconnect', async () => {
    status.mockResolvedValue({ available: true, connected: true, error: null });
    sites.mockResolvedValue([{ id: 7, name: 'Only blog', url: 'https://a.com' }]);
    useWordPressStore.setState({ postsByNote: { '7:notes/a.md': 42 } });

    render(<WordPressMenu />);
    await waitFor(() => expect(sites).toHaveBeenCalled());
    await useWordPressStore.getState().disconnect();

    const state = useWordPressStore.getState();
    expect(state.connected).toBe(false);
    expect(state.chosenSiteId).toBeNull();
    expect(state.postsByNote).toEqual({});
  });
});

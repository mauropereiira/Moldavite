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
    await userEvent.click(await screen.findByText(/Publish to Main blog/));

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
    await userEvent.click(await screen.findByText(/Publish to Only blog/));

    await waitFor(() => expect(publish).toHaveBeenCalled());
    expect(publish.mock.calls[0][0]).toMatchObject({ existingPostId: 42 });
  });

  // An Automattic account has a couple of hundred sites. Unfiltered, the menu
  // was taller than the screen and the site you wanted was unreachable.
  it('filters a long site list by name or URL, and keeps the menu open while typing', async () => {
    status.mockResolvedValue({ available: true, connected: true, error: null });
    sites.mockResolvedValue([
      { id: 1, name: 'Team Prisma', url: 'https://prisma.example.com' },
      { id: 2, name: 'Team Voltron', url: 'https://voltron.example.com' },
      { id: 3, name: 'Woo Happiness', url: 'https://woo.example.com' },
      { id: 4, name: 'VIP P2', url: 'https://vip.example.com' },
      { id: 5, name: 'Trials', url: 'https://trials.example.com' },
      { id: 6, name: 'Biz test', url: 'https://biztest.wpcomstaging.com' },
    ]);

    render(<WordPressMenu />);
    await waitFor(() => expect(sites).toHaveBeenCalled());
    await userEvent.click(screen.getByRole('button', { name: 'WordPress' }));

    const search = await screen.findByLabelText('Search sites');
    await userEvent.type(search, 'voltron');

    // Typing must not dismiss the menu — the whole point of the filter.
    expect(screen.getByLabelText('Search sites')).toBeInTheDocument();
    expect(screen.getByText(/Team Voltron/)).toBeInTheDocument();
    expect(screen.queryByText(/Team Prisma/)).not.toBeInTheDocument();

    // Sites are found by their host too: the name rarely matches the domain.
    await userEvent.clear(search);
    await userEvent.type(search, 'wpcomstaging');
    expect(screen.getByText(/Biz test/)).toBeInTheDocument();
    expect(screen.queryByText(/Woo Happiness/)).not.toBeInTheDocument();
  });

  // Choosing a site sets up the next step rather than ending the interaction.
  // The menu used to close on selection, hiding the Publish button the choice
  // had just been made for, so you had to reopen it to find the action.
  it('keeps the menu open when you pick a site, leaving Publish in view', async () => {
    status.mockResolvedValue({ available: true, connected: true, error: null });
    sites.mockResolvedValue([
      { id: 1, name: 'Main blog', url: 'https://a.com' },
      { id: 2, name: 'Side blog', url: 'https://b.com' },
    ]);

    render(<WordPressMenu />);
    await waitFor(() => expect(sites).toHaveBeenCalled());
    await userEvent.click(screen.getByRole('button', { name: 'WordPress' }));

    expect(await screen.findByText('Choose a site first')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('menuitem', { name: 'Side blog · b.com' }));

    // Still open — the site list is still there to change your mind with.
    expect(screen.getByRole('menuitem', { name: '✓ Side blog · b.com' })).toBeInTheDocument();

    // And the action the choice was made for is now in view and ready.
    const publish = screen.getByRole('menuitem', { name: 'Publish to Side blog · b.com' });
    expect(publish).not.toBeDisabled();
  });

  it('offers no search box for a handful of sites', async () => {
    status.mockResolvedValue({ available: true, connected: true, error: null });
    sites.mockResolvedValue([
      { id: 1, name: 'Main blog', url: 'https://a.com' },
      { id: 2, name: 'Side blog', url: 'https://b.com' },
    ]);

    render(<WordPressMenu />);
    await waitFor(() => expect(sites).toHaveBeenCalled());
    await userEvent.click(screen.getByRole('button', { name: 'WordPress' }));

    expect(await screen.findByText(/Main blog/)).toBeInTheDocument();
    expect(screen.queryByLabelText('Search sites')).not.toBeInTheDocument();
  });

  // The map is keyed by note path, which is mutable. Renaming a published note
  // used to strand its mapping — and a NEW note later taking the freed path
  // inherited it, so publishing that new note would update the old note's post.
  // `publish` preserves a live post's status, so that could rewrite something
  // already public.
  it('moves a published note’s post mapping when the note is renamed', () => {
    useWordPressStore.setState({
      postsByNote: { '7:notes/old.md': 42, '7:notes/other.md': 99, '9:notes/old.md': 7 },
    });

    useWordPressStore.getState().notePathChanged('notes/old.md', 'notes/new.md');

    const { postsByNote } = useWordPressStore.getState();
    // Follows the note, on every site it was published to.
    expect(postsByNote['7:notes/new.md']).toBe(42);
    expect(postsByNote['9:notes/new.md']).toBe(7);
    // And leaves nothing behind for a new note at the old path to inherit.
    expect(postsByNote['7:notes/old.md']).toBeUndefined();
    expect(postsByNote['9:notes/old.md']).toBeUndefined();
    // Unrelated notes are untouched.
    expect(postsByNote['7:notes/other.md']).toBe(99);
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

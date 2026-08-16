import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PinnedBar } from './PinnedBar';
import { useNoteStore, useQuickSwitcherStore } from '@/stores';

const loadNote = vi.fn();
vi.mock('@/hooks', () => ({ useNotes: () => ({ loadNote }) }));

const file = (path: string, name = path.slice(path.lastIndexOf('/') + 1)) => ({
  name,
  path,
  isDaily: false,
  isWeekly: false,
  isLocked: false,
});

describe('PinnedBar', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useQuickSwitcherStore.setState({ pinnedNoteIds: [] });
    useNoteStore.setState({
      notes: [file('notes/roadmap.md'), file('notes/ideas.md')] as never,
      currentNote: null,
    });
  });

  // An empty bar would cost a row of vertical space in an app whose argument is
  // that the note is the only thing on screen that earned its place.
  it('renders nothing at all when no note is pinned', () => {
    const { container } = render(<PinnedBar />);
    expect(container).toBeEmptyDOMElement();
  });

  it('appears once a note is pinned, and opens it on click', async () => {
    useQuickSwitcherStore.setState({ pinnedNoteIds: ['notes/roadmap.md'] });
    render(<PinnedBar />);

    const open = screen.getByRole('button', { name: 'roadmap' });
    await userEvent.click(open);

    // Goes through the normal load path, which reuses an already-open tab
    // rather than opening the same note twice.
    expect(loadNote).toHaveBeenCalledWith(expect.objectContaining({ path: 'notes/roadmap.md' }));
  });

  it('unpins from the bar, which then disappears with the last pin', async () => {
    useQuickSwitcherStore.setState({ pinnedNoteIds: ['notes/roadmap.md'] });
    const { container } = render(<PinnedBar />);

    await userEvent.click(screen.getByRole('button', { name: 'Unpin roadmap' }));

    expect(useQuickSwitcherStore.getState().pinnedNoteIds).toEqual([]);
    expect(container).toBeEmptyDOMElement();
  });

  // A pin outlives its note when the file is deleted outside the app or the
  // user switches Forge. Rendering a row that cannot open is worse than
  // dropping it silently.
  it('skips a pin whose note no longer exists', () => {
    useQuickSwitcherStore.setState({ pinnedNoteIds: ['notes/deleted.md', 'notes/ideas.md'] });
    render(<PinnedBar />);

    expect(screen.queryByRole('button', { name: 'deleted' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'ideas' })).toBeInTheDocument();
  });

  it('marks the pinned note you are currently reading', () => {
    useQuickSwitcherStore.setState({ pinnedNoteIds: ['notes/roadmap.md', 'notes/ideas.md'] });
    useNoteStore.setState({ currentNote: { id: 'notes/ideas.md' } as never });
    render(<PinnedBar />);

    expect(screen.getByRole('button', { name: 'ideas' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('button', { name: 'roadmap' })).not.toHaveAttribute('aria-current');
  });
});

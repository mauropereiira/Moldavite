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

  // Twelve pins wrapped onto three lines and pushed the whole app down, which
  // is the opposite of the speed the bar exists for. Browser-tab behaviour:
  // a few stay put, the rest collapse into a menu.
  it('keeps four pins on the bar and puts the rest behind a count', async () => {
    const paths = ['a', 'b', 'c', 'd', 'e', 'f'].map((n) => `notes/${n}.md`);
    useNoteStore.setState({ notes: paths.map((p) => file(p)) as never, currentNote: null });
    useQuickSwitcherStore.setState({ pinnedNoteIds: paths });

    render(<PinnedBar />);

    expect(screen.getByRole('button', { name: 'a' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'd' })).toBeInTheDocument();
    // Beyond the fourth, they are not on the bar.
    expect(screen.queryByRole('button', { name: 'e' })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: '2 more pinned notes' }));
    expect(await screen.findByRole('menuitem', { name: 'e' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'f' })).toBeInTheDocument();
  });

  // The order is the user's, and a drag-only control would be unusable without
  // a mouse — this is the keyboard path to the same reordering.
  it('moves a pin with alt+arrow so reordering is not mouse-only', async () => {
    const paths = ['a', 'b', 'c'].map((n) => `notes/${n}.md`);
    useNoteStore.setState({ notes: paths.map((p) => file(p)) as never, currentNote: null });
    useQuickSwitcherStore.setState({ pinnedNoteIds: paths });

    render(<PinnedBar />);
    screen.getByRole('button', { name: 'c' }).focus();
    await userEvent.keyboard('{Alt>}{ArrowLeft}{/Alt}');

    expect(useQuickSwitcherStore.getState().pinnedNoteIds).toEqual([
      'notes/a.md',
      'notes/c.md',
      'notes/b.md',
    ]);
  });

  it('refuses to move a pin off either end', async () => {
    const paths = ['a', 'b'].map((n) => `notes/${n}.md`);
    useNoteStore.setState({ notes: paths.map((p) => file(p)) as never, currentNote: null });
    useQuickSwitcherStore.setState({ pinnedNoteIds: paths });

    render(<PinnedBar />);
    screen.getByRole('button', { name: 'a' }).focus();
    await userEvent.keyboard('{Alt>}{ArrowLeft}{/Alt}');

    expect(useQuickSwitcherStore.getState().pinnedNoteIds).toEqual(['notes/a.md', 'notes/b.md']);
  });
});

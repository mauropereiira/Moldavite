import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { NoteFile, TrashedNote } from '@/types';
import type { NoteActivityEntry } from '@/lib/noteActivity';
import { useNoteStore, useOverlayStore, useTimelineStore } from '@/stores';
import { DAY_PAGE, TimelineView } from './TimelineView';
import { actionLabel, dayHeading, folderLabel, noteTitle, recentDays } from './activity';

const api = vi.hoisted(() => ({
  log: [] as NoteActivityEntry[],
  listNoteActivity: vi.fn(),
  countNoteActivity: vi.fn(),
  listTrash: vi.fn(),
  loadNote: vi.fn(),
  mobile: false,
}));

vi.mock('@/lib/noteActivity', () => ({
  listNoteActivity: api.listNoteActivity,
  countNoteActivity: api.countNoteActivity,
}));
vi.mock('@/lib/fileSystem', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/fileSystem')>()),
  listTrash: api.listTrash,
}));
vi.mock('@/hooks', () => ({ useNotes: () => ({ loadNote: api.loadNote }) }));
vi.mock('@/lib/platform', () => ({ isMobilePlatform: () => api.mobile }));

/** The backend's two queries over an in-memory log, newest first. */
function fakeBackend() {
  const sorted = () => [...api.log].sort((a, b) => b.atMs - a.atMs || b.id - a.id);
  api.listNoteActivity.mockImplementation(
    async (before: { atMs: number; id: number }, sinceMs: number, limit: number) => {
      const rows = sorted().filter(
        (row) =>
          (row.atMs < before.atMs || (row.atMs === before.atMs && row.id < before.id)) &&
          row.atMs >= sinceMs
      );
      return { entries: rows.slice(0, limit), hasMore: rows.length > limit, recordingSinceMs: 1 };
    }
  );
  api.countNoteActivity.mockImplementation(async (bounds: number[]) => ({
    counts: bounds
      .slice(1)
      .map(
        (end, index) => api.log.filter((row) => row.atMs >= bounds[index] && row.atMs < end).length
      ),
    hasEarlier: api.log.some((row) => row.atMs < bounds[0]),
    recordingSinceMs: 1,
  }));
}

const NOW = new Date(2026, 9, 6, 15, 0);
const at = (day: number, hour: number, minute = 0) =>
  new Date(2026, 9, day, hour, minute).getTime();

let nextId = 1;
function entry(overrides: Partial<NoteActivityEntry>): NoteActivityEntry {
  const atMs = overrides.atMs ?? at(6, 9);
  const path = overrides.path ?? 'notes/Plan.md';
  return {
    id: nextId++,
    firstMs: atMs,
    atMs,
    action: 'edited',
    path,
    oldPath: null,
    notePath: path,
    source: 'app',
    ...overrides,
  };
}

function note(path: string, extra: Partial<NoteFile> = {}): NoteFile {
  return {
    name: path.slice(path.lastIndexOf('/') + 1),
    path,
    isDaily: path.startsWith('daily/'),
    isWeekly: path.startsWith('weekly/'),
    isLocked: false,
    ...extra,
  };
}

const TRASHED_DRAFT: TrashedNote = {
  id: 't1',
  filename: 'Draft.md',
  originalPath: 'Draft.md',
  isDaily: false,
  isWeekly: false,
  isFolder: false,
  containedFiles: [],
  trashedAt: 0,
  daysRemaining: 6,
};

describe('Timeline helpers', () => {
  it('lists a week of local days, today first, with Today and Yesterday named', () => {
    const days = recentDays(1, NOW);
    expect(days).toHaveLength(7);
    expect(days[0].key).toBe('2026-10-06');
    expect(days[6].key).toBe('2026-09-30');
    expect(days[0].end).toBe(new Date(2026, 9, 7).getTime());
    expect(dayHeading(days[0], NOW)).toEqual({ name: 'Today', date: 'Tuesday 6 Oct' });
    expect(dayHeading(days[1], NOW)).toEqual({ name: 'Yesterday', date: 'Monday 5 Oct' });
    expect(dayHeading(days[2], NOW)).toEqual({ name: 'Sunday 4 Oct', date: '' });
    expect(recentDays(2, NOW)[13].key).toBe('2026-09-23');
  });

  it('names notes and folders from their paths alone', () => {
    expect(noteTitle('daily/2026-10-06.md')).toBe('October 6, 2026');
    expect(noteTitle('weekly/2026-W41.md')).toBe('Week 41, 2026');
    expect(noteTitle('notes/Projects/Q4 roadmap.md')).toBe('Q4 roadmap');
    expect(folderLabel('daily/2026-10-06.md')).toBe('Daily');
    expect(folderLabel('notes/Q4 roadmap.md')).toBe('Notes');
    expect(folderLabel('notes/Projects/Moldavite/a.md')).toBe('Projects/Moldavite');
  });

  it('describes each action, with old to new for renames and moves', () => {
    expect(actionLabel(entry({ action: 'created' }))).toBe('Created');
    expect(actionLabel(entry({ action: 'created', firstMs: at(6, 9), atMs: at(6, 9, 20) }))).toBe(
      'Created, then edited'
    );
    expect(actionLabel(entry({ action: 'edited', source: 'agent' }))).toBe('Edited by an agent');
    expect(
      actionLabel(entry({ action: 'renamed', path: 'notes/New.md', oldPath: 'notes/Old.md' }))
    ).toBe('Renamed from Old');
    expect(
      actionLabel(
        entry({ action: 'moved', path: 'notes/Archive/a.md', oldPath: 'notes/Projects/a.md' })
      )
    ).toBe('Moved from Projects');
    expect(actionLabel(entry({ action: 'trashed' }))).toBe('Moved to Trash');
  });
});

describe('TimelineView', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
    api.mobile = false;
    api.log = [];
    fakeBackend();
    api.listTrash.mockReset().mockResolvedValue([]);
    api.loadNote.mockReset();
    useNoteStore.setState({ notes: [] });
    useTimelineStore.getState().open();
  });

  afterEach(() => {
    vi.useRealTimers();
    useOverlayStore.getState().closeOverlay();
  });

  it('opens today and yesterday, and keeps older days closed to their count', async () => {
    useNoteStore.setState({ notes: [note('notes/Projects/Plan.md')] });
    api.log = [
      entry({ path: 'notes/Projects/Plan.md', atMs: at(6, 14, 5) }),
      entry({
        action: 'moved',
        path: 'notes/Archive/Old.md',
        oldPath: 'notes/Projects/Old.md',
        atMs: at(5, 11),
      }),
      entry({ path: 'notes/A.md', atMs: at(3, 9) }),
      entry({ path: 'notes/B.md', atMs: at(3, 10) }),
    ];
    render(<TimelineView />);

    const today = await screen.findByRole('button', { name: /Today/ });
    expect(today).toHaveAttribute('aria-expanded', 'true');
    expect(today).toHaveTextContent('Tuesday 6 Oct · 1 change');
    const row = await screen.findByRole('button', { name: /Plan/ });
    expect(row).toHaveTextContent('Projects · Edited');
    expect(row).toHaveTextContent('14:05');
    expect(await screen.findByText('Archive · Moved from Projects')).toBeInTheDocument();

    const saturday = screen.getByRole('button', { name: /Saturday 3 Oct/ });
    expect(saturday).toHaveAttribute('aria-expanded', 'false');
    expect(saturday).toHaveTextContent('2 changes');
    expect(screen.queryByText('A')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Friday/ })).not.toBeInTheDocument();

    fireEvent.click(saturday);
    expect(await screen.findByText('A')).toBeInTheDocument();
    expect(saturday).toHaveAttribute('aria-expanded', 'true');
    expect(
      within(screen.getByRole('region', { name: 'Saturday 3 Oct' })).getByRole('heading')
    ).toHaveClass('sticky');
  });

  it('shows ten rows of a day and loads more on request', async () => {
    api.log = Array.from({ length: 25 }, (_, index) =>
      entry({ path: `notes/n${index}.md`, atMs: at(6, 14) - index * 60_000 })
    );
    render(<TimelineView />);

    await screen.findByText('n0');
    expect(screen.getAllByRole('listitem')).toHaveLength(DAY_PAGE);
    fireEvent.click(screen.getByRole('button', { name: 'Show 15 more' }));
    await waitFor(() => expect(screen.getAllByRole('listitem')).toHaveLength(25));
    expect(screen.queryByRole('button', { name: /more/ })).not.toBeInTheDocument();
    expect(api.listNoteActivity).toHaveBeenLastCalledWith(
      expect.objectContaining({ atMs: at(6, 14) - 9 * 60_000 }),
      new Date(2026, 9, 6).getTime(),
      20
    );
  });

  it('loads the week before on request, and says when a week was quiet', async () => {
    api.log = [
      entry({ path: 'notes/Now.md', atMs: at(6, 9) }),
      entry({ path: 'notes/Then.md', atMs: new Date(2026, 8, 10, 9).getTime() }),
    ];
    render(<TimelineView />);

    fireEvent.click(await screen.findByRole('button', { name: 'Previous week' }));
    expect(await screen.findByText('No changes from 23 Sep to 29 Sep.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Previous week' }));
    fireEvent.click(screen.getByRole('button', { name: 'Previous week' }));
    expect(await screen.findByRole('button', { name: /Thursday 10 Sep/ })).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Previous week' })).not.toBeInTheDocument()
    );
  });

  it('opens a note at its current place and closes the Timeline', async () => {
    const renamed = note('notes/Archive/New.md');
    useNoteStore.setState({ notes: [renamed] });
    api.log = [entry({ path: 'notes/Old.md', notePath: 'notes/Archive/New.md' })];
    render(<TimelineView />);

    fireEvent.click(await screen.findByRole('button', { name: /Old/ }));
    expect(api.loadNote).toHaveBeenCalledWith(renamed);
    expect(useTimelineStore.getState().isOpen).toBe(false);
  });

  it('shows a locked note by name only and hands it to the unlock path', async () => {
    const vault = note('notes/Vault.md', { isLocked: true });
    useNoteStore.setState({ notes: [vault] });
    api.log = [entry({ action: 'locked', path: 'notes/Vault.md' })];
    render(<TimelineView />);

    const row = await screen.findByRole('button', { name: /Vault/ });
    expect(row).toHaveTextContent('Locked');
    fireEvent.click(row);
    expect(api.loadNote).toHaveBeenCalledWith(vault);
  });

  it('shows a trashed note as in the Trash and a gone one as gone, without a button', async () => {
    api.listTrash.mockResolvedValue([TRASHED_DRAFT]);
    api.log = [
      entry({ action: 'trashed', path: 'notes/Draft.md' }),
      entry({ action: 'deleted', path: 'notes/Gone.md', source: 'outside' }),
    ];
    render(<TimelineView />);

    expect(await screen.findByText('In Trash')).toBeInTheDocument();
    expect(screen.getByText('No longer here')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Draft|Gone/ })).not.toBeInTheDocument();
  });

  it('opens the Trash page from a trashed row on the phone', async () => {
    api.mobile = true;
    api.listTrash.mockResolvedValue([TRASHED_DRAFT]);
    api.log = [entry({ action: 'trashed', path: 'notes/Draft.md' })];
    render(<TimelineView />);

    await screen.findByText('In Trash');
    fireEvent.click(screen.getByRole('button', { name: /Draft/ }));
    expect(useOverlayStore.getState().activeOverlay).toBe('trash');
  });

  it('marks rows read from file dates', async () => {
    api.log = [entry({ action: 'created', path: 'daily/2026-10-06.md', source: 'files' })];
    render(<TimelineView />);
    expect(await screen.findByText(/Daily · Created · file date/)).toBeInTheDocument();
  });

  it('says so when nothing has happened yet', async () => {
    render(<TimelineView />);
    expect(await screen.findByText('Nothing has happened to your notes yet.')).toBeInTheDocument();
  });

  it('explains where the record lives', async () => {
    render(<TimelineView />);
    fireEvent.click(screen.getByRole('button', { name: 'About the Timeline' }));
    const info = screen.getByText(/keeps the record in its own app data/);
    expect(info).toHaveTextContent('none of it is uploaded');
    expect(info).toHaveTextContent('never what a note says');
  });
});

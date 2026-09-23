import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useNoteStore } from '@/stores/noteStore';
import { useQuickSwitcherStore } from '@/stores/quickSwitcherStore';
import { isMobilePlatform } from '@/lib/platform';
import { QuickSwitcher } from './QuickSwitcher';

vi.mock('@/lib/platform', () => ({ isMobilePlatform: vi.fn(() => false) }));

const search = vi.hoisted(() => ({
  invoke: vi.fn(async (_command: string, _args: unknown) => [] as unknown[]),
}));

vi.mock('@/lib/ipc', () => ({ safeInvoke: search.invoke }));

const notesHarness = vi.hoisted(() => ({
  loadNote: vi.fn().mockResolvedValue(undefined),
  note: {
    name: 'Keyboard.md',
    path: 'notes/Keyboard.md',
    isDaily: false,
    isWeekly: false,
    isLocked: false,
  },
  groceries: {
    name: 'Groceries.md',
    path: 'notes/Groceries.md',
    isDaily: false,
    isWeekly: false,
    isLocked: false,
  },
}));

vi.mock('@/hooks/useNotes', () => ({
  useNotes: () => ({
    notes: [notesHarness.note, notesHarness.groceries],
    loadNote: notesHarness.loadNote,
    loadDailyNote: vi.fn().mockResolvedValue(undefined),
    createNote: vi.fn().mockResolvedValue(undefined),
  }),
}));

describe('QuickSwitcher nested actions', () => {
  beforeEach(() => {
    notesHarness.loadNote.mockClear();
    useNoteStore.setState({ recentNoteIds: [notesHarness.note.path] });
    useQuickSwitcherStore.setState({
      isOpen: true,
      recentSearches: [],
      pinnedNoteIds: [],
    });
  });

  it('pins with Enter without opening the selected note', () => {
    render(<QuickSwitcher />);
    expect(screen.getByRole('dialog', { name: 'Quick switcher' })).toHaveAttribute(
      'aria-modal',
      'true'
    );
    const pin = screen.getAllByRole('button', { name: 'Pin note' })[0];
    expect(pin.parentElement?.tagName).not.toBe('BUTTON');

    // This is the browser's keyboard-button activation sequence. The keydown
    // bubbles before the button's synthesized click.
    fireEvent.keyDown(pin, { key: 'Enter' });
    fireEvent.click(pin);

    expect(notesHarness.loadNote).not.toHaveBeenCalled();
    expect(useQuickSwitcherStore.getState().pinnedNoteIds).toEqual([notesHarness.note.path]);
    expect(useQuickSwitcherStore.getState().isOpen).toBe(true);
  });
});

describe('QuickSwitcher close control', () => {
  beforeEach(() => {
    useQuickSwitcherStore.setState({ recentSearches: [], pinnedNoteIds: [] });
    // Through the surface coordinator, so that `close` has something to close.
    useQuickSwitcherStore.getState().open();
  });

  afterEach(() => {
    vi.mocked(isMobilePlatform).mockReturnValue(false);
  });

  it('has no close button on desktop, where Escape and the rail close it', () => {
    render(<QuickSwitcher />);

    expect(screen.queryByRole('button', { name: 'Close search' })).not.toBeInTheDocument();
  });

  it('shows a close button beside the input on a phone that closes the search', () => {
    vi.mocked(isMobilePlatform).mockReturnValue(true);
    render(<QuickSwitcher />);

    const close = screen.getByRole('button', { name: 'Close search' });
    expect(close.parentElement).toBe(screen.getByRole('textbox').parentElement);
    expect(close.style.width).toBe('var(--touch-target)');
    expect(close.style.height).toBe('var(--touch-target)');

    fireEvent.click(close);
    expect(useQuickSwitcherStore.getState().isOpen).toBe(false);
  });
});

describe('QuickSwitcher text search', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    notesHarness.loadNote.mockClear();
    search.invoke.mockReset();
    search.invoke.mockResolvedValue([
      {
        filename: 'Groceries.md',
        path: 'notes/Groceries.md',
        snippet: 'milk and eggs',
        lineNumber: 1,
        matchCount: 1,
        isDaily: false,
        isWeekly: false,
        folderPath: null,
      },
    ]);
    useQuickSwitcherStore.setState({ recentSearches: [], pinnedNoteIds: [] });
    useQuickSwitcherStore.getState().open();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.mocked(isMobilePlatform).mockReturnValue(false);
  });

  async function typeQuery(query: string) {
    fireEvent.change(screen.getByRole('textbox'), { target: { value: query } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });
  }

  it('finds notes by the words in them, below the title matches', async () => {
    render(<QuickSwitcher />);
    await typeQuery('eggs');

    expect(search.invoke).toHaveBeenCalledWith('search_notes_content', {
      query: 'eggs',
      maxResults: 30,
    });
    expect(screen.getByText('In note text')).toBeInTheDocument();
    const mark = screen.getByText('eggs', { selector: 'mark' });
    expect(mark.closest('.search-preview')).not.toBeNull();

    const row = Array.from(document.querySelectorAll('.quick-switcher-item-title')).find(
      (title) => title.textContent === 'Groceries'
    );
    fireEvent.click(row?.closest('button') as HTMLButtonElement);
    expect(notesHarness.loadNote).toHaveBeenCalledWith(notesHarness.groceries);
  });

  it('keeps a title match first and does not list it twice', async () => {
    search.invoke.mockResolvedValue([
      {
        filename: 'Keyboard.md',
        path: 'notes/Keyboard.md',
        snippet: 'keyboard shortcuts',
        lineNumber: 1,
        matchCount: 1,
        isDaily: false,
        isWeekly: false,
        folderPath: null,
      },
    ]);
    render(<QuickSwitcher />);
    await typeQuery('keyb');

    expect(screen.queryByText('In note text')).not.toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Pin note' })).toHaveLength(1);
  });

  it('on a phone, offers only what works there, without shortcut glyphs', () => {
    vi.mocked(isMobilePlatform).mockReturnValue(true);
    const { container } = render(<QuickSwitcher />);

    expect(screen.getByRole('textbox')).toHaveAttribute('placeholder', 'Search notes');
    const titles = Array.from(container.querySelectorAll('.quick-switcher-item-title')).map(
      (title) => title.textContent
    );
    expect(titles).toContain("Open Today's Note");
    for (const title of [
      'Toggle Timeline',
      'Toggle Theme',
      'Show Keyboard Shortcuts',
      'Switch Forge…',
      'New Note from Template…',
    ]) {
      expect(titles).not.toContain(title);
    }
    expect(container.querySelector('.quick-switcher-section-header svg')).toBeNull();
  });
});

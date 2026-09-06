import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useNoteStore } from '@/stores/noteStore';
import { useQuickSwitcherStore } from '@/stores/quickSwitcherStore';
import { isMobilePlatform } from '@/lib/platform';
import { QuickSwitcher } from './QuickSwitcher';

vi.mock('@/lib/platform', () => ({ isMobilePlatform: vi.fn(() => false) }));

const notesHarness = vi.hoisted(() => ({
  loadNote: vi.fn().mockResolvedValue(undefined),
  note: {
    name: 'Keyboard.md',
    path: 'notes/Keyboard.md',
    isDaily: false,
    isWeekly: false,
    isLocked: false,
  },
}));

vi.mock('@/hooks/useNotes', () => ({
  useNotes: () => ({
    notes: [notesHarness.note],
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
    const pin = screen.getByRole('button', { name: 'Pin note' });
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

import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useNoteStore } from '@/stores/noteStore';
import { useQuickSwitcherStore } from '@/stores/quickSwitcherStore';
import { QuickSwitcher } from './QuickSwitcher';

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

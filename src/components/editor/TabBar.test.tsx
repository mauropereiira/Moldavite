import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Note } from '@/types';
import { useNoteStore } from '@/stores';
import { TabBar } from './TabBar';

vi.mock('@/hooks/useToast', () => ({
  useToast: () => ({ error: vi.fn() }),
}));

const note = (id: string, isPinned = false): Note => ({
  id,
  title: id,
  content: `<p>${id}</p>`,
  createdAt: new Date(0),
  updatedAt: new Date(0),
  isDaily: false,
  isWeekly: false,
  isPinned,
});

describe('TabBar', () => {
  beforeEach(() => {
    localStorage.clear();
    const pinned = note('Pinned', true);
    const preview = note('Preview');
    useNoteStore.setState({
      openTabs: [pinned, preview],
      activeTabId: preview.id,
      currentNote: preview,
      externallyChanged: new Set(),
    });
  });

  it('lets every tab close, including pinned tabs', () => {
    render(<TabBar />);

    fireEvent.click(screen.getByRole('button', { name: 'Close Pinned' }));

    expect(useNoteStore.getState().openTabs.map((tab) => tab.id)).toEqual(['Preview']);
  });

  it('closes all tabs or all tabs other than the active one', () => {
    const view = render(<TabBar />);

    fireEvent.click(screen.getByRole('button', { name: 'Close others' }));
    expect(useNoteStore.getState().openTabs.map((tab) => tab.id)).toEqual(['Preview']);

    const another = note('Another');
    useNoteStore.setState({
      openTabs: [useNoteStore.getState().openTabs[0], another],
      activeTabId: another.id,
      currentNote: another,
    });
    view.rerender(<TabBar />);
    fireEvent.click(screen.getByRole('button', { name: 'Close all' }));

    expect(useNoteStore.getState()).toMatchObject({
      openTabs: [],
      activeTabId: null,
      currentNote: null,
    });
  });
});

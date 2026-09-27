import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Backlink } from '@/hooks/useBacklinks';
import type { NoteFile } from '@/types';

const loadNote = vi.fn();
let backlinks: Backlink[] = [];

vi.mock('@/hooks', () => ({ useNotes: () => ({ loadNote }) }));
vi.mock('@/hooks/useBacklinks', () => ({
  useBacklinks: () => ({ backlinks, loading: false, error: null }),
}));
vi.mock('@/hooks/useRelatedNotes', () => ({
  useRelatedNotes: () => ({ related: [], loading: false }),
}));

import { useNoteStore } from '@/stores';
import { BacklinksPanel } from './BacklinksPanel';

function noteFile(path: string, folderPath: string): NoteFile {
  return {
    name: 'plan.md',
    path,
    isDaily: false,
    isWeekly: false,
    isLocked: false,
    folderPath,
  };
}

beforeEach(() => {
  loadNote.mockReset();
  useNoteStore.setState({
    currentNote: {
      id: 'notes/target.md',
      title: 'target',
      content: '',
      createdAt: new Date(),
      updatedAt: new Date(),
      isDaily: false,
      isWeekly: false,
    },
    notes: [noteFile('notes/A/plan.md', 'A'), noteFile('notes/B/plan.md', 'B')],
  });
});

describe('BacklinksPanel', () => {
  it('opens the exact source note when two notes share its filename', () => {
    backlinks = [
      { fromPath: 'notes/A/plan.md', fromNote: 'plan.md', fromTitle: 'Plan A', context: 'a' },
      { fromPath: 'notes/B/plan.md', fromNote: 'plan.md', fromTitle: 'Plan B', context: 'b' },
    ];
    render(<BacklinksPanel />);
    fireEvent.click(screen.getByRole('button', { name: /Linked mentions/ }));

    const rows = screen.getAllByRole('button', { name: /plan/ });
    expect(rows).toHaveLength(2);
    fireEvent.click(rows[1]);

    expect(loadNote).toHaveBeenCalledTimes(1);
    expect(loadNote.mock.calls[0][0].path).toBe('notes/B/plan.md');
  });

  it('shows a snippet as readable text, not raw Markdown and HTML', () => {
    backlinks = [
      {
        fromPath: 'notes/A/plan.md',
        fromNote: 'plan.md',
        fromTitle: 'Plan A',
        context: 'Photo <img src="images/p.png"> and \\[\\[literal\\]\\] see [[Target|target]]',
      },
    ];
    render(<BacklinksPanel />);
    fireEvent.click(screen.getByRole('button', { name: /Linked mentions/ }));

    expect(screen.getByRole('button', { name: /plan/ })).toHaveTextContent(
      'planPhoto and [[literal]] see Target'
    );
  });
});

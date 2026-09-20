import { render, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getLastPersistedMarkdown } from '@/lib/fileSystem';
import { useNoteStore } from '@/stores/noteStore';
import type { NoteFile } from '@/types';

const invokeMock = vi.fn();

vi.mock('@/lib/ipc', () => ({
  safeInvoke: (...args: unknown[]) => invokeMock(...args),
}));

import { BacklinksSection } from './BacklinksSection';

const notes: NoteFile[] = [
  { name: 'alpha.md', path: 'notes/alpha.md', isDaily: false, isWeekly: false, isLocked: false },
  {
    name: '2026-W12.md',
    path: 'weekly/2026-W12.md',
    isDaily: false,
    isWeekly: true,
    isLocked: false,
  },
];

beforeEach(() => {
  invokeMock.mockReset();
  invokeMock.mockImplementation(async (command: string, args?: Record<string, unknown>) => {
    if (command === 'read_note') {
      const filename = args?.filename as string;
      return {
        content: `disk body of ${filename}`,
        color: null,
        contentHash: `hash-${filename}`,
      };
    }
    return undefined;
  });
  useNoteStore.setState({
    currentNote: {
      id: 'notes/target.md',
      title: 'Target',
      content: '<p></p>',
      isDaily: false,
      isWeekly: false,
    } as never,
  });
});

function renderSection() {
  return render(
    <BacklinksSection
      notes={notes}
      isCollapsed={false}
      onToggle={() => {}}
      onNoteClick={() => {}}
    />
  );
}

describe('BacklinksSection note scanning', () => {
  it('does not adopt a save baseline for the notes it scans', async () => {
    renderSection();

    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith(
        'read_note',
        expect.objectContaining({ filename: 'alpha.md' })
      )
    );

    // A read-only scan must not move the conflict baseline: doing so lets a
    // later save overwrite an external edit without a conflict copy.
    expect(getLastPersistedMarkdown('alpha.md', false)).toBeUndefined();
  });

  it('addresses weekly notes as weekly so they can contribute backlinks', async () => {
    renderSection();

    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith(
        'read_note',
        expect.objectContaining({ filename: '2026-W12.md', isWeekly: true })
      )
    );
  });
});

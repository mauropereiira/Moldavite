import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getLastPersistedMarkdown } from '@/lib/fileSystem';
import { useSettingsStore, useTagStore } from '@/stores';
import type { NoteFile } from '@/types';

const invokeMock = vi.fn();

vi.mock('@/lib/ipc', () => ({
  safeInvoke: (...args: unknown[]) => invokeMock(...args),
}));

import { useSidebarTags } from './useSidebarTags';

const notes: NoteFile[] = [
  { name: 'tagged.md', path: 'notes/tagged.md', isDaily: false, isWeekly: false, isLocked: false },
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
      return { content: `#tag-${filename}`, color: null, contentHash: `hash-${filename}` };
    }
    return undefined;
  });
  useSettingsStore.setState({ tagsEnabled: true });
  useTagStore.setState({ allTags: new Map(), selectedTag: null, selectedTags: [] });
});

describe('useSidebarTags note scanning', () => {
  it('does not adopt a save baseline for the notes it scans', async () => {
    renderHook(() => useSidebarTags(notes));

    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith(
        'read_note',
        expect.objectContaining({ filename: 'tagged.md' })
      )
    );

    expect(getLastPersistedMarkdown('tagged.md', false)).toBeUndefined();
  });

  it('addresses weekly notes as weekly so their tags are counted', async () => {
    renderHook(() => useSidebarTags(notes));

    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith(
        'read_note',
        expect.objectContaining({ filename: '2026-W12.md', isWeekly: true })
      )
    );
  });

  it('never reads a note still in iCloud and does not log one that turns out to be', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    invokeMock.mockImplementation(async (command: string, args?: Record<string, unknown>) => {
      if (command !== 'read_note') return undefined;
      if (args?.filename === 'late.md') {
        throw new Error("This note is in iCloud and hasn't downloaded to this device yet.");
      }
      return { content: '#local', color: null, contentHash: 'hash' };
    });
    const cloudNotes: NoteFile[] = [
      { ...notes[0], name: 'remote.md', path: 'notes/remote.md', notDownloaded: true },
      { ...notes[0], name: 'late.md', path: 'notes/late.md' },
      notes[0],
    ];

    renderHook(() => useSidebarTags(cloudNotes));

    await waitFor(() => expect(useTagStore.getState().allTags.has('local')).toBe(true));
    expect(invokeMock).not.toHaveBeenCalledWith(
      'read_note',
      expect.objectContaining({ filename: 'remote.md' })
    );
    expect(errorSpy).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });
});

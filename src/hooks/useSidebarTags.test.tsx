import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getLastPersistedMarkdown } from '@/lib/fileSystem';
import { markNoteTagsStale, useNoteStore, useSettingsStore, useTagStore } from '@/stores';
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

describe('useSidebarTags cache', () => {
  it('re-reads a note whose modification time changed', async () => {
    let body = '#before';
    invokeMock.mockImplementation(async (command: string) =>
      command === 'read_note' ? { content: body, color: null, contentHash: body } : undefined
    );
    const note: NoteFile = { ...notes[0], modifiedAt: 100 };
    const { rerender } = renderHook(({ list }) => useSidebarTags(list), {
      initialProps: { list: [note] },
    });
    await waitFor(() => expect(useTagStore.getState().allTags.has('before')).toBe(true));

    body = '#after';
    rerender({ list: [{ ...note, modifiedAt: 101 }] });

    await waitFor(() => expect(useTagStore.getState().allTags.has('after')).toBe(true));
    expect(useTagStore.getState().allTags.has('before')).toBe(false);
  });
});

describe('useSidebarTags selected tag', () => {
  it('keeps a tag selected before the first scan when the scan finds it', async () => {
    useTagStore.getState().setSelectedTag('tag-tagged');
    renderHook(() => useSidebarTags(notes));

    await waitFor(() => expect(useTagStore.getState().allTags.size).toBeGreaterThan(0));
    expect(useTagStore.getState().allTags.has('tag-tagged')).toBe(true);
    expect(useTagStore.getState().selectedTag).toBe('tag-tagged');
  });

  it('clears a selected tag the scan no longer finds', async () => {
    useTagStore.getState().setSelectedTag('gone');
    renderHook(() => useSidebarTags(notes));

    await waitFor(() => expect(useTagStore.getState().allTags.size).toBeGreaterThan(0));
    await waitFor(() => expect(useTagStore.getState().selectedTag).toBeNull());
  });
});

describe('useSidebarTags after saves and outside edits', () => {
  let body = '';
  const note: NoteFile = { ...notes[0], modifiedAt: 100 };

  beforeEach(() => {
    body = '#v0';
    invokeMock.mockImplementation(async (command: string) =>
      command === 'read_note' ? { content: body, color: null, contentHash: body } : undefined
    );
    useNoteStore.setState({ notes: [note], openTabs: [], savedContent: new Map() });
    vi.spyOn(Date, 'now').mockReturnValue(200_000);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const tagsSettleOn = (tag: string) =>
    waitFor(() => expect([...useTagStore.getState().allTags.keys()]).toEqual([tag]));

  it('counts the latest tags after each of many saves within the same second', async () => {
    renderHook(() => useSidebarTags(useNoteStore((s) => s.notes)));
    await tagsSettleOn('v0');

    for (let i = 1; i <= 10; i++) {
      body = `#v${i}`;
      act(() => useNoteStore.getState().markNoteSaved(note.path, body));
      await tagsSettleOn(`v${i}`);
    }
    for (let i = 11; i <= 30; i++) {
      body = `#v${i}`;
      act(() => useNoteStore.getState().markNoteSaved(note.path, body));
    }

    await tagsSettleOn('v30');
    expect(useNoteStore.getState().notes[0].modifiedAt).toBe(200);
  });

  it('re-reads a note changed outside the app when the list keeps its modification time', async () => {
    renderHook(() => useSidebarTags(useNoteStore((s) => s.notes)));
    await tagsSettleOn('v0');

    body = '#outside';
    act(() => {
      markNoteTagsStale(note.path);
      useNoteStore.getState().setNotes([{ ...note }]);
    });

    await tagsSettleOn('outside');
  });

  it('reads an unchanged note only once across list refreshes', async () => {
    renderHook(() => useSidebarTags(useNoteStore((s) => s.notes)));
    await tagsSettleOn('v0');

    for (let i = 0; i < 5; i++) act(() => useNoteStore.getState().setNotes([{ ...note }]));

    await tagsSettleOn('v0');
    expect(invokeMock.mock.calls.filter(([command]) => command === 'read_note')).toHaveLength(1);
  });
});

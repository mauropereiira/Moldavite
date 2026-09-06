/** Regression coverage for note navigation yielding transient exploration views. */

import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useGraphStore } from '@/stores/graphStore';
import { useNoteStore } from '@/stores/noteStore';
import { useTimelineStore } from '@/stores/timelineStore';
import { useToastStore } from '@/stores/toastStore';
import type { NoteFile } from '@/types';

const invokeMock = vi.fn();

vi.mock('@/lib/ipc', () => ({
  safeInvoke: (...args: unknown[]) => invokeMock(...args),
}));

import { useNotes } from './useNotes';

const noteFile: NoteFile = {
  name: 'After timeline.md',
  path: 'notes/After timeline.md',
  isDaily: false,
  isWeekly: false,
  isLocked: false,
};

beforeEach(() => {
  localStorage.clear();
  useToastStore.setState({ toasts: [] });
  invokeMock.mockReset();
  invokeMock.mockImplementation(async (command: string) => {
    if (command === 'list_notes') return [noteFile];
    if (command === 'read_note') return '# Opened note';
    return undefined;
  });
  useNoteStore.setState({
    notes: [],
    openTabs: [],
    activeTabId: null,
    currentNote: null,
    recentNoteIds: [],
    unlockedNotes: new Set(),
    isLoading: false,
    isSaving: false,
  });
  useTimelineStore.getState().close();
  useGraphStore.getState().close();
});

describe('useNotes navigation', () => {
  it.each(['daily', 'weekly'] as const)('keeps the current note when a %s download is pending', async (kind) => {
    const hook = renderHook(() => useNotes());
    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith('list_notes'));
    await act(() => hook.result.current.loadNote(noteFile));
    const current = useNoteStore.getState().currentNote;
    const message = 'This note is waiting for iCloud to download.';
    invokeMock.mockImplementation(async (command: string) => {
      if (command === 'read_note') throw new Error(message);
      if (command === 'write_note') return { contentHash: 'saved', conflictCopy: null };
      if (command === 'list_notes') return [noteFile];
      return undefined;
    });
    await act(() => kind === 'daily'
      ? hook.result.current.loadDailyNote(new Date(2026, 8, 6))
      : hook.result.current.loadWeeklyNote(new Date(2026, 8, 6)));
    expect(useNoteStore.getState().currentNote).toBe(current);
    expect(useToastStore.getState().toasts.some((toast) => toast.message.includes(message))).toBe(true);
    expect(invokeMock.mock.calls.filter(([command]) => command === 'write_note')
      .every(([, payload]) => payload.filename === noteFile.name)).toBe(true);
  });

  it('opens a sidebar note after the timeline and yields the editor pane', async () => {
    const hook = renderHook(() => useNotes());
    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith('list_notes'));

    act(() => useTimelineStore.getState().open());
    expect(useTimelineStore.getState().isOpen).toBe(true);

    await act(() => hook.result.current.loadNote(noteFile));

    expect(useNoteStore.getState().currentNote?.id).toBe(noteFile.path);
    expect(useTimelineStore.getState().isOpen).toBe(false);
  });

  it('also closes the graph overlay when navigation comes from outside the graph', async () => {
    const hook = renderHook(() => useNotes());
    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith('list_notes'));

    act(() => useGraphStore.getState().open());
    await act(() => hook.result.current.loadNote(noteFile));

    expect(useNoteStore.getState().currentNote?.id).toBe(noteFile.path);
    expect(useGraphStore.getState().isOpen).toBe(false);
  });
});

/** Regression coverage for note navigation yielding transient exploration views. */

import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useGraphStore } from '@/stores/graphStore';
import { useNoteStore } from '@/stores/noteStore';
import { useTimelineStore } from '@/stores/timelineStore';
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
  useTimelineStore.setState({ isOpen: false });
  useGraphStore.setState({ isOpen: false });
});

describe('useNotes navigation', () => {
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

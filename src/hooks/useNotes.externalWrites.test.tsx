import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getLastPersistedMarkdown } from '@/lib/fileSystem';
import { useNoteStore } from '@/stores/noteStore';
import { useTemplateStore } from '@/stores/templateStore';

const invokeMock = vi.fn();

vi.mock('@/lib/ipc', () => ({
  safeInvoke: (...args: unknown[]) => invokeMock(...args),
}));

import { useNotes } from './useNotes';

beforeEach(() => {
  localStorage.clear();
  invokeMock.mockReset();
  invokeMock.mockImplementation(async (command: string) => {
    if (command === 'list_notes') return [];
    if (command === 'read_note') {
      return { content: '', color: null, contentHash: 'empty-hash' };
    }
    if (command === 'create_note') return 'created.md';
    return undefined;
  });
  useTemplateStore.setState({ defaultDailyTemplate: null });
  useNoteStore.setState({
    notes: [],
    openTabs: [],
    activeTabId: null,
    currentNote: null,
    recentNoteIds: [],
    unlockedNotes: new Set(),
    externallyChanged: new Set(),
    isLoading: false,
    isSaving: false,
  });
});

describe('useNotes external-write bases', () => {
  it('reads a missing daily note before opening its virtual buffer', async () => {
    const hook = renderHook(() => useNotes());
    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith('list_notes'));

    await act(() => hook.result.current.loadDailyNote(new Date(2026, 6, 31)));

    expect(invokeMock).toHaveBeenCalledWith('read_note', {
      filename: '2026-07-31.md',
      isDaily: true,
      isWeekly: false,
    });
    expect(getLastPersistedMarkdown('2026-07-31.md', true, false)).toBe('');
    expect(useNoteStore.getState().currentNote?.id).toBe('2026-07-31.md');
  });

  it('opens a raced daily file as a real note when the list was stale', async () => {
    invokeMock.mockImplementation(async (command: string) => {
      if (command === 'list_notes') return [];
      if (command === 'read_note') {
        return { content: '# Agent update', color: null, contentHash: 'agent-hash' };
      }
      return undefined;
    });
    const hook = renderHook(() => useNotes());
    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith('list_notes'));

    await act(() => hook.result.current.loadDailyNote(new Date(2026, 6, 31)));

    expect(useNoteStore.getState().currentNote).toMatchObject({
      id: 'daily/2026-07-31.md',
      isDaily: true,
      date: '2026-07-31',
    });
    expect(useNoteStore.getState().currentNote?.content).toContain('Agent update');
    expect(useNoteStore.getState().notes).toContainEqual(
      expect.objectContaining({ path: 'daily/2026-07-31.md' })
    );
  });

  it('primes the empty base after creating a standalone note', async () => {
    const hook = renderHook(() => useNotes());
    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith('list_notes'));

    await act(() => hook.result.current.createNote('Created'));

    expect(invokeMock).toHaveBeenCalledWith('read_note', {
      filename: 'created.md',
      isDaily: false,
      isWeekly: false,
    });
    expect(getLastPersistedMarkdown('created.md', false, false)).toBe('');
  });
});

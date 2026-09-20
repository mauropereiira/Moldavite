import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useNoteStore } from '@/stores/noteStore';

const invokeMock = vi.fn();

vi.mock('@/lib/ipc', () => ({
  safeInvoke: (...args: unknown[]) => invokeMock(...args),
}));

import { useKeyboardShortcuts } from './useKeyboardShortcuts';

beforeEach(() => {
  invokeMock.mockReset();
  invokeMock.mockImplementation(async (command: string) => {
    if (command === 'read_note') {
      return { content: '', color: null, contentHash: 'h' };
    }
    return undefined;
  });
  useNoteStore.setState({ notes: [], currentNote: null, openTabs: [], activeTabId: null });
});

describe('useKeyboardShortcuts template creation', () => {
  it('addresses a template note created with no note open by its notes/ path', async () => {
    const hook = renderHook(() => useKeyboardShortcuts({ editor: null }));

    await act(() => hook.result.current.handleTemplateSelect('template-1'));

    const all = useNoteStore.getState().notes;
    const created = all[all.length - 1];
    expect(created).toBeDefined();
    // Standalone notes are addressed by their notes/-relative path everywhere
    // else (useNotes.createNote, listNotes, the Forge watcher). A bare filename
    // leaves the open tab unmatchable by external-change reconciliation.
    expect(created?.path).toBe(`notes/${created?.name}`);
    expect(useNoteStore.getState().currentNote?.id).toBe(`notes/${created?.name}`);
  });
});

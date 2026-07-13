/** Verifies that temporary unlock exposes decrypted Markdown as view-only editor HTML. */

import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useNoteStore } from '@/stores/noteStore';
import type { NoteFile } from '@/types';

const invokeMock = vi.fn();

vi.mock('@/lib/ipc', () => ({
  safeInvoke: (...args: unknown[]) => invokeMock(...args),
}));

import { useSidebarLock } from './useSidebarLock';

const lockedNote: NoteFile = {
  name: 'Secret.md',
  path: 'notes/Secret.md',
  isDaily: false,
  isWeekly: false,
  isLocked: true,
};

beforeEach(() => {
  localStorage.clear();
  invokeMock.mockReset();
  useNoteStore.setState({
    notes: [lockedNote],
    openTabs: [],
    activeTabId: null,
    currentNote: null,
    recentNoteIds: [],
    unlockedNotes: new Set(),
    isLoading: false,
    isSaving: false,
  });
});

describe('useSidebarLock unlock', () => {
  it('loads decrypted Markdown into the editor as HTML immediately', async () => {
    invokeMock.mockImplementation(async (command: string) => {
      if (command === 'unlock_note') return '# Decrypted\n\nVisible immediately';
      return undefined;
    });

    const hook = renderHook(() => useSidebarLock());
    act(() => hook.result.current.openUnlock(lockedNote));
    await act(() => hook.result.current.submit('password', [lockedNote]));

    const state = useNoteStore.getState();
    expect(state.activeTabId).toBe(lockedNote.path);
    expect(state.currentNote?.content).toContain('<h1>Decrypted</h1>');
    expect(state.currentNote?.content).toContain('<p>Visible immediately</p>');
    expect(state.unlockedNotes.has(lockedNote.path)).toBe(true);
  });
});

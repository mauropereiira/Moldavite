/** Lock/unlock regressions for open editor tabs and decrypted view-only content. */

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

const unlockedNote: NoteFile = {
  ...lockedNote,
  name: 'Open.md',
  path: 'notes/Open.md',
  isLocked: false,
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

  it('locks an open note without corrupting the note store', async () => {
    invokeMock.mockImplementation(async (command: string) => {
      if (command === 'write_note') {
        return { contentHash: 'saved-before-lock', conflictCopy: null };
      }
      return undefined;
    });
    const openNote = {
      id: unlockedNote.path,
      title: 'Secret',
      content: '<p>Editable secret</p>',
      createdAt: new Date(0),
      updatedAt: new Date(0),
      isDaily: false,
      isWeekly: false,
    };
    useNoteStore.setState({
      notes: [unlockedNote],
      openTabs: [openNote],
      activeTabId: openNote.id,
      currentNote: openNote,
    });

    const hook = renderHook(() => useSidebarLock());
    act(() => hook.result.current.openLock(unlockedNote));
    await act(() => hook.result.current.submit('password', [unlockedNote]));

    const state = useNoteStore.getState();
    expect(state.notes[0].isLocked).toBe(true);
    expect(state.openTabs).toEqual([]);
    expect(state.activeTabId).toBeNull();
    expect(state.currentNote).toBeNull();
    expect(invokeMock.mock.calls.map(([command]) => command)).toEqual(['write_note', 'lock_note']);
  });
});

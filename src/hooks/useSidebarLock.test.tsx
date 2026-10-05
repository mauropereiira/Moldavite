/** Lock/unlock regressions for open editor tabs and decrypted view-only content. */

import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { isCurrentNoteViewOnly, useNoteStore } from '@/stores/noteStore';
import { useToastStore } from '@/stores/toastStore';
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
      if (command === 'unlock_note') {
        return { content: '# Decrypted\n\nVisible immediately', conflictCopy: null };
      }
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

  it('names the copy kept when an interrupted lock left a different plaintext beside it', async () => {
    const keptCopy: NoteFile = {
      ...unlockedNote,
      name: 'Secret (conflict 2026-10-05 0900).md',
      path: 'notes/Secret (conflict 2026-10-05 0900).md',
    };
    invokeMock.mockImplementation(async (command: string) => {
      if (command === 'unlock_note') {
        return { content: 'Locked body', conflictCopy: 'Secret (conflict 2026-10-05 0900).md' };
      }
      if (command === 'list_notes') return [lockedNote, keptCopy];
      return undefined;
    });
    useToastStore.setState({ toasts: [] });

    const hook = renderHook(() => useSidebarLock());
    act(() => hook.result.current.openUnlock(lockedNote));
    await act(() => hook.result.current.submit('password', [lockedNote]));

    expect(useNoteStore.getState().currentNote?.content).toContain('Locked body');
    expect(useToastStore.getState().toasts).toContainEqual(
      expect.objectContaining({
        type: 'warning',
        message:
          'Kept a different unlocked copy of this note as Secret (conflict 2026-10-05 0900).md',
      })
    );
    await vi.waitFor(() => expect(useNoteStore.getState().notes).toEqual([lockedNote, keptCopy]));
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

describe('useSidebarLock permanent unlock', () => {
  it('names the copy kept when the plaintext beside the locked file differed', async () => {
    invokeMock.mockImplementation(async (command: string) => {
      if (command === 'permanently_unlock_note') return 'Secret (conflict 2026-10-05 0900).md';
      if (command === 'list_notes') return [{ ...lockedNote, isLocked: false }];
      return undefined;
    });
    useToastStore.setState({ toasts: [] });

    const hook = renderHook(() => useSidebarLock());
    act(() => hook.result.current.openPermanentUnlock(lockedNote));
    await act(() => hook.result.current.submit('password', [lockedNote]));

    expect(
      useToastStore
        .getState()
        .toasts.map((toast) => toast.type)
        .sort()
    ).toEqual(['success', 'warning']);
    expect(invokeMock.mock.calls.map(([command]) => command)).toContain('list_notes');
  });

  it('makes a note viewed this session editable again, with its disk body', async () => {
    invokeMock.mockImplementation(async (command: string) => {
      if (command === 'read_note') return { content: 'Plain now', contentHash: 'h1' };
      return undefined;
    });
    const viewed = {
      id: lockedNote.path,
      title: 'Secret',
      content: '<p>Decrypted view</p>',
      createdAt: new Date(0),
      updatedAt: new Date(0),
      isDaily: false,
      isWeekly: false,
    };
    useNoteStore.setState({
      openTabs: [viewed],
      activeTabId: viewed.id,
      currentNote: viewed,
      unlockedNotes: new Set([lockedNote.path]),
      savedContent: new Map(),
    });

    const hook = renderHook(() => useSidebarLock());
    act(() => hook.result.current.openPermanentUnlock(lockedNote));
    await act(() => hook.result.current.submit('password', [lockedNote]));

    const state = useNoteStore.getState();
    expect(state.notes[0].isLocked).toBe(false);
    expect(state.unlockedNotes.has(lockedNote.path)).toBe(false);
    expect(isCurrentNoteViewOnly(state)).toBe(false);
    expect(state.currentNote?.content).toContain('Plain now');
    expect(state.savedContent.get(lockedNote.path)).toBe(state.currentNote?.content);
  });
});

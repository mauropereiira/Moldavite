/** Save-on-leave, stale navigation, locked-note routing, and the one startup note-list load. */

import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useNoteStore } from '@/stores/noteStore';
import { useOverlayStore } from '@/stores/overlayStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { useTemplateStore } from '@/stores/templateStore';
import { useToastStore } from '@/stores/toastStore';
import type { NoteFile } from '@/types';
import { getPendingAutosaveNoteId, registerAutosaveCloseGuard } from '@/lib/autosaveFlush';
import { discardLeaveSave, hasUnsavedEdits, heldLeaveSaveIds } from '@/lib/leaveSave';

const invokeMock = vi.fn();

vi.mock('@/lib/ipc', () => ({
  safeInvoke: (...args: unknown[]) => invokeMock(...args),
}));

import { initializeNotes, useNotes } from './useNotes';
import { useAutoSave } from './useAutoSave';
import { useFolders } from './useFolders';
import { useTrash } from './useTrash';

const standalone = (name: string): NoteFile => ({
  name,
  path: `notes/${name}`,
  isDaily: false,
  isWeekly: false,
  isLocked: false,
});

let disk: Record<string, string> = {};
let writeError: Error | null = null;

function writes() {
  return invokeMock.mock.calls.filter(([command]) => command === 'write_note');
}

function lastWrite() {
  const all = writes();
  return all[all.length - 1]?.[1];
}

function renderNotes() {
  return renderHook(() => {
    const notes = useNotes();
    useAutoSave();
    return notes;
  });
}

beforeEach(() => {
  localStorage.clear();
  disk = {};
  writeError = null;
  invokeMock.mockReset();
  invokeMock.mockImplementation(async (command: string, payload?: { filename?: string }) => {
    if (command === 'read_note') {
      const content = disk[payload?.filename ?? ''] ?? '';
      return { content, color: null, contentHash: `hash:${content}` };
    }
    if (command === 'write_note') {
      if (writeError) throw writeError;
      return { contentHash: 'written', conflictCopy: null };
    }
    if (command === 'list_notes') return [];
    return undefined;
  });
  useTemplateStore.setState({ defaultDailyTemplate: null });
  useSettingsStore.setState({ autoSaveDelay: 60_000, indexMode: 'overlay' });
  useOverlayStore.setState({ activeOverlay: null });
  useNoteStore.setState({
    notes: [],
    openTabs: [],
    activeTabId: null,
    currentNote: null,
    recentNoteIds: [],
    unlockedNotes: new Set(),
    externallyChanged: new Map(),
    savedContent: new Map(),
    pendingUnlock: null,
    isLoading: false,
    isSaving: false,
  });
  useToastStore.setState({ toasts: [] });
});

afterEach(() => {
  for (const id of heldLeaveSaveIds()) discardLeaveSave(id);
  vi.useRealTimers();
});

/** Leave `name` with `typed` in it while every write fails, so its save is held. */
async function holdSave(hook: ReturnType<typeof renderNotes>, name: string, typed: string) {
  writeError = new Error('disk full');
  await act(() => hook.result.current.loadNote(standalone(name)));
  act(() => useNoteStore.getState().updateNoteContent(typed, `notes/${name}`));
  await act(() => hook.result.current.loadNote(standalone('Elsewhere.md')));
  expect(heldLeaveSaveIds()).toContain(`notes/${name}`);
}

describe('save on leave', () => {
  it('does not write a note that was only viewed', async () => {
    disk = { 'Viewed.md': '| a | b |\n| - | - |\n| 1 | 2 |', 'Next.md': 'next' };
    const hook = renderNotes();

    await act(() => hook.result.current.loadNote(standalone('Viewed.md')));
    await act(() => hook.result.current.loadNote(standalone('Next.md')));

    expect(writes()).toHaveLength(0);
    expect(useNoteStore.getState().currentNote?.id).toBe('notes/Next.md');
  });

  it('writes an edited note once when leaving it', async () => {
    disk = { 'Edited.md': 'before', 'Other.md': 'other' };
    const hook = renderNotes();

    await act(() => hook.result.current.loadNote(standalone('Edited.md')));
    act(() => useNoteStore.getState().updateNoteContent('<p>typed</p>', 'notes/Edited.md'));
    await act(() => hook.result.current.loadNote(standalone('Other.md')));

    expect(writes()).toHaveLength(1);
    expect(writes()[0][1]).toMatchObject({ filename: 'Edited.md', content: 'typed' });
    expect(useNoteStore.getState().currentNote?.id).toBe('notes/Other.md');
  });

  it('does not delete an empty daily note that was only viewed', async () => {
    const daily: NoteFile = {
      name: '2026-09-21.md',
      path: 'daily/2026-09-21.md',
      isDaily: true,
      isWeekly: false,
      isLocked: false,
      date: '2026-09-21',
    };
    useNoteStore.setState({ notes: [daily] });
    const hook = renderNotes();

    await act(() => hook.result.current.loadNote(daily));
    await act(() => hook.result.current.loadNote(standalone('Away.md')));

    expect(invokeMock).not.toHaveBeenCalledWith('delete_note', expect.anything());
    expect(writes()).toHaveLength(0);
  });

  it('opens the next note when saving the previous one fails, then retries and reports once', async () => {
    vi.useFakeTimers();
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    disk = { 'Stuck.md': 'before', 'Fine.md': 'fine', 'Third.md': 'third' };
    writeError = new Error('disk full');
    const hook = renderNotes();

    await act(() => hook.result.current.loadNote(standalone('Stuck.md')));
    act(() => useNoteStore.getState().updateNoteContent('<p>keep me</p>', 'notes/Stuck.md'));
    await act(() => hook.result.current.loadNote(standalone('Fine.md')));

    const state = useNoteStore.getState();
    expect(state.currentNote?.id).toBe('notes/Fine.md');
    expect(state.openTabs.find((tab) => tab.id === 'notes/Stuck.md')?.content).toBe(
      '<p>keep me</p>'
    );
    expect(useToastStore.getState().toasts).toHaveLength(0);
    expect(writes()).toHaveLength(1);

    await act(() => vi.advanceTimersByTimeAsync(1000));
    expect(writes()).toHaveLength(2);
    await act(() => vi.advanceTimersByTimeAsync(2000));
    expect(writes()).toHaveLength(3);
    expect(useToastStore.getState().toasts).toHaveLength(0);
    await act(() => vi.advanceTimersByTimeAsync(4000));
    expect(writes()).toHaveLength(4);

    const [failure] = useToastStore.getState().toasts;
    expect(useToastStore.getState().toasts).toHaveLength(1);
    expect(failure.message).toContain('Stuck');
    expect(failure.actions?.map((action) => action.label)).toEqual(['Retry', 'Save as a copy']);

    act(() => useNoteStore.getState().switchTab('notes/Stuck.md'));
    await act(() => hook.result.current.loadNote(standalone('Third.md')));
    expect(useToastStore.getState().toasts).toHaveLength(1);

    invokeMock.mockImplementation(async (command: string) => {
      if (command === 'preserve_buffer_copy') return 'Stuck 2026-09-23 0800.md';
      if (command === 'read_note') return { content: 'before', color: null, contentHash: 'b' };
      if (command === 'list_notes') return [];
      return undefined;
    });
    await act(async () => {
      failure.actions?.[1].onClick();
      await vi.runOnlyPendingTimersAsync();
    });

    expect(invokeMock).toHaveBeenCalledWith(
      'preserve_buffer_copy',
      expect.objectContaining({ filename: 'Stuck.md', content: 'keep me' })
    );
    const toasts = useToastStore.getState().toasts;
    expect(toasts.some((toast) => toast.actions)).toBe(false);
    expect(toasts[0]).toMatchObject({ type: 'success' });
    const stuck = useNoteStore.getState().openTabs.find((tab) => tab.id === 'notes/Stuck.md');
    expect(stuck?.content).toContain('before');
    expect(hasUnsavedEdits('notes/Stuck.md')).toBe(false);
    consoleError.mockRestore();
  });
});

describe('held saves are never replaced by disk text', () => {
  it('reopens a closed held note from its held text and saves that text', async () => {
    vi.useFakeTimers();
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    disk = { 'Held.md': 'old disk text' };
    const hook = renderNotes();
    await holdSave(hook, 'Held.md', '<p>held words</p>');

    act(() => useNoteStore.getState().closeTab('notes/Held.md'));
    await act(() => hook.result.current.loadNote(standalone('Held.md')));
    expect(useNoteStore.getState().currentNote?.content).toBe('<p>held words</p>');

    writeError = null;
    await act(() => vi.advanceTimersByTimeAsync(1000));
    expect(lastWrite()).toMatchObject({ filename: 'Held.md', content: 'held words' });
    expect(heldLeaveSaveIds()).toHaveLength(0);
    consoleError.mockRestore();
  });

  it("keeps a new daily note's held text when Today is opened again", async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const hook = renderNotes();
    const today = new Date(2026, 8, 23);
    await act(() => hook.result.current.loadDailyNote(today));
    act(() => useNoteStore.getState().updateNoteContent('<p>morning</p>', 'daily/2026-09-23.md'));
    writeError = new Error('disk full');
    await act(() => hook.result.current.loadNote(standalone('Elsewhere.md')));
    expect(heldLeaveSaveIds()).toEqual(['daily/2026-09-23.md']);

    await act(() => hook.result.current.loadDailyNote(today));
    expect(useNoteStore.getState().currentNote?.content).toBe('<p>morning</p>');

    act(() => useNoteStore.getState().closeTab('daily/2026-09-23.md'));
    await act(() => hook.result.current.loadDailyNote(today));

    expect(useNoteStore.getState().currentNote?.content).toBe('<p>morning</p>');
    expect(hasUnsavedEdits('daily/2026-09-23.md')).toBe(true);
    consoleError.mockRestore();
  });
});

describe('writes that race new typing', () => {
  it('keeps text typed while the leave write was in flight', async () => {
    disk = { 'Racing.md': 'start' };
    let finishWrite!: () => void;
    const hook = renderNotes();
    await act(() => hook.result.current.loadNote(standalone('Racing.md')));
    act(() => useNoteStore.getState().updateNoteContent('<p>first</p>', 'notes/Racing.md'));
    invokeMock.mockImplementation(async (command: string, payload?: { filename?: string }) => {
      if (command === 'read_note') {
        return { content: disk[payload?.filename ?? ''] ?? '', color: null, contentHash: 'h' };
      }
      if (command === 'write_note' && writes().length === 1) {
        await new Promise<void>((resolve) => {
          finishWrite = resolve;
        });
      }
      if (command === 'write_note') return { contentHash: 'w', conflictCopy: null };
      return undefined;
    });

    let leaving!: Promise<void>;
    act(() => {
      leaving = hook.result.current.loadNote(standalone('Next.md'));
    });
    await act(async () => {});
    act(() =>
      useNoteStore.getState().updateNoteContent('<p>first and more</p>', 'notes/Racing.md')
    );
    await act(async () => {});
    finishWrite();
    await act(() => leaving);
    await act(async () => {});

    expect(lastWrite()).toMatchObject({
      filename: 'Racing.md',
      content: 'first and more',
    });
    expect(getPendingAutosaveNoteId()).toBeNull();
  });

  it('saves an open tab with unsaved edits before the window closes', async () => {
    useNoteStore.setState({
      openTabs: [
        {
          id: 'notes/Loose.md',
          title: 'Loose',
          content: '<p>never autosaved</p>',
          createdAt: new Date(0),
          updatedAt: new Date(0),
          isDaily: false,
          isWeekly: false,
        },
      ],
      savedContent: new Map([['notes/Loose.md', '<p>on disk</p>']]),
    });
    let onClose!: (event: { preventDefault: () => void }) => Promise<void>;
    const destroy = vi.fn(async () => {});
    const stopGuard = await registerAutosaveCloseGuard({
      onCloseRequested: async (handler) => {
        onClose = handler as typeof onClose;
        return () => {};
      },
      destroy,
    });

    await act(() => onClose({ preventDefault: vi.fn() }));

    expect(lastWrite()).toMatchObject({ filename: 'Loose.md', content: 'never autosaved' });
    expect(destroy).toHaveBeenCalledOnce();
    stopGuard();
  });
});

describe('held saves and structural changes', () => {
  it('refuses to rename a note whose save is held', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const hook = renderNotes();
    await holdSave(hook, 'Named.md', '<p>held</p>');
    act(() => useNoteStore.getState().closeTab('notes/Named.md'));

    await expect(
      act(() => hook.result.current.renameNote(standalone('Named.md'), 'Renamed'))
    ).rejects.toThrow('Save pending changes');
    expect(invokeMock).not.toHaveBeenCalledWith('rename_note', expect.anything());
    consoleError.mockRestore();
  });

  it('refuses to rename a folder holding a held save', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const hook = renderNotes();
    await holdSave(hook, 'Box/Inside.md', '<p>held</p>');
    act(() => useNoteStore.getState().closeTab('notes/Box/Inside.md'));
    const folders = renderHook(() => useFolders());

    await expect(
      act(() => folders.result.current.renameExistingFolder('Box', 'Crate'))
    ).rejects.toThrow('Save pending changes');
    expect(invokeMock).not.toHaveBeenCalledWith('rename_folder', expect.anything());
    consoleError.mockRestore();
  });

  it('drops held saves inside a folder moved to the trash', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const hook = renderNotes();
    await holdSave(hook, 'Bin/Doomed.md', '<p>held</p>');
    act(() => useNoteStore.getState().closeTab('notes/Bin/Doomed.md'));
    invokeMock.mockImplementation(async () => []);
    const trash = renderHook(() => useTrash());

    await act(() => trash.result.current.trashFolder('Bin'));

    expect(invokeMock).toHaveBeenCalledWith('trash_folder', { path: 'Bin' });
    expect(heldLeaveSaveIds()).toHaveLength(0);
    consoleError.mockRestore();
  });
});

describe('closing with a held save', () => {
  it('retries at once, blocks the close while it fails, and closes after it saves', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    disk = { 'Held.md': 'before', 'Else.md': 'else' };
    writeError = new Error('disk full');
    const hook = renderNotes();
    await act(() => hook.result.current.loadNote(standalone('Held.md')));
    act(() => useNoteStore.getState().updateNoteContent('<p>held text</p>', 'notes/Held.md'));
    await act(() => hook.result.current.loadNote(standalone('Else.md')));
    expect(writes()).toHaveLength(1);

    let onClose!: (event: { preventDefault: () => void }) => Promise<void>;
    const destroy = vi.fn(async () => {});
    const stopGuard = await registerAutosaveCloseGuard({
      onCloseRequested: async (handler) => {
        onClose = handler as typeof onClose;
        return () => {};
      },
      destroy,
    });

    await act(() => onClose({ preventDefault: vi.fn() }));
    expect(writes()).toHaveLength(2);
    expect(destroy).not.toHaveBeenCalled();
    const [failure] = useToastStore.getState().toasts;
    expect(failure.message).toContain('Held');
    expect(failure.actions?.map((action) => action.label)).toEqual(['Retry', 'Save as a copy']);

    writeError = null;
    await act(() => onClose({ preventDefault: vi.fn() }));
    expect(writes()[2][1]).toMatchObject({ filename: 'Held.md', content: 'held text' });
    expect(destroy).toHaveBeenCalledOnce();
    expect(useToastStore.getState().toasts.some((toast) => toast.actions)).toBe(false);
    stopGuard();
    consoleError.mockRestore();
  });
});

describe('navigation', () => {
  it('ignores a load that finishes after a newer one', async () => {
    let releaseSlow!: () => void;
    let slowStarted!: () => void;
    const slowReading = new Promise<void>((resolve) => {
      slowStarted = resolve;
    });
    invokeMock.mockImplementation(async (command: string, payload?: { filename?: string }) => {
      if (command !== 'read_note') return undefined;
      if (payload?.filename === 'Slow.md') {
        slowStarted();
        await new Promise<void>((resolve) => {
          releaseSlow = resolve;
        });
      }
      return { content: payload?.filename ?? '', color: null, contentHash: 'h' };
    });
    const hook = renderNotes();

    let slow!: Promise<void>;
    act(() => {
      slow = hook.result.current.loadNote(standalone('Slow.md'));
    });
    await act(() => slowReading);
    await act(() => hook.result.current.loadNote(standalone('Fast.md')));
    releaseSlow();
    await act(() => slow);

    const state = useNoteStore.getState();
    expect(state.currentNote?.id).toBe('notes/Fast.md');
    expect(state.openTabs.map((tab) => tab.id)).toEqual(['notes/Fast.md']);
  });

  it('addresses a new daily note by its daily/ path, like the note list', async () => {
    const hook = renderNotes();

    await act(() => hook.result.current.loadDailyNote(new Date(2026, 8, 22)));
    expect(useNoteStore.getState().currentNote?.id).toBe('daily/2026-09-22.md');

    await act(() =>
      hook.result.current.loadNote({
        name: '2026-09-22.md',
        path: 'daily/2026-09-22.md',
        isDaily: true,
        isWeekly: false,
        isLocked: false,
        date: '2026-09-22',
      })
    );
    expect(useNoteStore.getState().openTabs).toHaveLength(1);
  });

  it('sends a locked note to the unlock prompt instead of opening it blank', async () => {
    const locked: NoteFile = { ...standalone('Secret.md'), isLocked: true };
    useNoteStore.setState({ notes: [locked] });
    const hook = renderNotes();

    await act(() => hook.result.current.loadNote({ ...locked, isLocked: false }));

    expect(invokeMock).not.toHaveBeenCalledWith('read_note', expect.anything());
    expect(useNoteStore.getState().currentNote).toBeNull();
    expect(useNoteStore.getState().pendingUnlock).toEqual(locked);
    expect(useOverlayStore.getState().activeOverlay).toBe('index');
  });
});

describe('note-list initialization', () => {
  it('loads once for the app, however many components use the hook', async () => {
    renderHook(() => {
      useNotes();
      useNotes();
      useNotes();
    });
    await act(async () => {});
    expect(invokeMock).not.toHaveBeenCalledWith('list_notes');

    await act(() => Promise.all([initializeNotes(), initializeNotes()]));

    expect(invokeMock.mock.calls.filter(([command]) => command === 'list_notes')).toHaveLength(1);
    expect(
      invokeMock.mock.calls.filter(([command]) => command === 'ensure_directories')
    ).toHaveLength(1);
  });
});

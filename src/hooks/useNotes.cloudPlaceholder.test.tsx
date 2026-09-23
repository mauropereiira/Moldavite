/** Notes still in iCloud: placeholder tabs, explicit downloads, and never writing a placeholder. */

import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useNoteStore } from '@/stores/noteStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { useTemplateStore } from '@/stores/templateStore';
import { useToastStore } from '@/stores/toastStore';
import type { NoteFile } from '@/types';

const invokeMock = vi.fn();

vi.mock('@/lib/ipc', () => ({
  safeInvoke: (...args: unknown[]) => invokeMock(...args),
}));

import { useNotes } from './useNotes';
import { useAutoSave } from './useAutoSave';
import { reconcileExternalNoteChange } from './useForgeWatcher';
import {
  NOT_DOWNLOADED_MESSAGE,
  applyCloudChange,
  downloadCloudNote,
  useCloudDownloadStore,
} from '@/lib/cloudNotes';
import { hasUnsavedEdits, saveHeldNotesNow, saveNoteOnLeave } from '@/lib/leaveSave';
import { CloudPlaceholderWriteError, deleteNote, writeNote } from '@/lib/fileSystem';
import { flushAutosaveWhenHidden, flushPendingAutosave } from '@/lib/autosaveFlush';

const remote: NoteFile = {
  name: 'Plan.md',
  path: 'notes/Remote/Plan.md',
  folderPath: 'Remote',
  isDaily: false,
  isWeekly: false,
  isLocked: false,
  notDownloaded: true,
};

const remoteDaily: NoteFile = {
  name: '2026-09-20.md',
  path: 'daily/2026-09-20.md',
  isDaily: true,
  isWeekly: false,
  date: '2026-09-20',
  isLocked: false,
  notDownloaded: true,
};

const localNote: NoteFile = {
  name: 'Local.md',
  path: 'notes/Local.md',
  isDaily: false,
  isWeekly: false,
  isLocked: false,
};

let disk: Record<string, string> = {};
let downloaded = new Set<string>();
let listed: NoteFile[] = [];

function diskPath(payload: { filename: string; isDaily: boolean; isWeekly: boolean }): string {
  const folder = payload.isDaily ? 'daily' : payload.isWeekly ? 'weekly' : 'notes';
  return `${folder}/${payload.filename}`;
}

function mutations() {
  return invokeMock.mock.calls.filter(([command]) =>
    ['write_note', 'delete_note', 'preserve_buffer_copy', 'create_note'].includes(command)
  );
}

function renderNotes() {
  return renderHook(() => {
    const notes = useNotes();
    useAutoSave();
    return notes;
  });
}

function currentTab() {
  const tab = useNoteStore.getState().currentNote;
  if (!tab) throw new Error('no open tab');
  return tab;
}

function download(path: string, body: string) {
  downloaded.add(path);
  disk[path] = body;
}

beforeEach(() => {
  localStorage.clear();
  disk = { 'notes/Local.md': 'local body' };
  downloaded = new Set(['notes/Local.md']);
  listed = [remote, remoteDaily, localNote];
  invokeMock.mockReset();
  invokeMock.mockImplementation(async (command: string, payload?: Record<string, unknown>) => {
    if (command === 'read_note') {
      const path = diskPath(payload as { filename: string; isDaily: boolean; isWeekly: boolean });
      if (!downloaded.has(path)) throw new Error(NOT_DOWNLOADED_MESSAGE);
      const content = disk[path] ?? '';
      return { content, color: null, contentHash: `hash:${content}` };
    }
    if (command === 'list_notes') {
      return listed.map((note) => ({ ...note, notDownloaded: !downloaded.has(note.path) }));
    }
    if (command === 'icloud_download_note') return { downloaded: false, error: null };
    if (command === 'write_note') return { contentHash: 'written', conflictCopy: null };
    return undefined;
  });
  useTemplateStore.setState({ defaultDailyTemplate: null });
  useSettingsStore.setState({ autoSaveDelay: 60_000 });
  useNoteStore.setState({
    notes: [remote, remoteDaily, localNote],
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
  useCloudDownloadStore.setState({ downloads: {} });
});

afterEach(() => {
  Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
});

describe('opening a note that is still in iCloud', () => {
  it('opens a placeholder tab without downloading the note or showing an error', async () => {
    const hook = renderNotes();
    await act(() => hook.result.current.loadNote(remote));

    expect(currentTab()).toMatchObject({ id: remote.path, content: '', cloudPending: true });
    expect(invokeMock).not.toHaveBeenCalledWith('icloud_download_note', expect.anything());
    expect(useToastStore.getState().toasts).toEqual([]);
  });

  it('loads at once when the note list trails a download that already finished', async () => {
    const hook = renderNotes();
    download(remote.path, 'already here');
    await act(() => hook.result.current.loadNote(remote));

    expect(currentTab().cloudPending).toBeFalsy();
    expect(currentTab().content).toContain('already here');
  });

  it('does not come back spinning after leaving a note while it downloaded', async () => {
    const hook = renderNotes();
    await act(() => hook.result.current.loadNote(remote));
    await act(() => downloadCloudNote(currentTab()));
    await act(() => hook.result.current.loadNote(localNote));
    expect(useNoteStore.getState().openTabs.some((tab) => tab.cloudPending)).toBe(false);

    await act(() =>
      applyCloudChange({
        refreshList: true,
        initial: false,
        items: [{ path: remote.path, downloaded: true, error: null }],
      })
    );

    expect(useCloudDownloadStore.getState().downloads[remote.path]).toBeUndefined();
  });

  it('opens a placeholder when the read reports the note not downloaded', async () => {
    const hook = renderNotes();
    await act(() => hook.result.current.loadNote({ ...remote, notDownloaded: false }));
    expect(currentTab().cloudPending).toBe(true);

    await act(() => hook.result.current.loadDailyNote(new Date(2026, 8, 20)));
    expect(currentTab()).toMatchObject({ id: remoteDaily.path, cloudPending: true });
    expect(useToastStore.getState().toasts).toEqual([]);
  });

  it('downloads on request and loads the note when iCloud reports it downloaded', async () => {
    const hook = renderNotes();
    await act(() => hook.result.current.loadNote(remote));

    await act(() => downloadCloudNote(currentTab()));
    expect(invokeMock).toHaveBeenCalledWith('icloud_download_note', {
      filename: 'Remote/Plan.md',
      isDaily: false,
      isWeekly: false,
    });
    expect(useCloudDownloadStore.getState().downloads[remote.path]).toEqual({
      state: 'downloading',
    });

    download(remote.path, '# Plan\n\nFrom iCloud');
    await act(() =>
      applyCloudChange({
        refreshList: true,
        initial: false,
        items: [{ path: remote.path, downloaded: true, error: null }],
      })
    );

    const tab = currentTab();
    expect(tab.cloudPending).toBeFalsy();
    expect(tab.content).toContain('From iCloud');
    expect(useNoteStore.getState().savedContent.get(remote.path)).toBe(tab.content);
    expect(useCloudDownloadStore.getState().downloads[remote.path]).toBeUndefined();
    await act(() => flushPendingAutosave());
    expect(mutations()).toEqual([]);
  });

  it('shows why a download failed, and does not ask iCloud while offline', async () => {
    const hook = renderNotes();
    await act(() => hook.result.current.loadNote(remote));

    await act(() =>
      applyCloudChange({
        refreshList: false,
        initial: false,
        items: [
          { path: remote.path, downloaded: false, error: 'The network connection was lost.' },
        ],
      })
    );
    expect(useCloudDownloadStore.getState().downloads[remote.path]).toEqual({
      state: 'error',
      message: 'The network connection was lost.',
    });

    Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });
    invokeMock.mockClear();
    await act(() => downloadCloudNote(currentTab()));
    expect(invokeMock).not.toHaveBeenCalledWith('icloud_download_note', expect.anything());
    expect(useCloudDownloadStore.getState().downloads[remote.path]).toMatchObject({
      state: 'error',
      message: expect.stringContaining('offline'),
    });
    expect(currentTab().cloudPending).toBe(true);
  });

  it('closes the placeholder when the note is deleted in iCloud', async () => {
    const hook = renderNotes();
    await act(() => hook.result.current.loadNote(remote));
    listed = [localNote];
    downloaded.add(remote.path);

    await act(() => reconcileExternalNoteChange(remote.path));

    expect(useNoteStore.getState().openTabs).toEqual([]);
    expect(mutations()).toEqual([]);
  });
});

describe('text typed after a placeholder is kept', () => {
  it('saves a new note created where a deleted placeholder was', async () => {
    const ideas: NoteFile = {
      ...localNote,
      name: 'Ideas.md',
      path: 'notes/Ideas.md',
      notDownloaded: true,
    };
    listed = [ideas, localNote];
    const hook = renderNotes();
    await act(() => hook.result.current.loadNote(ideas));
    expect(currentTab().cloudPending).toBe(true);

    // Deleted on another device: the placeholder closes.
    listed = [localNote];
    downloaded.add(ideas.path);
    await act(() => reconcileExternalNoteChange(ideas.path));
    expect(useNoteStore.getState().openTabs).toEqual([]);

    invokeMock.mockImplementation(async (command: string) => {
      if (command === 'create_note') return 'Ideas.md';
      if (command === 'read_note') return { content: '', color: null, contentHash: 'empty' };
      if (command === 'write_note') return { contentHash: 'written', conflictCopy: null };
      if (command === 'list_notes') return [localNote];
      return undefined;
    });
    await act(() => hook.result.current.createNote('Ideas'));
    const created = currentTab();
    expect(created.id).toBe('notes/Ideas.md');
    act(() => useNoteStore.getState().updateNoteContent('<p>my idea</p>', created.id));

    await act(async () => {
      expect(await saveNoteOnLeave(currentTab())).toBe(true);
    });
    expect(invokeMock).toHaveBeenCalledWith(
      'write_note',
      expect.objectContaining({ filename: 'Ideas.md', content: 'my idea' })
    );
  });

  it('keeps retrying a note iCloud evicted while it had edits, until it is back', async () => {
    vi.useFakeTimers();
    try {
      const hook = renderNotes();
      await act(() => hook.result.current.loadNote(localNote));
      act(() => useNoteStore.getState().updateNoteContent('<p>edited</p>', localNote.path));
      let evicted = true;
      invokeMock.mockImplementation(async (command: string) => {
        if (command === 'write_note') {
          if (evicted) throw new Error(NOT_DOWNLOADED_MESSAGE);
          return { contentHash: 'written', conflictCopy: null };
        }
        if (command === 'read_note') throw new Error(NOT_DOWNLOADED_MESSAGE);
        return [];
      });

      await act(async () => {
        expect(await saveNoteOnLeave(currentTab())).toBe(false);
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1000 + 2000 + 4000 + 4000);
      });
      expect(hasUnsavedEdits(localNote.path)).toBe(true);

      evicted = false;
      await act(async () => {
        await vi.advanceTimersByTimeAsync(4000);
      });
      expect(hasUnsavedEdits(localNote.path)).toBe(false);
      expect(invokeMock).toHaveBeenLastCalledWith(
        'write_note',
        expect.objectContaining({ filename: 'Local.md', content: 'edited' })
      );
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('a placeholder is never written', () => {
  it('ignores edits and is never saved or deleted on leave, flush, hide or close', async () => {
    const hook = renderNotes();
    const stopHiddenFlush = flushAutosaveWhenHidden();
    await act(() => hook.result.current.loadDailyNote(new Date(2026, 8, 20)));
    const placeholder = currentTab();
    expect(placeholder.cloudPending).toBe(true);

    act(() => useNoteStore.getState().updateNoteContent('<p>typed</p>', placeholder.id));
    act(() => useNoteStore.getState().updateTabContent(placeholder.id, '<p>typed</p>'));
    expect(currentTab().content).toBe('');
    expect(hasUnsavedEdits(placeholder.id)).toBe(false);

    // Even a placeholder holding text it should never have is not written.
    const tampered = { ...placeholder, content: '<p>not the note</p>' };
    await act(async () => {
      expect(await saveNoteOnLeave(tampered)).toBe(true);
      expect(await saveNoteOnLeave(placeholder)).toBe(true);
    });
    await act(() => flushPendingAutosave());
    await act(() => saveHeldNotesNow());
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
      window.dispatchEvent(new Event('pagehide'));
    });
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });

    await act(() => hook.result.current.loadNote(localNote));
    expect(currentTab().id).toBe(localNote.path);
    act(() => useNoteStore.getState().closeTab(placeholder.id));
    await act(() => flushPendingAutosave());

    expect(mutations()).toEqual([]);
    stopHiddenFlush();
  });

  it('refuses writes and guarded deletes to its address until the downloaded note is read', async () => {
    const hook = renderNotes();
    await act(() => hook.result.current.loadNote(remoteDaily));

    await expect(writeNote('2026-09-20.md', '', true, false)).rejects.toBeInstanceOf(
      CloudPlaceholderWriteError
    );
    await expect(
      deleteNote('2026-09-20.md', true, false, { guarded: true })
    ).rejects.toBeInstanceOf(CloudPlaceholderWriteError);
    expect(mutations()).toEqual([]);

    download(remoteDaily.path, 'daily body');
    await act(() =>
      applyCloudChange({
        refreshList: true,
        initial: false,
        items: [{ path: remoteDaily.path, downloaded: true, error: null }],
      })
    );
    await expect(writeNote('2026-09-20.md', 'edited', true, false)).resolves.toMatchObject({
      contentHash: 'written',
    });
  });

  it('is not treated as edited or missing by the watcher before it downloads', async () => {
    const hook = renderNotes();
    await act(() => hook.result.current.loadNote(remote));

    await act(() => reconcileExternalNoteChange(remote.path));

    expect(currentTab()).toMatchObject({ id: remote.path, cloudPending: true });
    expect(useNoteStore.getState().externallyChanged.size).toBe(0);
    expect(useToastStore.getState().toasts).toEqual([]);

    download(remote.path, 'arrived');
    await act(() => reconcileExternalNoteChange(remote.path));
    expect(currentTab().cloudPending).toBeFalsy();
    expect(currentTab().content).toContain('arrived');
    expect(mutations()).toEqual([]);
  });
});

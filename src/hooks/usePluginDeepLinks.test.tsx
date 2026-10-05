/** Validation and cold/running delivery tests for app deep links. */

import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useGraphStore } from '@/stores/graphStore';
import { useNoteStore } from '@/stores/noteStore';
import { usePluginInstallStore } from '@/stores/pluginInstallStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { useToastStore } from '@/stores/toastStore';
import type { Note, NoteFile } from '@/types';
import { useLaunchContextStore, wasLaunchedWithFile } from '@/lib/launchContext';
import { installWindowDropGuard } from '@/lib/dropGuard';

const invokeMock = vi.fn();
const listenMock = vi.fn();
let eventHandler: (() => void) | undefined;
let pendingRequests: unknown[];
let listedNotes: NoteFile[];

vi.mock('@/lib/ipc', () => ({
  safeInvoke: (...args: unknown[]) => invokeMock(...args),
}));

vi.mock('@tauri-apps/api/event', () => ({
  listen: (...args: unknown[]) => listenMock(...args),
}));

import {
  noteDeepLink,
  routeNoteRequest,
  routePluginInstallRequest,
  routeTodayRequest,
  usePluginDeepLinks,
} from './usePluginDeepLinks';

const rootNote: NoteFile = {
  name: 'Root note.md',
  path: 'notes/Root note.md',
  isDaily: false,
  isWeekly: false,
  isLocked: false,
};

const folderedNote: NoteFile = {
  name: 'café notes.md',
  path: 'notes/Projects/café notes.md',
  folderPath: 'Projects',
  isDaily: false,
  isWeekly: false,
  isLocked: false,
};

beforeEach(() => {
  localStorage.clear();
  useLaunchContextStore.setState({ ready: false, launchedWithFile: false });
  eventHandler = undefined;
  pendingRequests = [];
  listedNotes = [rootNote, folderedNote];
  invokeMock.mockReset().mockImplementation(async (command: string) => {
    if (command === 'take_pending_deep_links') {
      const requests = pendingRequests;
      pendingRequests = [];
      return requests;
    }
    if (command === 'list_notes') return listedNotes;
    if (command === 'admit_dropped_files') {
      return [
        {
          kind: 'loose',
          id: '0123456789abcdef0123456789abcdef',
          name: 'Read me.md',
          dirDisplay: '~',
        },
      ];
    }
    if (command === 'read_loose_file') {
      return {
        body: 'Opened from Finder',
        hash: 'loose-hash',
        readOnly: false,
        name: 'Read me.md',
        dirDisplay: '~/Desktop',
      };
    }
    if (command === 'read_note') {
      return { content: '# Opened note', color: null, contentHash: 'content-hash' };
    }
    return undefined;
  });
  listenMock.mockReset().mockImplementation(async (_event: string, handler: () => void) => {
    eventHandler = handler;
    return vi.fn();
  });
  useSettingsStore.setState({ isSettingsOpen: false, activeSettingsTab: 'general' });
  usePluginInstallStore.setState({ pending: null });
  useGraphStore.getState().close();
  useToastStore.setState({ toasts: [] });
  useNoteStore.setState({
    notes: [],
    openTabs: [],
    activeTabId: null,
    currentNote: null,
    recentNoteIds: [],
    unlockedNotes: new Set(),
    externallyChanged: new Map(),
    isLoading: false,
    isSaving: false,
  });
});

describe('app deep links', () => {
  it('round-trips root and foldered note identities through Copy URL encoding', () => {
    const root: Note = {
      id: rootNote.path,
      title: 'Root note',
      content: '',
      createdAt: new Date(),
      updatedAt: new Date(),
      isDaily: false,
      isWeekly: false,
    };
    const foldered = { ...root, id: folderedNote.path, title: 'café notes' };

    expect(noteDeepLink(root)).toBe('moldavite://note/Root%20note.md');
    expect(noteDeepLink(foldered)).toBe('moldavite://note/Projects%2Fcaf%C3%A9%20notes.md');
    expect(
      noteDeepLink({
        ...root,
        id: 'daily/2026-08-14.md',
        isDaily: true,
        date: '2026-08-14',
      })
    ).toBe('moldavite://note/daily%2F2026-08-14.md');
    expect(
      noteDeepLink({
        ...root,
        id: 'weekly/2026-W33.md',
        isWeekly: true,
        week: '2026-W33',
      })
    ).toBe('moldavite://note/weekly%2F2026-W33.md');
  });

  it('opens a validated cold-start note through the normal tab flow', async () => {
    pendingRequests = [{ kind: 'note', path: 'Projects/café notes.md' }];

    renderHook(() => usePluginDeepLinks());

    await waitFor(() => expect(useNoteStore.getState().currentNote?.id).toBe(folderedNote.path));
    expect(invokeMock).toHaveBeenCalledWith('read_note', {
      filename: 'Projects/café notes.md',
      isDaily: false,
      isWeekly: false,
    });
  });

  it('drains the same backend queue for a running-instance note event', async () => {
    renderHook(() => usePluginDeepLinks());
    await waitFor(() => expect(eventHandler).toBeTypeOf('function'));
    pendingRequests = [{ kind: 'note', path: 'Root note.md' }];

    act(() => eventHandler?.());

    await waitFor(() => expect(useNoteStore.getState().currentNote?.id).toBe(rootNote.path));
    expect(invokeMock).toHaveBeenCalledWith('read_note', {
      filename: 'Root note.md',
      isDaily: false,
      isWeekly: false,
    });
  });

  it('shows a visible error when a linked note does not exist', async () => {
    listedNotes = [];
    useNoteStore.setState({ notes: [rootNote] });

    expect(
      await routeNoteRequest('Root note.md', vi.fn(), async () => {
        useNoteStore.setState({ notes: listedNotes });
      })
    ).toBe(false);

    expect(useToastStore.getState().toasts[0]?.message).toBe(
      'The linked note was not found in this Forge.'
    );
  });

  it('opens Settings with a validated plugin request and yields transient views', () => {
    useGraphStore.getState().open();

    expect(routePluginInstallRequest('publish-wordpress')).toBe(true);

    expect(usePluginInstallStore.getState().pending?.id).toBe('publish-wordpress');
    expect(useSettingsStore.getState().isSettingsOpen).toBe(true);
    expect(useSettingsStore.getState().activeSettingsTab).toBe('plugins');
    expect(useGraphStore.getState().isOpen).toBe(false);
  });

  it('keeps plugin requests on the shared cold-start queue', async () => {
    pendingRequests = [{ kind: 'plugin', id: 'publish-wordpress' }];

    renderHook(() => usePluginDeepLinks());

    await waitFor(() =>
      expect(usePluginInstallStore.getState().pending?.id).toBe('publish-wordpress')
    );
    expect(useSettingsStore.getState().activeSettingsTab).toBe('plugins');
  });

  it('opens a file the OS handed over as a loose tab, never a Forge note', async () => {
    const id = '0123456789abcdef0123456789abcdef';
    pendingRequests = [
      { kind: 'loose', id, name: 'Read me.md', dirDisplay: '~/Desktop', atLaunch: true },
      { kind: 'loose', id: '../../etc/passwd', name: 'x', dirDisplay: '/' },
    ];

    renderHook(() => usePluginDeepLinks());

    await waitFor(() => expect(useNoteStore.getState().currentNote?.id).toBe(`loose:${id}`));
    expect(useNoteStore.getState().openTabs).toHaveLength(1);
    expect(useNoteStore.getState().currentNote?.loose).toMatchObject({
      looseId: id,
      name: 'Read me.md',
      dir: '~/Desktop',
    });
    expect(invokeMock).toHaveBeenCalledWith('read_loose_file', { id });
    expect(invokeMock).not.toHaveBeenCalledWith('read_note', expect.anything());
    expect(wasLaunchedWithFile()).toBe(true);
    await waitFor(() => expect(useLaunchContextStore.getState().ready).toBe(true));
  });

  it('waits for the initial drain before deciding whether welcome pages can open', async () => {
    let finishDrain: ((requests: unknown[]) => void) | undefined;
    const delayedDrain = new Promise<unknown[]>((resolve) => {
      finishDrain = resolve;
    });
    const invoke = invokeMock.getMockImplementation();
    invokeMock.mockImplementation((command: string, ...args: unknown[]) =>
      command === 'take_pending_deep_links' ? delayedDrain : invoke?.(command, ...args)
    );
    renderHook(() => usePluginDeepLinks());
    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith('take_pending_deep_links'));
    expect(useLaunchContextStore.getState().ready).toBe(false);
    await act(async () => finishDrain?.([]));
    expect(useLaunchContextStore.getState().ready).toBe(true);
    expect(wasLaunchedWithFile()).toBe(false);
  });

  it('uses Rust launch knowledge when file admission has not reached the queue yet', async () => {
    invokeMock.mockImplementation(async (command: string) =>
      command === 'was_launched_with_file' ? true : []
    );
    renderHook(() => usePluginDeepLinks());
    await waitFor(() => expect(useLaunchContextStore.getState().ready).toBe(true));
    expect(invokeMock).toHaveBeenCalledWith('was_launched_with_file');
    expect(wasLaunchedWithFile()).toBe(true);
    expect(useNoteStore.getState().openTabs).toHaveLength(0);
  });

  it('opens a Markdown file dropped on the window through Rust, as a loose tab', async () => {
    const uninstall = installWindowDropGuard();
    const { unmount } = renderHook(() => usePluginDeepLinks());
    const file = new File(['# Hi'], 'Read me.md', { type: 'text/markdown' });
    const drop = new Event('drop', { bubbles: true, cancelable: true }) as DragEvent;
    Object.defineProperty(drop, 'dataTransfer', {
      value: { types: ['Files'], files: [file], getData: () => '' },
    });

    document.body.dispatchEvent(drop);

    await waitFor(() =>
      expect(useNoteStore.getState().currentNote?.id).toBe('loose:0123456789abcdef0123456789abcdef')
    );
    expect(invokeMock).toHaveBeenCalledWith(
      'admit_dropped_files',
      expect.objectContaining({ candidates: [expect.objectContaining({ name: 'Read me.md' })] })
    );
    unmount();
    uninstall();
  });

  it('rejects malformed frontend payloads defensively', async () => {
    const loadNote = vi.fn();
    const refresh = vi.fn().mockResolvedValue(undefined);

    expect(routePluginInstallRequest('valid-plugin/extra')).toBe(false);
    expect(routePluginInstallRequest('-leading')).toBe(false);
    expect(await routeNoteRequest('../evil.md', loadNote, refresh)).toBe(false);
    expect(await routeNoteRequest('/absolute.md', loadNote, refresh)).toBe(false);
    expect(await routeNoteRequest('C:/evil.md', loadNote, refresh)).toBe(false);
    expect(loadNote).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
  });
});

describe('routeTodayRequest', () => {
  it('leaves every page and opens today through the daily-note path', async () => {
    useSettingsStore.getState().setIsSettingsOpen(true);
    useGraphStore.getState().open();
    const loadDailyNote = vi.fn().mockResolvedValue(undefined);

    await routeTodayRequest(loadDailyNote);

    expect(useSettingsStore.getState().isSettingsOpen).toBe(false);
    expect(useGraphStore.getState().isOpen).toBe(false);
    expect(loadDailyNote).toHaveBeenCalledTimes(1);
    const requested = loadDailyNote.mock.calls[0][0] as Date;
    expect(requested.toDateString()).toBe(new Date().toDateString());
    expect(useNoteStore.getState().selectedDate.toDateString()).toBe(new Date().toDateString());
  });

  it('is accepted by the drain as a pending request', async () => {
    useNoteStore.getState().setSelectedDate(new Date(2000, 0, 1));
    pendingRequests = [{ kind: 'today' }];

    renderHook(() => usePluginDeepLinks());

    await waitFor(() => {
      expect(useNoteStore.getState().selectedDate.toDateString()).toBe(new Date().toDateString());
    });
  });
});

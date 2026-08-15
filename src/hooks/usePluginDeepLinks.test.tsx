/** Validation and cold/running delivery tests for app deep links. */

import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useGraphStore } from '@/stores/graphStore';
import { useNoteStore } from '@/stores/noteStore';
import { usePluginInstallStore } from '@/stores/pluginInstallStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { useTimelineStore } from '@/stores/timelineStore';
import { useToastStore } from '@/stores/toastStore';
import type { Note, NoteFile } from '@/types';

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
  useTimelineStore.getState().close();
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
    expect(invokeMock).toHaveBeenLastCalledWith('read_note', {
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
    useTimelineStore.getState().open();
    useGraphStore.getState().open();

    expect(routePluginInstallRequest('publish-wordpress')).toBe(true);

    expect(usePluginInstallStore.getState().pending?.id).toBe('publish-wordpress');
    expect(useSettingsStore.getState().isSettingsOpen).toBe(true);
    expect(useSettingsStore.getState().activeSettingsTab).toBe('plugins');
    expect(useTimelineStore.getState().isOpen).toBe(false);
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

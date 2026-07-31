import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getLastPersistedMarkdown, markdownToHtml, readNoteWithMeta } from '@/lib/fileSystem';
import { registerAutosaveBaselineReset, registerAutosavePendingProbe } from '@/lib/autosaveFlush';
import { useNoteStore } from '@/stores/noteStore';
import type { Note } from '@/types';

const invokeMock = vi.fn();

vi.mock('@/lib/ipc', () => ({
  safeInvoke: (...args: unknown[]) => invokeMock(...args),
}));

import { reconcileExternalNoteChange } from './useForgeWatcher';

const dailyTab = (content: string): Note => ({
  id: '2026-07-31.md',
  title: 'July 31, 2026',
  content,
  createdAt: new Date(0),
  updatedAt: new Date(0),
  isDaily: true,
  isWeekly: false,
  date: '2026-07-31',
});

beforeEach(() => {
  invokeMock.mockReset();
  useNoteStore.setState({
    notes: [],
    openTabs: [],
    activeTabId: null,
    currentNote: null,
    externallyChanged: new Set(),
  });
});

describe('external Forge watcher reconciliation', () => {
  it('replaces a clean tab, refreshes persistence state, and resets autosave baseline', async () => {
    invokeMock.mockResolvedValueOnce({ content: 'old body', color: null, contentHash: 'old-hash' });
    await readNoteWithMeta('2026-07-31.md', true, false);
    const tab = dailyTab(markdownToHtml('old body'));
    useNoteStore.setState({ openTabs: [tab], activeTabId: tab.id, currentNote: tab });
    invokeMock.mockResolvedValueOnce({
      content: 'agent body',
      color: null,
      contentHash: 'new-hash',
    });
    const reset = vi.fn();
    const unregisterReset = registerAutosaveBaselineReset(reset);
    const unregisterProbe = registerAutosavePendingProbe(() => null);

    await reconcileExternalNoteChange('daily/2026-07-31.md');

    const current = useNoteStore.getState().currentNote;
    expect(current?.content).toContain('agent body');
    expect(current?.externalRev).toBe(1);
    expect(useNoteStore.getState().externallyChanged.has(tab.id)).toBe(false);
    expect(getLastPersistedMarkdown('2026-07-31.md', true, false)).toBe('agent body');
    expect(reset).toHaveBeenCalledWith(tab.id, current?.content);
    unregisterProbe();
    unregisterReset();
  });

  it('leaves a dirty standalone buffer and its stale hash untouched', async () => {
    invokeMock.mockResolvedValueOnce({ content: 'old body', color: null, contentHash: 'old-hash' });
    await readNoteWithMeta('folder/note.md', false, false);
    const tab: Note = {
      ...dailyTab(markdownToHtml('my edit')),
      id: 'notes/folder/note.md',
      title: 'note',
      isDaily: false,
      date: undefined,
    };
    useNoteStore.setState({ openTabs: [tab], activeTabId: tab.id, currentNote: tab });
    const unregisterProbe = registerAutosavePendingProbe(() => null);

    await reconcileExternalNoteChange('notes/folder/note.md');

    expect(useNoteStore.getState().currentNote?.content).toBe(tab.content);
    expect(useNoteStore.getState().externallyChanged.has(tab.id)).toBe(true);
    expect(getLastPersistedMarkdown('folder/note.md', false, false)).toBe('old body');
    expect(invokeMock).toHaveBeenCalledTimes(1);
    unregisterProbe();
  });

  it('treats a queued debounce as dirty even when HTML matches persisted Markdown', async () => {
    invokeMock.mockResolvedValueOnce({
      content: 'same body',
      color: null,
      contentHash: 'same-hash',
    });
    await readNoteWithMeta('2026-W31.md', false, true);
    const tab: Note = {
      ...dailyTab(markdownToHtml('same body')),
      id: 'weekly/2026-W31.md',
      isDaily: false,
      isWeekly: true,
      date: undefined,
      week: '2026-W31',
    };
    useNoteStore.setState({ openTabs: [tab], activeTabId: tab.id, currentNote: tab });
    const unregisterProbe = registerAutosavePendingProbe(() => tab.id);

    await reconcileExternalNoteChange('weekly/2026-W31.md');

    expect(useNoteStore.getState().externallyChanged.has(tab.id)).toBe(true);
    expect(invokeMock).toHaveBeenCalledTimes(1);
    unregisterProbe();
  });
});

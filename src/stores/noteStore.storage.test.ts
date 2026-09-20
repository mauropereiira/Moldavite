/** Store behaviour when localStorage is unavailable or names a stale Forge. */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { useNoteStore } from './noteStore';
import { rememberActiveForge } from '@/lib/forgeStorage';
import type { Note } from '@/types';

const makeNote = (id: string): Note => ({
  id,
  title: id,
  content: `<p>${id}</p>`,
  createdAt: new Date(0),
  updatedAt: new Date(0),
  isDaily: false,
  isWeekly: false,
});

/** The test setup replaces localStorage with a plain object, so spy on it. */
const failStorageWrites = () => {
  vi.spyOn(localStorage, 'setItem').mockImplementation(() => {
    throw new Error('QuotaExceededError');
  });
};

const reset = () => {
  useNoteStore.setState({
    notes: [],
    openTabs: [],
    activeTabId: null,
    currentNote: null,
    recentNoteIds: [],
    unlockedNotes: new Set<string>(),
  });
};

describe('noteStore with unavailable localStorage', () => {
  beforeEach(() => {
    localStorage.clear();
    reset();
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('still closes a tab when the pinned-tab write throws', () => {
    const { openTab, closeTab } = useNoteStore.getState();
    openTab(makeNote('a'), true);
    openTab(makeNote('b'), true);

    failStorageWrites();

    expect(() => closeTab('b')).not.toThrow();
    expect(useNoteStore.getState().openTabs.map((tab) => tab.id)).toEqual(['a']);
  });

  it('auto-lock still drops the decrypted tab when storage throws', () => {
    const { openTab, unlockNote, lockNote } = useNoteStore.getState();
    openTab(makeNote('secret.md'), true);
    unlockNote('secret.md');

    failStorageWrites();

    expect(() => lockNote('secret.md')).not.toThrow();
    expect(useNoteStore.getState().openTabs).toHaveLength(0);
    expect(useNoteStore.getState().unlockedNotes.has('secret.md')).toBe(false);
  });

  it('reports a failed pin instead of throwing at the caller', () => {
    const { openTab } = useNoteStore.getState();
    openTab(makeNote('a'), true);

    failStorageWrites();

    expect(useNoteStore.getState().pinTab('a')).toEqual({ success: true });
    expect(useNoteStore.getState().openTabs[0].isPinned).toBe(true);
  });
});

describe('recent notes across a Forge switch', () => {
  beforeEach(() => {
    localStorage.clear();
    reset();
  });

  it('drops recents loaded under the Forge that was active at import time', () => {
    rememberActiveForge('Work');
    useNoteStore.getState().addRecentNote('notes/work-only.md');
    expect(useNoteStore.getState().recentNoteIds).toEqual(['notes/work-only.md']);

    // The switch reloads the page; the cache only names the new Forge once
    // `loadForges()` resolves, which is what fires this listener.
    rememberActiveForge('Personal');
    expect(useNoteStore.getState().recentNoteIds).toEqual([]);

    useNoteStore.getState().addRecentNote('notes/personal-only.md');
    rememberActiveForge('Work');
    expect(useNoteStore.getState().recentNoteIds).toEqual(['notes/work-only.md']);
  });
});

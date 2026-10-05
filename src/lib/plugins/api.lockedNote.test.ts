/** A locked note open for viewing stays out of plugin reads through the whole unlock and relock cycle. */

import { beforeEach, describe, expect, it } from 'vitest';
import { useNoteStore } from '@/stores/noteStore';
import type { Note } from '@/types';
import { dispatchPluginCall } from './api';

const makeNote = (id: string, content: string): Note => ({
  id,
  title: id.replace(/^notes\/|\.md$/g, ''),
  content,
  createdAt: new Date(0),
  updatedAt: new Date(0),
  isDaily: false,
  isWeekly: false,
});

const plain = makeNote('notes/Plain.md', '<p>plain text</p>');
const secret = makeNote('notes/Secret.md', '<p>decrypted secret</p>');

async function activeNoteForPlugin() {
  return (await dispatchPluginCall('demo', ['editor'], 'editor.getActiveNote', [])) as {
    path: string;
    content: string;
  } | null;
}

function viewLocked() {
  const store = useNoteStore.getState();
  store.setCurrentNote(secret);
  store.unlockNote(secret.id);
}

describe('editor.getActiveNote and locked notes', () => {
  beforeEach(() => {
    localStorage.clear();
    useNoteStore.setState({
      notes: [],
      openTabs: [],
      activeTabId: null,
      currentNote: null,
      unlockedNotes: new Set(),
    });
  });

  it('never returns the decrypted text across view, switch, relock, and reopen', async () => {
    const seen: unknown[] = [];
    const read = async () => {
      const note = await activeNoteForPlugin();
      seen.push(note);
      return note;
    };

    useNoteStore.getState().openTab(plain, true);
    expect((await read())?.path).toBe(plain.id);

    useNoteStore.getState().openTab(secret, true);
    useNoteStore.getState().unlockNote(secret.id);
    for (let i = 0; i < 20; i++) expect(await read()).toBeNull();

    useNoteStore.getState().switchTab(plain.id);
    expect((await read())?.path).toBe(plain.id);
    useNoteStore.getState().switchTab(secret.id);
    expect(useNoteStore.getState().currentNote?.id).toBe(secret.id);
    expect(await read()).toBeNull();

    await useNoteStore.getState().lockNote(secret.id);
    expect(useNoteStore.getState().openTabs.some((tab) => tab.id === secret.id)).toBe(false);
    expect((await read())?.path).toBe(plain.id);

    viewLocked();
    expect(await read()).toBeNull();
    await useNoteStore.getState().lockAllNotes();
    expect(await read()).not.toEqual(expect.objectContaining({ path: secret.id }));

    expect(JSON.stringify(seen)).not.toContain('decrypted secret');
  });

  it('returns a note again once it is permanently unlocked and opened normally', async () => {
    viewLocked();
    expect(await activeNoteForPlugin()).toBeNull();

    useNoteStore.setState({ unlockedNotes: new Set() });
    useNoteStore.getState().setCurrentNote(makeNote(secret.id, '<p>now plain</p>'));
    expect(await activeNoteForPlugin()).toEqual({
      path: secret.id,
      title: 'Secret',
      content: '<p>now plain</p>',
    });
  });
});

import { Profiler } from 'react';
import { act, render } from '@testing-library/react';
import { beforeEach, expect, it } from 'vitest';
import { useNoteStore } from '@/stores';
import type { Note } from '@/types';
import { useAutoLock } from './useAutoLock';
import { useFolders } from './useFolders';
import { useNotes } from './useNotes';
import { useSidebarLock } from './useSidebarLock';
import { useTrash } from './useTrash';

const note: Note = {
  id: 'notes/a.md',
  title: 'a',
  content: '<p>x</p>',
  isDaily: false,
  isWeekly: false,
  createdAt: new Date(0),
  updatedAt: new Date(0),
};

beforeEach(() => {
  useNoteStore.setState({ notes: [], openTabs: [], activeTabId: null, currentNote: null });
  act(() => {
    useNoteStore.getState().openTab(note);
  });
});

it.each([
  ['useNotes', useNotes],
  ['useAutoLock', useAutoLock],
  ['useSidebarLock', useSidebarLock],
  ['useFolders', useFolders],
  ['useTrash', useTrash],
])('%s does not re-render its host on a keystroke', (_name, useHook) => {
  let renders = 0;
  function Host() {
    useHook();
    return null;
  }
  render(
    <Profiler id="host" onRender={() => (renders += 1)}>
      <Host />
    </Profiler>
  );
  const before = renders;
  for (let i = 0; i < 10; i++) {
    act(() => {
      useNoteStore.getState().updateNoteContent(`<p>x${i}</p>`, note.id);
    });
  }
  expect(renders).toBe(before);
});

it('useNotes still re-renders when the note list changes', () => {
  let seen = -1;
  function Host({ onNotes }: { onNotes: (count: number) => void }) {
    onNotes(useNotes().notes.length);
    return null;
  }
  render(<Host onNotes={(count) => (seen = count)} />);
  act(() => {
    useNoteStore
      .getState()
      .setNotes([
        { name: 'a.md', path: 'notes/a.md', isDaily: false, isWeekly: false, isLocked: false },
      ]);
  });
  expect(seen).toBe(1);
});

it('useAutoLock still follows the unlocked-note set', () => {
  let renders = 0;
  function Host() {
    useAutoLock();
    return null;
  }
  render(
    <Profiler id="host" onRender={() => (renders += 1)}>
      <Host />
    </Profiler>
  );
  const before = renders;
  act(() => {
    useNoteStore.getState().unlockNote('notes/a.md');
  });
  expect(renders).toBeGreaterThan(before);
});

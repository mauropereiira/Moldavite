/**
 * Regression test for the per-keystroke re-render bug: `updateNoteContent`
 * (what the editor calls on every keystroke) must only touch `openTabs` and
 * `currentNote` — never `notes` — and components that select only note
 * *metadata* (not `currentNote` itself) must not re-render because of it.
 *
 * Probes below mirror the exact selectors Sidebar and PinnedBar use.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { act, render } from '@testing-library/react';
import { useNoteStore } from './noteStore';
import type { Note, NoteFile } from '@/types';

const makeNote = (id: string, overrides: Partial<Note> = {}): Note => ({
  id,
  title: id,
  content: `<p>${id}</p>`,
  createdAt: new Date(0),
  updatedAt: new Date(0),
  isDaily: false,
  isWeekly: false,
  ...overrides,
});

const makeNoteFile = (id: string): NoteFile => ({
  name: id,
  path: id,
  isDaily: false,
  isWeekly: false,
  isLocked: false,
});

// Mirrors src/components/sidebar/Sidebar.tsx's noteStore usage.
function SidebarProbe({ onRender }: { onRender: () => void }) {
  const currentNoteId = useNoteStore((state) => state.currentNote?.id ?? null);
  const setSelectedDate = useNoteStore((state) => state.setSelectedDate);
  onRender();
  return (
    <div data-testid="sidebar-probe">
      {currentNoteId ?? 'none'}-{typeof setSelectedDate}
    </div>
  );
}

// Mirrors src/components/layout/PinnedBar.tsx's noteStore usage.
function PinnedBarProbe({ onRender }: { onRender: () => void }) {
  const notes = useNoteStore((state) => state.notes);
  const currentNoteId = useNoteStore((state) => state.currentNote?.id ?? null);
  onRender();
  return (
    <div data-testid="pinned-bar-probe">
      {notes.length}-{currentNoteId ?? 'none'}
    </div>
  );
}

describe('noteStore selectors isolate metadata-only subscribers from content edits', () => {
  beforeEach(() => {
    localStorage.clear();
    useNoteStore.setState({
      notes: [],
      openTabs: [],
      activeTabId: null,
      currentNote: null,
      isLoading: false,
      isSaving: false,
    });
  });

  it('does not re-render on a content-only update, but does on setNotes/setCurrentNote', () => {
    const note = makeNote('daily/2026-09-03.md');
    act(() => {
      useNoteStore.getState().openTab(note, false);
    });

    let sidebarRenders = 0;
    let pinnedBarRenders = 0;

    render(
      <>
        <SidebarProbe onRender={() => (sidebarRenders += 1)} />
        <PinnedBarProbe onRender={() => (pinnedBarRenders += 1)} />
      </>
    );

    expect(sidebarRenders).toBe(1);
    expect(pinnedBarRenders).toBe(1);

    // The bug: Editor.tsx calls this on every keystroke.
    act(() => {
      useNoteStore.getState().updateNoteContent('<p>x</p>', note.id);
      useNoteStore.getState().updateNoteContent('<p>xy</p>', note.id);
      useNoteStore.getState().updateNoteContent('<p>xyz</p>', note.id);
    });

    // `updateNoteContent` replaces `currentNote` and the matching `openTabs`
    // entry, but never `id` — and never touches `notes` at all — so neither
    // probe should have re-rendered.
    expect(sidebarRenders).toBe(1);
    expect(pinnedBarRenders).toBe(1);

    // Not vacuous: a real notes-list change does re-render the PinnedBar probe.
    act(() => {
      useNoteStore.getState().setNotes([makeNoteFile(note.id)]);
    });
    expect(pinnedBarRenders).toBe(2);
    expect(sidebarRenders).toBe(1); // Sidebar's probe doesn't read `notes`.

    // Not vacuous: switching the active note does re-render the Sidebar probe.
    act(() => {
      useNoteStore.getState().setCurrentNote(makeNote('daily/2026-09-04.md'));
    });
    expect(sidebarRenders).toBe(2);
  });
});

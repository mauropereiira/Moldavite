/** A new note on the phone opens on its title with the keyboard held up. */

import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useNoteStore } from '@/stores/noteStore';

const platform = vi.hoisted(() => ({ mobile: true }));
const focus = vi.hoisted(() => ({ hold: vi.fn(), request: vi.fn() }));

vi.mock('@/lib/platform', () => ({
  isMobilePlatform: () => platform.mobile,
  isTabletPlatform: () => false,
}));
vi.mock('@/lib/noteTitleFocus', () => ({
  holdKeyboard: focus.hold,
  requestTitleFocus: focus.request,
}));
vi.mock('@/lib', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib')>()),
  createNote: vi.fn(async (title: string, folder?: string) =>
    folder ? `${folder}/${title}.md` : `${title}.md`
  ),
  readNoteWithMeta: vi.fn(async () => ({ content: '', color: null, contentHash: 'h' })),
}));

import { useNotes } from './useNotes';

beforeEach(() => {
  focus.hold.mockClear();
  focus.request.mockClear();
  useNoteStore.setState({ notes: [], openTabs: [], activeTabId: null, currentNote: null });
});

describe('useNotes.createNote', () => {
  it('holds the keyboard in the tap and opens the new note on its title', async () => {
    platform.mobile = true;
    const { result } = renderHook(() => useNotes());

    let creating: Promise<void> | undefined;
    act(() => {
      creating = result.current.createNote('Untitled', 'Projects');
    });
    expect(focus.hold).toHaveBeenCalledOnce();
    await act(() => creating);

    expect(focus.request).toHaveBeenCalledWith('notes/Projects/Untitled.md');
    expect(useNoteStore.getState().currentNote?.id).toBe('notes/Projects/Untitled.md');
  });

  it('lists the new note as created and modified now, for the time sorts', async () => {
    const before = Math.floor(Date.now() / 1000);
    const { result } = renderHook(() => useNotes());

    await act(() => result.current.createNote('Untitled'));

    const listed = useNoteStore.getState().notes.find((n) => n.path === 'notes/Untitled.md');
    expect(listed?.createdAt).toBeGreaterThanOrEqual(before);
    expect(listed?.modifiedAt).toBe(listed?.createdAt);
  });

  it('leaves the desktop flow alone', async () => {
    platform.mobile = false;
    const { result } = renderHook(() => useNotes());

    await act(() => result.current.createNote('Untitled'));

    expect(focus.hold).not.toHaveBeenCalled();
    expect(focus.request).not.toHaveBeenCalled();
    expect(useNoteStore.getState().currentNote?.id).toBe('notes/Untitled.md');
  });
});

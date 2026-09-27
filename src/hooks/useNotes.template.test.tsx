import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useNoteStore } from '@/stores/noteStore';

const ipc = vi.hoisted(() => ({ invoke: vi.fn() }));

vi.mock('@/lib/ipc', () => ({ safeInvoke: ipc.invoke }));

import { useNotes } from './useNotes';

beforeEach(() => {
  ipc.invoke.mockReset();
  useNoteStore.setState({ notes: [], openTabs: [], activeTabId: null, currentNote: null });
});

describe('useNotes.createFromTemplate', () => {
  it('opens the stepped name when the requested one was taken', async () => {
    ipc.invoke.mockImplementation(async (command: string) =>
      command === 'create_note_from_template'
        ? 'Work/Plan (2).md'
        : command === 'read_note'
          ? '# Plan'
          : undefined
    );
    const { result } = renderHook(() => useNotes());

    await act(() => result.current.createFromTemplate('Plan', 'meeting', false, 'Work'));

    expect(ipc.invoke).toHaveBeenCalledWith(
      'create_note_from_template',
      expect.objectContaining({ filename: 'Work/Plan.md' })
    );
    expect(useNoteStore.getState().currentNote?.id).toBe('notes/Work/Plan (2).md');
    expect(useNoteStore.getState().notes.map((n) => n.path)).toContain('notes/Work/Plan (2).md');
  });
});

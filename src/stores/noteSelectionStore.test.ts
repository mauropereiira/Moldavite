import { describe, it, expect, beforeEach } from 'vitest';
import { useNoteSelectionStore } from './noteSelectionStore';

describe('noteSelectionStore', () => {
  beforeEach(() => {
    // Each test starts from a pristine selection — the store is a singleton.
    useNoteSelectionStore.getState().clear();
  });

  it('toggles an id in and out of the selection', () => {
    const { toggle } = useNoteSelectionStore.getState();
    toggle('notes/a.md');
    expect(useNoteSelectionStore.getState().selectedIds.has('notes/a.md')).toBe(true);

    toggle('notes/a.md');
    expect(useNoteSelectionStore.getState().selectedIds.has('notes/a.md')).toBe(false);
    expect(useNoteSelectionStore.getState().selectedIds.size).toBe(0);
  });

  it('toggle accumulates distinct ids', () => {
    const { toggle } = useNoteSelectionStore.getState();
    toggle('a');
    toggle('b');
    toggle('c');
    const ids = Array.from(useNoteSelectionStore.getState().selectedIds);
    expect(ids).toEqual(expect.arrayContaining(['a', 'b', 'c']));
    expect(ids).toHaveLength(3);
  });

  it('selectRange replaces the selection with the given list', () => {
    const { toggle, selectRange } = useNoteSelectionStore.getState();
    toggle('preexisting');
    selectRange(['x', 'y', 'z']);
    const ids = useNoteSelectionStore.getState().selectedIds;
    expect(ids.has('preexisting')).toBe(false);
    expect(ids.size).toBe(3);
    expect(ids.has('x')).toBe(true);
    expect(ids.has('y')).toBe(true);
    expect(ids.has('z')).toBe(true);
  });

  it('clear empties the selection', () => {
    const { toggle, clear } = useNoteSelectionStore.getState();
    toggle('a');
    toggle('b');
    expect(useNoteSelectionStore.getState().selectedIds.size).toBe(2);
    clear();
    expect(useNoteSelectionStore.getState().selectedIds.size).toBe(0);
  });

  it('clear on an already-empty selection keeps referential identity', () => {
    const before = useNoteSelectionStore.getState().selectedIds;
    useNoteSelectionStore.getState().clear();
    const after = useNoteSelectionStore.getState().selectedIds;
    expect(after).toBe(before);
  });

  it('replace swaps the selection', () => {
    const { toggle, replace } = useNoteSelectionStore.getState();
    toggle('a');
    replace(['b', 'c']);
    const ids = useNoteSelectionStore.getState().selectedIds;
    expect(ids.has('a')).toBe(false);
    expect(ids.has('b')).toBe(true);
    expect(ids.has('c')).toBe(true);
  });
});

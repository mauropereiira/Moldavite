import { describe, it, expect, beforeEach } from 'vitest';
import { reorderIds, applyManualOrder, useSidebarOrderStore } from './sidebarOrderStore';

describe('reorderIds', () => {
  it('seeds the order from the current display order on the first drag', () => {
    expect(reorderIds([], ['a', 'b', 'c'], 'c', 'a', 'before')).toEqual(['c', 'a', 'b']);
  });

  it('inserts on the side of the target the hairline was drawn on', () => {
    expect(reorderIds(['a', 'b', 'c'], ['a', 'b', 'c'], 'a', 'c', 'before')).toEqual([
      'b',
      'a',
      'c',
    ]);
    expect(reorderIds(['a', 'b', 'c'], ['a', 'b', 'c'], 'c', 'b', 'before')).toEqual([
      'a',
      'c',
      'b',
    ]);
  });

  it('can place an id last, which "before" alone can never reach', () => {
    // Dropping on the lower half of the final row is the only way to become the
    // final row. Without it the end of a list is unreachable by drag.
    expect(reorderIds(['a', 'b', 'c'], ['a', 'b', 'c'], 'a', 'c', 'after')).toEqual([
      'b',
      'c',
      'a',
    ]);
    expect(reorderIds(['a', 'b', 'c'], ['a', 'b', 'c'], 'c', 'a', 'after')).toEqual([
      'a',
      'c',
      'b',
    ]);
  });

  it('leaves every id outside the dragged list alone', () => {
    // `x`/`y` are another folder's notes. Reordering one list must not disturb
    // another's arrangement — that is the whole reason one array can serve the
    // entire tree.
    const stored = ['x', 'a', 'y', 'b'];
    const next = reorderIds(stored, ['a', 'b'], 'b', 'a', 'before');
    expect(next.filter((id) => id === 'x' || id === 'y')).toEqual(['x', 'y']);
    expect(next.indexOf('b')).toBeLessThan(next.indexOf('a'));
  });

  it('is a no-op when an id is dropped on itself', () => {
    const stored = ['a', 'b'];
    expect(reorderIds(stored, ['a', 'b'], 'a', 'a', 'before')).toBe(stored);
  });
});

describe('applyManualOrder', () => {
  const id = (v: string) => v;

  it('replays the stored arrangement', () => {
    expect(applyManualOrder(['a', 'b', 'c'], id, ['c', 'a', 'b'])).toEqual(['c', 'a', 'b']);
  });

  it('puts unplaced items last, in the order they arrived', () => {
    // `new1`/`new2` are notes created since the last drag. Two unplaced items
    // must compare equal, not NaN — a NaN comparator scrambles the list.
    expect(applyManualOrder(['new1', 'b', 'new2', 'a'], id, ['a', 'b'])).toEqual([
      'a',
      'b',
      'new1',
      'new2',
    ]);
  });

  it('leaves the list untouched when nothing has been arranged', () => {
    const items = ['b', 'a'];
    expect(applyManualOrder(items, id, [])).toBe(items);
  });

  it('ignores stored ids for notes that no longer exist', () => {
    expect(applyManualOrder(['a', 'c'], id, ['c', 'deleted', 'a'])).toEqual(['c', 'a']);
  });
});

describe('useSidebarOrderStore', () => {
  beforeEach(() => useSidebarOrderStore.setState({ noteOrder: [], folderOrder: [] }));

  it('seeds an empty arrangement but never overwrites one', () => {
    // Manual mode is entered with a starting order so the list does not jump.
    // Re-entering it later must not wipe what the user arranged in between.
    useSidebarOrderStore.getState().seedNotes(['a', 'b', 'c']);
    expect(useSidebarOrderStore.getState().noteOrder).toEqual(['a', 'b', 'c']);

    useSidebarOrderStore.getState().moveNote('c', 'a', ['a', 'b', 'c'], 'before');
    useSidebarOrderStore.getState().seedNotes(['a', 'b', 'c']);
    expect(useSidebarOrderStore.getState().noteOrder).toEqual(['c', 'a', 'b']);
  });

  it('keeps note and folder arrangements apart', () => {
    useSidebarOrderStore
      .getState()
      .moveNote('notes/b.md', 'notes/a.md', ['notes/a.md', 'notes/b.md'], 'before');
    expect(useSidebarOrderStore.getState().noteOrder).toEqual(['notes/b.md', 'notes/a.md']);
    expect(useSidebarOrderStore.getState().folderOrder).toEqual([]);

    useSidebarOrderStore.getState().moveFolder('Work', 'Archive', ['Archive', 'Work'], 'before');
    expect(useSidebarOrderStore.getState().folderOrder).toEqual(['Work', 'Archive']);
    expect(useSidebarOrderStore.getState().noteOrder).toEqual(['notes/b.md', 'notes/a.md']);
  });
});

import { describe, it, expect } from 'vitest';
import { isSameFolder } from './dropPlacement';

describe('isSameFolder', () => {
  it('treats the two shapes of "no folder" as the same list', () => {
    // This is the whole reason the helper exists. `NoteFile.folderPath` is
    // `null` at the root (Rust `Option<String>` serialises `None` that way);
    // parsing the folder out of a dragged note's relative path gives
    // `undefined`. Comparing them raw made every root-note reorder bail at the
    // drop, after the insert line had already promised it would land.
    expect(isSameFolder(null, undefined)).toBe(true);
    expect(isSameFolder(undefined, null)).toBe(true);
    expect(isSameFolder(null, null)).toBe(true);
    expect(isSameFolder(undefined, undefined)).toBe(true);
  });

  it('matches notes filed in the same folder', () => {
    expect(isSameFolder('brain', 'brain')).toBe(true);
    expect(isSameFolder('Projects/Active', 'Projects/Active')).toBe(true);
  });

  it('separates different folders, and a folder from the root', () => {
    expect(isSameFolder('brain', 'captures')).toBe(false);
    expect(isSameFolder('Projects', 'Projects/Active')).toBe(false);
    expect(isSameFolder('brain', null)).toBe(false);
    expect(isSameFolder(undefined, 'brain')).toBe(false);
  });
});

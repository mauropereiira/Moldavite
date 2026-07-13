import { describe, expect, it } from 'vitest';
import type { NoteFile } from '@/types';
import { noteForGraphNode } from './addressing';

const note = (path: string, overrides: Partial<NoteFile> = {}): NoteFile => ({
  name: path.split('/').pop() ?? path,
  path,
  isDaily: false,
  isWeekly: false,
  isLocked: false,
  ...overrides,
});

describe('noteForGraphNode', () => {
  const notes = [
    note('daily/2026-07-12.md', { isDaily: true }),
    note('weekly/2026-W28.md', { isWeekly: true }),
    note('notes/Projects/plan.md', { folderPath: 'Projects' }),
    note('notes/Archive/plan.md', { folderPath: 'Archive' }),
  ];

  it('uses the exact graph path for daily, weekly, and folder notes', () => {
    expect(noteForGraphNode(notes, 'daily/2026-07-12.md')).toBe(notes[0]);
    expect(noteForGraphNode(notes, 'weekly/2026-W28.md')).toBe(notes[1]);
    expect(noteForGraphNode(notes, 'notes/Projects/plan.md')).toBe(notes[2]);
    expect(noteForGraphNode(notes, 'notes/Archive/plan.md')).toBe(notes[3]);
  });

  it('does not open a placeholder node', () => {
    expect(noteForGraphNode(notes, 'missing:ghost.md')).toBeUndefined();
  });
});

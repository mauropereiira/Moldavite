/** Global tag-rename addressing tests: notes in folders must not be skipped. */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NoteFile } from '@/types';

const invokeMock = vi.fn();

vi.mock('./ipc', () => ({
  safeInvoke: (...args: unknown[]) => invokeMock(...(args as [string, unknown])),
}));

import { renameTagGlobally } from './fileSystem';

const noteInFolder: NoteFile = {
  name: 'roadmap.md',
  path: 'notes/Projects/roadmap.md',
  isDaily: false,
  isWeekly: false,
  isLocked: false,
  folderPath: 'Projects',
};

const rootNote: NoteFile = {
  name: 'roadmap.md',
  path: 'notes/roadmap.md',
  isDaily: false,
  isWeekly: false,
  isLocked: false,
};

const dailyNote: NoteFile = {
  name: '2026-07-26.md',
  path: 'daily/2026-07-26.md',
  isDaily: true,
  isWeekly: false,
  isLocked: false,
  date: '2026-07-26',
};

function mockVault(notes: NoteFile[], bodies: Record<string, string>) {
  invokeMock.mockImplementation(async (command: string, args: Record<string, unknown>) => {
    if (command === 'list_notes') return notes;
    if (command === 'read_note') {
      const filename = args.filename as string;
      if (!(filename in bodies)) throw new Error(`no such note: ${filename}`);
      return { content: bodies[filename], color: null, contentHash: `h-${filename}` };
    }
    if (command === 'write_note') return { contentHash: 'h-new', conflictCopy: null };
    return undefined;
  });
}

function writeCalls() {
  return invokeMock.mock.calls
    .filter((c) => c[0] === 'write_note')
    .map((c) => c[1] as Record<string, unknown>);
}

beforeEach(() => {
  invokeMock.mockReset();
});

describe('renameTagGlobally addressing', () => {
  it('reads and writes a note inside a folder by its notes/-relative path', async () => {
    mockVault([noteInFolder], { 'Projects/roadmap.md': 'plan #old ship it' });

    const updated = await renameTagGlobally('old', 'new');

    expect(updated).toBe(1);
    const writes = writeCalls();
    expect(writes).toHaveLength(1);
    expect(writes[0].filename).toBe('Projects/roadmap.md');
    expect(writes[0].content).toBe('plan #new ship it');
  });

  it('never rewrites a root note that only shares the basename', async () => {
    mockVault([noteInFolder, rootNote], {
      'Projects/roadmap.md': 'plan #old',
      'roadmap.md': 'unrelated note, no tags',
    });

    const updated = await renameTagGlobally('old', 'new');

    expect(updated).toBe(1);
    expect(writeCalls().map((w) => w.filename)).toEqual(['Projects/roadmap.md']);
  });

  it('still addresses daily notes by bare filename', async () => {
    mockVault([dailyNote], { '2026-07-26.md': 'standup #old' });

    await renameTagGlobally('old', 'new');

    const writes = writeCalls();
    expect(writes[0].filename).toBe('2026-07-26.md');
    expect(writes[0].isDaily).toBe(true);
  });
});

/** Conflict-registry tests for read bases, successful writes, and lock transitions. */

import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * External-edit conflict safety: verifies that the content hash returned by
 * `read_note` is threaded through to `write_note` as `baseHash`, and that a
 * successful save replaces the stored base with the hash of what was written.
 */

const invokeMock = vi.fn();

vi.mock('./ipc', () => ({
  safeInvoke: (...args: unknown[]) => invokeMock(...(args as [string, unknown])),
}));

import {
  deleteNote,
  getLastPersistedMarkdown,
  lockNote,
  LockedNoteWriteError,
  moveNote,
  readNote,
  readNoteWithMeta,
  renameNote,
  trashNote,
  writeNote,
  type NoteWriteResult,
} from './fileSystem';

function lastCallArgs(command: string): Record<string, unknown> {
  const call = [...invokeMock.mock.calls].reverse().find((c) => c[0] === command);
  if (!call) {
    throw new Error(`expected an invoke of ${command}`);
  }
  return call[1] as Record<string, unknown>;
}

beforeEach(() => {
  invokeMock.mockReset();
});

describe('external-edit conflict hash threading', () => {
  it('sends null baseHash when the note was never read', async () => {
    invokeMock.mockResolvedValue({ contentHash: 'hash-w1', conflictCopy: null });

    await writeNote('never-read.md', 'content', false, false);

    expect(lastCallArgs('write_note').baseHash).toBeNull();
  });

  it('threads the hash from read_note into the next write_note', async () => {
    invokeMock.mockImplementation(async (command: string) => {
      if (command === 'read_note') {
        return { content: 'body', color: null, contentHash: 'hash-r1' };
      }
      return { contentHash: 'hash-w1', conflictCopy: null };
    });

    await readNote('threaded.md', false, false);
    await writeNote('threaded.md', 'edited body', false, false);

    const args = lastCallArgs('write_note');
    expect(args.baseHash).toBe('hash-r1');
    expect(args.filename).toBe('threaded.md');
  });

  it('updates the stored base to the hash returned by a successful write', async () => {
    invokeMock.mockImplementation(async (command: string) => {
      if (command === 'read_note') {
        return { content: 'body', color: null, contentHash: 'hash-r1' };
      }
      return { contentHash: 'hash-w1', conflictCopy: null };
    });

    await readNote('rebased.md', false, false);
    await writeNote('rebased.md', 'first edit', false, false);
    await writeNote('rebased.md', 'second edit', false, false);

    expect(lastCallArgs('write_note').baseHash).toBe('hash-w1');
  });

  it('keys hashes by note kind, not just filename', async () => {
    invokeMock.mockImplementation(async (command: string) => {
      if (command === 'read_note') {
        return { content: 'body', color: null, contentHash: 'hash-daily' };
      }
      return { contentHash: 'hash-w1', conflictCopy: null };
    });

    // Read the daily note, then write a standalone note with the same name:
    // the daily hash must not leak across.
    await readNote('2026-07-12.md', true, false);
    await writeNote('2026-07-12.md', 'content', false, false);

    expect(lastCallArgs('write_note').baseHash).toBeNull();
  });

  it('records the hash from readNoteWithMeta too', async () => {
    invokeMock.mockImplementation(async (command: string) => {
      if (command === 'read_note') {
        return { content: 'body', color: 'blue', contentHash: 'hash-meta' };
      }
      return { contentHash: 'hash-w1', conflictCopy: null };
    });

    const meta = await readNoteWithMeta('meta.md', false, false);
    expect(meta.contentHash).toBe('hash-meta');

    await writeNote('meta.md', 'edited', false, false);
    expect(lastCallArgs('write_note').baseHash).toBe('hash-meta');
  });

  it('tracks the last persisted Markdown after reads and writes', async () => {
    invokeMock.mockImplementation(async (command: string) => {
      if (command === 'read_note') {
        return { content: 'disk body', color: null, contentHash: 'hash-disk' };
      }
      return { contentHash: 'hash-written', conflictCopy: null };
    });

    await readNote('persisted.md', false, false);
    expect(getLastPersistedMarkdown('persisted.md', false, false)).toBe('disk body');

    await writeNote('persisted.md', 'saved body', false, false);
    expect(getLastPersistedMarkdown('persisted.md', false, false)).toBe('saved body');
  });

  it('passes the last-read hash for guarded deletes and forgets it only on success', async () => {
    invokeMock.mockImplementation(async (command: string) => {
      if (command === 'read_note') {
        return { content: 'body', color: null, contentHash: 'delete-base' };
      }
      return undefined;
    });

    await readNote('guarded-delete.md', true, false);
    await deleteNote('guarded-delete.md', true, false, { guarded: true });

    expect(lastCallArgs('delete_note').baseHash).toBe('delete-base');
    expect(getLastPersistedMarkdown('guarded-delete.md', true, false)).toBeUndefined();
  });

  it('keeps persisted bookkeeping when a guarded delete is refused', async () => {
    invokeMock.mockImplementation(async (command: string) => {
      if (command === 'read_note') {
        return { content: 'body', color: null, contentHash: 'refused-base' };
      }
      if (command === 'delete_note') throw new Error('changed on disk');
      return undefined;
    });

    await readNote('refused-delete.md', false, true);
    await expect(deleteNote('refused-delete.md', false, true, { guarded: true })).rejects.toThrow(
      'changed on disk'
    );
    expect(getLastPersistedMarkdown('refused-delete.md', false, true)).toBe('body');
  });

  it('surfaces the conflict copy returned by the backend', async () => {
    invokeMock.mockResolvedValue({
      contentHash: 'hash-w1',
      conflictCopy: 'Projects/note (conflict 2026-07-12 1015).md',
    });

    const result = await writeNote('Projects/note.md', 'mine', false, false);
    expect(result.conflictCopy).toBe('Projects/note (conflict 2026-07-12 1015).md');
    expect(result.contentHash).toBe('hash-w1');
  });

  it('serializes same-note writes and only publishes the newest generation as the baseline', async () => {
    let resolveFirst!: (result: NoteWriteResult) => void;
    let resolveSecond!: (result: NoteWriteResult) => void;
    let writeCount = 0;
    invokeMock.mockImplementation((command: string) => {
      if (command === 'read_note') {
        return Promise.resolve({ content: 'disk base', color: null, contentHash: 'hash-r1' });
      }
      if (command === 'write_note') {
        writeCount += 1;
        return new Promise<NoteWriteResult>((resolve) => {
          if (writeCount === 1) resolveFirst = resolve;
          else resolveSecond = resolve;
        });
      }
      return Promise.resolve(undefined);
    });
    await readNote('serialized.md', false, false);

    const first = writeNote('serialized.md', 'older edit', false, false);
    const second = writeNote('serialized.md', 'newest edit', false, false);
    await Promise.resolve();
    const writesStartedBeforeFirstSettled = writeCount;

    resolveFirst({ contentHash: 'hash-w1', conflictCopy: null });
    await first;
    for (let i = 0; i < 10 && !resolveSecond; i += 1) await Promise.resolve();
    const baselineAfterOlderCompletion = getLastPersistedMarkdown('serialized.md', false, false);
    const writeCalls = invokeMock.mock.calls.filter(([command]) => command === 'write_note');
    const secondWriteArgs = writeCalls[writeCalls.length - 1][1] as Record<string, unknown>;
    resolveSecond({ contentHash: 'hash-w2', conflictCopy: null });
    await second;

    expect(writesStartedBeforeFirstSettled).toBe(1);
    expect(secondWriteArgs.baseHash).toBe('hash-w1');
    expect(baselineAfterOlderCompletion).toBe('disk base');
    expect(getLastPersistedMarkdown('serialized.md', false, false)).toBe('newest edit');
  });

  it('drains an in-flight write before deleting the same note', async () => {
    let finishWrite!: () => void;
    const commands: string[] = [];
    invokeMock.mockImplementation((command: string) => {
      commands.push(command);
      if (command === 'write_note') {
        return new Promise<NoteWriteResult>((resolve) => {
          finishWrite = () => resolve({ contentHash: 'saved-before-delete', conflictCopy: null });
        });
      }
      return Promise.resolve(undefined);
    });

    const save = writeNote('delete-race.md', 'latest body', false, false);
    const deletion = deleteNote('delete-race.md', false, false);
    await Promise.resolve();
    const commandsBeforeSaveSettled = [...commands];

    finishWrite();
    await Promise.all([save, deletion]);

    expect(commandsBeforeSaveSettled).toEqual(['write_note']);
    expect(commands).toEqual(['write_note', 'delete_note']);
  });

  it('preserves the conflict baseline under a moved note path', async () => {
    invokeMock.mockImplementation(async (command: string) => {
      if (command === 'read_note') {
        return { content: 'disk body', color: null, contentHash: 'move-base' };
      }
      if (command === 'move_note') return 'notes/Projects/moved.md';
      return { contentHash: 'move-write', conflictCopy: null };
    });

    await readNote('moved.md', false, false);
    await moveNote('moved.md', 'Projects');
    await writeNote('Projects/moved.md', 'edited after move', false, false);

    expect(lastCallArgs('write_note').baseHash).toBe('move-base');
    expect(getLastPersistedMarkdown('moved.md', false, false)).toBeUndefined();
    expect(getLastPersistedMarkdown('Projects/moved.md', false, false)).toBe('edited after move');
  });

  it('drains an in-flight write before moving the note', async () => {
    let finishWrite!: () => void;
    const commands: string[] = [];
    invokeMock.mockImplementation((command: string) => {
      commands.push(command);
      if (command === 'write_note') {
        return new Promise<NoteWriteResult>((resolve) => {
          finishWrite = () => resolve({ contentHash: 'saved-before-move', conflictCopy: null });
        });
      }
      if (command === 'move_note') return Promise.resolve('notes/Projects/move-race.md');
      return Promise.resolve(undefined);
    });

    const save = writeNote('move-race.md', 'latest body', false, false);
    const move = moveNote('move-race.md', 'Projects');
    await Promise.resolve();

    expect(commands).toEqual(['write_note']);
    finishWrite();
    await Promise.all([save, move]);

    expect(commands).toEqual(['write_note', 'move_note']);
  });

  it('rejects a write that starts while the note is moving', async () => {
    let finishMove!: () => void;
    invokeMock.mockImplementation((command: string) => {
      if (command === 'move_note') {
        return new Promise<string>((resolve) => {
          finishMove = () => resolve('notes/Projects/move-race.md');
        });
      }
      return Promise.resolve({ contentHash: 'unexpected-write', conflictCopy: null });
    });

    const move = moveNote('move-race.md', 'Projects');
    await Promise.resolve();

    await expect(writeNote('move-race.md', 'late edit', false, false)).rejects.toThrow(
      LockedNoteWriteError
    );
    finishMove();
    await move;
    expect(invokeMock).toHaveBeenCalledTimes(1);
  });

  it('clears a stale destination baseline when the source has none', async () => {
    invokeMock.mockImplementation(async (command: string) => {
      if (command === 'read_note') {
        return { content: 'stale destination', color: null, contentHash: 'stale-base' };
      }
      if (command === 'move_note') return 'notes/Projects/moved.md';
      return { contentHash: 'move-write', conflictCopy: null };
    });

    await readNote('Projects/moved.md', false, false);
    await moveNote('moved.md', 'Projects');
    await writeNote('Projects/moved.md', 'edited after move', false, false);

    expect(lastCallArgs('write_note').baseHash).toBeNull();
  });

  it('drains an in-flight write before trashing the note', async () => {
    let finishWrite!: () => void;
    const commands: string[] = [];
    invokeMock.mockImplementation((command: string) => {
      commands.push(command);
      if (command === 'write_note') {
        return new Promise<NoteWriteResult>((resolve) => {
          finishWrite = () => resolve({ contentHash: 'saved-before-trash', conflictCopy: null });
        });
      }
      return Promise.resolve(undefined);
    });

    const save = writeNote('trash-race.md', 'latest body', false, false);
    const trash = trashNote('trash-race.md', false, false);
    await Promise.resolve();

    expect(commands).toEqual(['write_note']);
    finishWrite();
    await Promise.all([save, trash]);

    expect(commands).toEqual(['write_note', 'trash_note']);
  });

  it('allows saving again when trashing the note fails', async () => {
    invokeMock.mockImplementation(async (command: string) => {
      if (command === 'trash_note') throw new Error('trash unavailable');
      if (command === 'write_note') {
        return { contentHash: 'saved-after-trash-failure', conflictCopy: null };
      }
      return undefined;
    });

    await expect(trashNote('failed-trash.md', false, false)).rejects.toThrow('trash unavailable');
    await expect(writeNote('failed-trash.md', 'still editable', false, false)).resolves.toEqual({
      contentHash: 'saved-after-trash-failure',
      conflictCopy: null,
    });
  });
});

describe('locked-note write safety', () => {
  it('invalidates the read hash and rejects a stale save after locking', async () => {
    invokeMock.mockImplementation(async (command: string) => {
      if (command === 'read_note') {
        return { content: 'body', color: null, contentHash: 'hash-before-lock' };
      }
      if (command === 'write_note') {
        return { contentHash: 'unexpected-write', conflictCopy: null };
      }
      return undefined;
    });

    await readNote('secret.md', false, false);
    await lockNote('secret.md', 'password', false, false);

    await expect(writeNote('secret.md', 'stale autosave', false, false)).rejects.toThrow(
      'Note is locked'
    );
    expect(invokeMock.mock.calls.filter(([command]) => command === 'write_note')).toHaveLength(0);
  });

  it('drains an in-flight save before encrypting the note', async () => {
    let finishWrite!: () => void;
    invokeMock.mockImplementation((command: string) => {
      if (command === 'write_note') {
        return new Promise<NoteWriteResult>((resolve) => {
          finishWrite = () => resolve({ contentHash: 'saved-before-lock', conflictCopy: null });
        });
      }
      return Promise.resolve(undefined);
    });

    const save = writeNote('pending.md', 'latest content', false, false);
    const lock = lockNote('pending.md', 'password', false, false);
    await Promise.resolve();

    expect(invokeMock.mock.calls.some(([command]) => command === 'lock_note')).toBe(false);
    finishWrite();
    await Promise.all([save, lock]);

    expect(invokeMock.mock.calls.map(([command]) => command)).toEqual(['write_note', 'lock_note']);
  });
});

describe('renameNote IPC', () => {
  it('passes the exact rename_note argument shape to Tauri', async () => {
    invokeMock.mockResolvedValue(undefined);

    await renameNote('Old title.md', 'New title.md', false, false);

    expect(invokeMock).toHaveBeenCalledWith('rename_note', {
      oldFilename: 'Old title.md',
      newFilename: 'New title.md',
      isDaily: false,
      isWeekly: false,
    });
  });

  it('propagates rename errors from the backend', async () => {
    invokeMock.mockRejectedValue(new Error('A note with this name already exists'));

    await expect(renameNote('Old title.md', 'Existing title.md', false, false)).rejects.toThrow(
      'A note with this name already exists'
    );
  });
});

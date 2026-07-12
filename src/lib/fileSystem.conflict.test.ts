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

import { readNote, readNoteWithMeta, writeNote } from './fileSystem';

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

  it('surfaces the conflict copy returned by the backend', async () => {
    invokeMock.mockResolvedValue({
      contentHash: 'hash-w1',
      conflictCopy: 'Projects/note (conflict 2026-07-12 1015).md',
    });

    const result = await writeNote('Projects/note.md', 'mine', false, false);
    expect(result.conflictCopy).toBe('Projects/note (conflict 2026-07-12 1015).md');
    expect(result.contentHash).toBe('hash-w1');
  });
});

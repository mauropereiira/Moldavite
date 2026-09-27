import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const invokeMock = vi.fn();

vi.mock('@/lib/ipc', () => ({
  safeInvoke: (...args: unknown[]) => invokeMock(...args),
}));

import { useBacklinks } from './useBacklinks';

beforeEach(() => {
  vi.useFakeTimers();
  invokeMock.mockReset();
  invokeMock.mockImplementation(async (_command: string, args: { filename: string }) => [
    {
      fromPath: `notes/into-${args.filename}`,
      fromNote: `into-${args.filename}`,
      fromTitle: 'Source',
      context: '',
    },
  ]);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('useBacklinks', () => {
  it("drops the previous note's backlinks as soon as the note changes", async () => {
    const { result, rerender } = renderHook(({ filename }) => useBacklinks(filename), {
      initialProps: { filename: 'a.md' },
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });
    expect(result.current.backlinks.map((b) => b.fromNote)).toEqual(['into-a.md']);

    rerender({ filename: 'b.md' });

    expect(result.current.backlinks).toEqual([]);
    expect(result.current.loading).toBe(true);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });
    expect(result.current.backlinks.map((b) => b.fromNote)).toEqual(['into-b.md']);
    expect(result.current.loading).toBe(false);
  });

  it('keeps showing backlinks while a save refresh is pending', async () => {
    const { result, rerender } = renderHook(({ refreshKey }) => useBacklinks('a.md', refreshKey), {
      initialProps: { refreshKey: 0 },
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });

    rerender({ refreshKey: 1 });

    expect(result.current.backlinks.map((b) => b.fromNote)).toEqual(['into-a.md']);
  });
});

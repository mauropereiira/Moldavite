import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { whenMainThreadSettles } from './settle';

describe('whenMainThreadSettles', () => {
  let clock = 0;
  let visible = true;
  const options = { now: () => clock, isVisible: () => visible };

  beforeEach(() => {
    vi.useFakeTimers();
    clock = 0;
    visible = true;
  });
  afterEach(() => vi.useRealTimers());

  async function tick(lagMs = 0) {
    clock += 1_000 + lagMs;
    await vi.advanceTimersByTimeAsync(1_000);
  }

  it('resolves after five on-time visible seconds', async () => {
    const settled = vi.fn();
    void whenMainThreadSettles(options).then(settled);
    for (let i = 0; i < 4; i += 1) await tick();
    expect(settled).not.toHaveBeenCalled();
    await tick();
    expect(settled).toHaveBeenCalledOnce();
  });

  it('starts counting again after a stall, as when a plugin floods the main thread', async () => {
    const settled = vi.fn();
    void whenMainThreadSettles(options).then(settled);
    for (let i = 0; i < 4; i += 1) await tick();
    await tick(3_000);
    for (let i = 0; i < 4; i += 1) await tick();
    expect(settled).not.toHaveBeenCalled();
    await tick();
    expect(settled).toHaveBeenCalledOnce();
  });

  it('does not count time while the window is hidden', async () => {
    const settled = vi.fn();
    void whenMainThreadSettles(options).then(settled);
    visible = false;
    for (let i = 0; i < 20; i += 1) await tick();
    expect(settled).not.toHaveBeenCalled();
    visible = true;
    for (let i = 0; i < 5; i += 1) await tick();
    expect(settled).toHaveBeenCalledOnce();
  });
});

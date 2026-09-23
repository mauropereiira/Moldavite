import { describe, expect, it, vi } from 'vitest';
import {
  acquireAutosavePathChange,
  flushAutosaveWhenHidden,
  registerAutosaveCloseGuard,
  registerAutosaveFlush,
  registerAutosavePendingProbe,
} from './autosaveFlush';

function closeWindow() {
  type CloseHandler = (event: { preventDefault: () => void }) => void | Promise<void>;
  let handler: CloseHandler | undefined;
  const destroy = vi.fn(async () => {});
  return {
    window: {
      onCloseRequested: vi.fn(async (next: CloseHandler) => {
        handler = next;
        return () => {};
      }),
      destroy,
    },
    destroy,
    requestClose: async () => {
      const preventDefault = vi.fn();
      await handler?.({ preventDefault });
      return preventDefault;
    },
  };
}

describe('autosave close guard', () => {
  it('waits for path changes before flushing and closing', async () => {
    const releasePathChange = await acquireAutosavePathChange();
    const flush = vi.fn(async () => {});
    const unregisterFlush = registerAutosaveFlush(flush);
    const unregisterProbe = registerAutosavePendingProbe(() => null);
    const native = closeWindow();
    await registerAutosaveCloseGuard(native.window);

    const close = native.requestClose();
    await Promise.resolve();
    expect(flush).not.toHaveBeenCalled();
    expect(native.destroy).not.toHaveBeenCalled();

    releasePathChange();
    const preventDefault = await close;

    expect(preventDefault).toHaveBeenCalledOnce();
    expect(flush).toHaveBeenCalledOnce();
    expect(native.destroy).toHaveBeenCalledOnce();
    unregisterFlush();
    unregisterProbe();
  });

  it('waits for structural work queued while close is already pending', async () => {
    const releaseFirst = await acquireAutosavePathChange();
    const flush = vi.fn(async () => {});
    const unregisterFlush = registerAutosaveFlush(flush);
    const unregisterProbe = registerAutosavePendingProbe(() => null);
    const native = closeWindow();
    await registerAutosaveCloseGuard(native.window);

    const close = native.requestClose();
    const secondPathChange = acquireAutosavePathChange();
    releaseFirst();
    const releaseSecond = await secondPathChange;
    await Promise.resolve();
    expect(native.destroy).not.toHaveBeenCalled();

    releaseSecond();
    await close;

    expect(flush).toHaveBeenCalledTimes(2);
    expect(native.destroy).toHaveBeenCalledOnce();
    unregisterFlush();
    unregisterProbe();
  });

  it('keeps the window open when a write remains pending', async () => {
    const unregisterFlush = registerAutosaveFlush(async () => {});
    const unregisterProbe = registerAutosavePendingProbe(() => 'notes/unsaved.md');
    const native = closeWindow();
    await registerAutosaveCloseGuard(native.window);

    const preventDefault = await native.requestClose();

    expect(preventDefault).toHaveBeenCalledOnce();
    expect(native.destroy).not.toHaveBeenCalled();
    unregisterFlush();
    unregisterProbe();
  });
});

describe('autosave flush when the page is hidden', () => {
  it('settles owed writes on visibilitychange to hidden and on pagehide', async () => {
    const flush = vi.fn(async () => {});
    const unregisterFlush = registerAutosaveFlush(flush);
    const stop = flushAutosaveWhenHidden();
    const visibility = vi.spyOn(document, 'visibilityState', 'get');

    visibility.mockReturnValue('visible');
    document.dispatchEvent(new Event('visibilitychange'));
    expect(flush).not.toHaveBeenCalled();

    visibility.mockReturnValue('hidden');
    document.dispatchEvent(new Event('visibilitychange'));
    expect(flush).toHaveBeenCalledTimes(1);

    window.dispatchEvent(new Event('pagehide'));
    expect(flush).toHaveBeenCalledTimes(2);

    stop();
    window.dispatchEvent(new Event('pagehide'));
    expect(flush).toHaveBeenCalledTimes(2);
    visibility.mockRestore();
    unregisterFlush();
  });
});

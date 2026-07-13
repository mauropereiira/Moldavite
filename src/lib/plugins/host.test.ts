import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { safeInvoke } from '@/lib/ipc';
import { usePluginStore } from '@/stores/pluginStore';
import { usePluginCommandStore } from '@/stores/pluginCommandStore';

vi.mock('@/lib/ipc', () => ({ safeInvoke: vi.fn() }));

const workerHarness = vi.hoisted(() => {
  type WorkerEvent = MessageEvent | { message?: string };
  class MockWorker {
    static instances: MockWorker[] = [];
    listeners = new Map<string, Array<(event: WorkerEvent) => void>>();
    postMessage = vi.fn();
    terminate = vi.fn();

    constructor() {
      MockWorker.instances.push(this);
    }

    addEventListener(type: string, listener: (event: WorkerEvent) => void) {
      const listeners = this.listeners.get(type) ?? [];
      listeners.push(listener);
      this.listeners.set(type, listeners);
    }

    emit(type: string, event: WorkerEvent) {
      for (const listener of this.listeners.get(type) ?? []) listener(event);
    }
  }
  return { MockWorker };
});

vi.mock('./pluginWorker.ts?worker', () => ({ default: workerHarness.MockWorker }));
vi.mock('@tauri-apps/api/app', () => ({ getVersion: vi.fn().mockResolvedValue('1.6.0') }));

import { loadEnabledPlugins, unloadPlugin } from './host';

const mockInvoke = vi.mocked(safeInvoke);
const plugin = {
  id: 'crashy',
  manifestRaw: {
    id: 'crashy',
    name: 'Crashy',
    version: '1.0.0',
    apiVersion: 1,
    permissions: ['commands'],
  },
  readError: null,
  contentHash: 'hash',
};

async function loadCommand() {
  await loadEnabledPlugins();
  const worker = workerHarness.MockWorker.instances[workerHarness.MockWorker.instances.length - 1];
  if (!worker) throw new Error('plugin worker was not created');
  worker.emit(
    'message',
    new MessageEvent('message', {
      data: { kind: 'commandRegistered', localId: 'run', label: 'Run' },
    })
  );
  return worker;
}

describe('plugin worker invocation lifecycle', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    workerHarness.MockWorker.instances.length = 0;
    usePluginCommandStore.getState().clear();
    usePluginStore.setState({ grants: {} });
    usePluginStore.getState().grant('crashy', '1.0.0', 'hash');
    mockInvoke.mockResolvedValue([plugin]);
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, text: vi.fn().mockResolvedValue('plugin code') })
    );
  });

  afterEach(() => {
    unloadPlugin('crashy');
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('rejects a pending invocation and removes commands when the worker crashes', async () => {
    const worker = await loadCommand();
    const command = usePluginCommandStore.getState().commands[0];
    const pending = command.handler() as Promise<void>;
    const rejected = expect(pending).rejects.toThrow('plugin worker crashed: boom');
    worker.emit('error', { message: 'boom' });
    await rejected;
    expect(worker.terminate).toHaveBeenCalledOnce();
    expect(usePluginCommandStore.getState().commands).toEqual([]);
  });

  it('times out a worker that never responds and clears the pending invocation', async () => {
    const worker = await loadCommand();
    const command = usePluginCommandStore.getState().commands[0];
    const first = command.handler() as Promise<void>;
    const timedOut = expect(first).rejects.toThrow('plugin command timed out');
    await vi.advanceTimersByTimeAsync(30_000);
    await timedOut;

    const second = command.handler() as Promise<void>;
    const invoke = worker.postMessage.mock.calls[worker.postMessage.mock.calls.length - 1]?.[0] as { invocationId: number };
    worker.emit(
      'message',
      new MessageEvent('message', {
        data: { kind: 'invokeResult', invocationId: invoke.invocationId, ok: true },
      })
    );
    await expect(second).resolves.toBeUndefined();
  });
});

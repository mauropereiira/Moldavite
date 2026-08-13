/** Worker-host lifecycle and untrusted-message routing regression coverage. */

import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { convertFileSrc } from '@tauri-apps/api/core';
import { safeInvoke } from '@/lib/ipc';
import { usePluginStore } from '@/stores/pluginStore';
import { usePluginCommandStore } from '@/stores/pluginCommandStore';

vi.mock('@/lib/ipc', () => ({ safeInvoke: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ convertFileSrc: vi.fn() }));

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
const mockConvertFileSrc = vi.mocked(convertFileSrc);
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

type LoadedWorker = InstanceType<typeof workerHarness.MockWorker>;

async function loadWorker(): Promise<LoadedWorker> {
  await loadEnabledPlugins();
  const worker = workerHarness.MockWorker.instances[workerHarness.MockWorker.instances.length - 1];
  if (!worker) throw new Error('plugin worker was not created');
  return worker;
}

function postFromWorker(worker: LoadedWorker, data: unknown) {
  worker.emit('message', new MessageEvent('message', { data }));
}

async function loadCommand() {
  const worker = await loadWorker();
  postFromWorker(worker, { kind: 'commandRegistered', localId: 'run', label: 'Run' });
  return worker;
}

function useGrantedPluginHarness() {
  beforeEach(() => {
    vi.useFakeTimers();
    workerHarness.MockWorker.instances.length = 0;
    usePluginCommandStore.getState().clear();
    usePluginStore.setState({ grants: {} });
    usePluginStore.getState().grant('crashy', '1.0.0', 'hash');
    mockInvoke.mockResolvedValue([plugin]);
    mockConvertFileSrc.mockReset();
    mockConvertFileSrc.mockReturnValue('http://plugin.localhost/');
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
}

describe('plugin source loading', () => {
  useGrantedPluginHarness();

  it("uses Tauri's Windows custom-protocol URL", async () => {
    await loadWorker();
    expect(mockConvertFileSrc).toHaveBeenCalledWith('', 'plugin');
    expect(fetch).toHaveBeenCalledWith('http://plugin.localhost/crashy/plugin.js');
  });
});

describe('plugin worker invocation lifecycle', () => {
  useGrantedPluginHarness();

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
    const invoke = worker.postMessage.mock.calls[worker.postMessage.mock.calls.length - 1]?.[0] as {
      invocationId: number;
    };
    worker.emit(
      'message',
      new MessageEvent('message', {
        data: { kind: 'invokeResult', invocationId: invoke.invocationId, ok: true },
      })
    );
    await expect(second).resolves.toBeUndefined();
  });
});

describe('untrusted commandRegistered messages', () => {
  useGrantedPluginHarness();

  it('accepts a well-formed registration', async () => {
    const worker = await loadWorker();
    postFromWorker(worker, { kind: 'commandRegistered', localId: 'run', label: 'Run' });
    expect(usePluginCommandStore.getState().commands).toMatchObject([
      { pluginId: 'crashy', id: 'crashy:run', label: 'Run' },
    ]);
  });

  it.each([
    ['a non-string label', { localId: 'run', label: 42 }],
    ['a non-string id', { localId: 42, label: 'Run' }],
    ['an object id that would stringify', { localId: { value: 'run' }, label: 'Run' }],
    ['a missing label', { localId: 'run' }],
    ['an empty id', { localId: '', label: 'Run' }],
    ['an empty label', { localId: 'run', label: '' }],
    ['an oversized id', { localId: 'a'.repeat(129), label: 'Run' }],
    ['an oversized label', { localId: 'run', label: 'a'.repeat(201) }],
  ])('drops a registration with %s', async (_name, payload) => {
    const worker = await loadWorker();
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    postFromWorker(worker, { kind: 'commandRegistered', ...payload });
    expect(usePluginCommandStore.getState().commands).toEqual([]);
    expect(consoleError).toHaveBeenCalledOnce();
    consoleError.mockRestore();
  });

  it('caps how many commands one worker can register and warns only once', async () => {
    const worker = await loadWorker();
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    for (let i = 0; i < 200; i += 1) {
      postFromWorker(worker, { kind: 'commandRegistered', localId: `cmd-${i}`, label: `Cmd ${i}` });
    }
    expect(usePluginCommandStore.getState().commands).toHaveLength(50);
    expect(consoleError).toHaveBeenCalledOnce();

    // Re-registering an already-known id replaces its handler rather than
    // counting against the cap, matching the documented commands.add behaviour.
    postFromWorker(worker, { kind: 'commandRegistered', localId: 'cmd-0', label: 'Renamed' });
    expect(usePluginCommandStore.getState().commands).toHaveLength(50);
    expect(
      usePluginCommandStore.getState().commands.find((c) => c.id === 'crashy:cmd-0')?.label
    ).toBe('Renamed');
    consoleError.mockRestore();
  });
});

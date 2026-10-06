import { isMobilePlatform } from '@/lib/platform';
/** Worker-host lifecycle and untrusted-message routing regression coverage. */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { safeInvoke } from '@/lib/ipc';
import { usePluginStore } from '@/stores/pluginStore';
import { usePluginCommandStore } from '@/stores/pluginCommandStore';
import { useToastStore } from '@/stores/toastStore';
import { PLUGINS_RUNNING, usePluginSafeModeStore } from '@/stores/pluginSafeModeStore';

vi.mock('@/lib/platform', () => ({ isMobilePlatform: vi.fn(() => false) }));

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

vi.mock('./pluginWorker.ts?worker&inline', () => ({ default: workerHarness.MockWorker }));
vi.mock('@tauri-apps/api/app', () => ({ getVersion: vi.fn().mockResolvedValue('1.6.0') }));

import {
  listPlugins,
  reconcilePlugins,
  setPluginsPaused,
  startPluginsAtLaunch,
  unloadPlugin,
} from './host';

const mockInvoke = vi.mocked(safeInvoke);
let installed: unknown[] = [];
let safeModeReply: unknown = PLUGINS_RUNNING;

function routeInvoke(command: string, args?: unknown): Promise<unknown> {
  if (command === 'list_plugins') return Promise.resolve(installed);
  if (command === 'begin_plugin_startup' || command === 'plugin_safe_mode_status') {
    return Promise.resolve(safeModeReply);
  }
  if (command === 'set_plugin_safe_mode') {
    const active = (args as { active: boolean }).active;
    return Promise.resolve(
      active ? { active, reason: 'userRequest', pluginIds: [] } : PLUGINS_RUNNING
    );
  }
  return Promise.resolve(undefined);
}

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
  code: 'hashed plugin code',
};

type LoadedWorker = InstanceType<typeof workerHarness.MockWorker>;

async function loadWorker(): Promise<LoadedWorker> {
  await reconcilePlugins();
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
    vi.mocked(isMobilePlatform).mockReturnValue(false);
    mockInvoke.mockClear();
    vi.useFakeTimers();
    workerHarness.MockWorker.instances.length = 0;
    usePluginCommandStore.getState().clear();
    usePluginStore.setState({ grants: {} });
    usePluginStore.getState().grant('crashy', '1.0.0', 'hash');
    usePluginSafeModeStore.setState({ status: PLUGINS_RUNNING });
    installed = [plugin];
    safeModeReply = PLUGINS_RUNNING;
    mockInvoke.mockImplementation(routeInvoke as typeof safeInvoke);
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    unloadPlugin('crashy');
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });
}

describe('plugin source loading', () => {
  useGrantedPluginHarness();

  it('never reads or executes plugins from a mobile Forge, even with desktop consent', async () => {
    vi.mocked(isMobilePlatform).mockReturnValue(true);
    expect(await reconcilePlugins()).toEqual([]);
    expect(await listPlugins()).toEqual([]);
    expect(await startPluginsAtLaunch()).toEqual(PLUGINS_RUNNING);
    expect(mockInvoke).not.toHaveBeenCalled();
    expect(workerHarness.MockWorker.instances).toHaveLength(0);
  });

  it('executes the source returned with the consent hash without refetching it', async () => {
    const worker = await loadWorker();
    expect(worker.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'init', code: 'hashed plugin code' })
    );
    expect(fetch).not.toHaveBeenCalled();
  });

  // Tauri sends the CSP header only with HTML responses, and a worker loaded
  // from its own URL takes its policy from that response, so it gets none and
  // plugin code can `import()` from any origin. A blob worker inherits the page's.
  it('builds every worker inline so it runs under the page CSP', () => {
    const files = Object.keys(import.meta.glob(['/src/**/*.{ts,tsx}', '!**/*.test.{ts,tsx}']));
    const specifiers = files.flatMap(
      (file) =>
        readFileSync(join(process.cwd(), file), 'utf8').match(/['"][^'"]*\?worker[^'"]*['"]/g) ?? []
    );
    expect(specifiers.length).toBeGreaterThan(0);
    for (const specifier of specifiers) expect(specifier).toMatch(/[?&]inline\b/);
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

describe('untrusted message shapes', () => {
  useGrantedPluginHarness();

  it('answers a well-formed call and ignores one with no usable request id', async () => {
    const worker = await loadWorker();
    worker.postMessage.mockClear();

    postFromWorker(worker, { kind: 'call', requestId: '1', method: 'ui.toast', args: ['hi'] });
    postFromWorker(worker, { kind: 'call', requestId: 1, method: 7, args: [] });
    await vi.advanceTimersByTimeAsync(0);
    expect(worker.postMessage).not.toHaveBeenCalled();

    postFromWorker(worker, { kind: 'call', requestId: 2, method: 'ui.toast', args: ['hi'] });
    await vi.advanceTimersByTimeAsync(0);
    expect(worker.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'callResult', requestId: 2, ok: false })
    );
  });

  it('rejects a call whose args are not an array instead of indexing into them', async () => {
    installed = [
      { ...plugin, manifestRaw: { ...plugin.manifestRaw, permissions: ['commands', 'ui'] } },
    ];
    const worker = await loadWorker();
    useToastStore.setState({ toasts: [] });
    worker.postMessage.mockClear();

    postFromWorker(worker, { kind: 'call', requestId: 3, method: 'ui.toast', args: 'boom' });
    await vi.advanceTimersByTimeAsync(0);
    expect(worker.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'callResult', requestId: 3, ok: false })
    );
    expect(useToastStore.getState().toasts).toHaveLength(0);
  });

  it('drops a log message whose args are not an array', async () => {
    const worker = await loadWorker();
    const rejection = vi.fn();
    process.on('unhandledRejection', rejection);
    try {
      postFromWorker(worker, { kind: 'log', level: 'log', args: 5 });
      await vi.advanceTimersByTimeAsync(0);
      await Promise.resolve();
    } finally {
      process.off('unhandledRejection', rejection);
    }
    expect(rejection).not.toHaveBeenCalled();
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

  it('drops a registration when the manifest omitted the commands permission', async () => {
    installed = [{ ...plugin, manifestRaw: { ...plugin.manifestRaw, permissions: [] } }];
    const worker = await loadWorker();
    postFromWorker(worker, {
      kind: 'commandRegistered',
      localId: 'verify',
      label: 'Verify password',
    });
    expect(usePluginCommandStore.getState().commands).toEqual([]);
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

describe('overlapping plugin reloads', () => {
  useGrantedPluginHarness();

  it('leaves no orphaned worker running when two reloads overlap', async () => {
    await Promise.all([reconcilePlugins(), reconcilePlugins()]);

    unloadPlugin('crashy');
    for (const worker of workerHarness.MockWorker.instances) {
      expect(worker.terminate).toHaveBeenCalled();
    }
    expect(workerHarness.MockWorker.instances).toHaveLength(1);
  });
});

describe('reconciling running plugins', () => {
  useGrantedPluginHarness();

  it('lists plugins without starting or stopping anything', async () => {
    const infos = await listPlugins();
    expect(infos.map((info) => info.status)).toEqual(['ok']);
    expect(workerHarness.MockWorker.instances).toHaveLength(0);
  });

  it('leaves an unchanged plugin running when another reconcile happens', async () => {
    const worker = await loadWorker();
    await reconcilePlugins();
    expect(worker.terminate).not.toHaveBeenCalled();
    expect(workerHarness.MockWorker.instances).toHaveLength(1);
  });

  it('stops a plugin whose files changed since the grant', async () => {
    const worker = await loadWorker();
    installed = [{ ...plugin, contentHash: 'edited' }];
    await reconcilePlugins();
    expect(worker.terminate).toHaveBeenCalledOnce();
    expect(workerHarness.MockWorker.instances).toHaveLength(1);
  });

  it('stops a plugin that was uninstalled or disabled', async () => {
    const worker = await loadWorker();
    usePluginStore.getState().disable('crashy');
    await reconcilePlugins();
    expect(worker.terminate).toHaveBeenCalledOnce();
  });

  it('does not run a plugin that needs a newer Moldavite', async () => {
    installed = [{ ...plugin, manifestRaw: { ...plugin.manifestRaw, minAppVersion: '99.0.0' } }];
    const [info] = await reconcilePlugins();
    expect(info).toMatchObject({
      status: 'incompatible',
      reason: 'Needs Moldavite 99.0.0 or later',
    });
    expect(workerHarness.MockWorker.instances).toHaveLength(0);
  });
});

describe('starting without plugins', () => {
  useGrantedPluginHarness();

  it('records what is starting before any worker exists, then reports it settled', async () => {
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
    await startPluginsAtLaunch();
    expect(mockInvoke).toHaveBeenCalledWith('begin_plugin_startup', { pluginIds: ['crashy'] });
    expect(workerHarness.MockWorker.instances).toHaveLength(1);
    expect(mockInvoke).not.toHaveBeenCalledWith('finish_plugin_startup');

    await vi.advanceTimersByTimeAsync(5_000);
    expect(mockInvoke).toHaveBeenCalledWith('finish_plugin_startup');
  });

  it('starts nothing when Rust says this launch is in safe mode', async () => {
    safeModeReply = { active: true, reason: 'unfinishedStart', pluginIds: ['crashy'] };
    const status = await startPluginsAtLaunch();
    expect(status).toEqual(safeModeReply);
    expect(usePluginSafeModeStore.getState().status).toEqual(safeModeReply);
    expect(workerHarness.MockWorker.instances).toHaveLength(0);

    await reconcilePlugins();
    expect(workerHarness.MockWorker.instances).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(mockInvoke).not.toHaveBeenCalledWith('finish_plugin_startup');
  });

  it('never arms the marker when no plugin is enabled', async () => {
    usePluginStore.setState({ grants: {} });
    await startPluginsAtLaunch();
    expect(mockInvoke).toHaveBeenCalledWith('begin_plugin_startup', { pluginIds: [] });
    await vi.advanceTimersByTimeAsync(10_000);
    expect(mockInvoke).not.toHaveBeenCalledWith('finish_plugin_startup');
  });

  it('stops every plugin on request and starts them again when resumed', async () => {
    const worker = await loadWorker();
    const paused = await setPluginsPaused(true);
    expect(paused).toMatchObject({ active: true, reason: 'userRequest' });
    expect(worker.terminate).toHaveBeenCalledOnce();
    expect(usePluginCommandStore.getState().commands).toEqual([]);

    await setPluginsPaused(false);
    expect(mockInvoke).toHaveBeenCalledWith('set_plugin_safe_mode', { active: false });
    expect(mockInvoke).toHaveBeenCalledWith('begin_plugin_startup', { pluginIds: ['crashy'] });
    expect(workerHarness.MockWorker.instances).toHaveLength(2);
  });
});

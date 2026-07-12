import { describe, it, expect, vi, beforeEach } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { useSemanticStore, __resetSemanticStoreForTests } from './semanticStore';

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn(),
}));

const mockInvoke = vi.mocked(invoke);
const mockListen = vi.mocked(listen);

/** Handlers captured from `listen`, keyed by event name. */
type Handler = (event: { payload: unknown }) => void;
let handlers: Record<string, Handler>;

function emit(event: string, payload: unknown) {
  handlers[event]({ payload });
}

const disabledStatus = {
  enabled: false,
  modelReady: false,
  indexedCount: 0,
  state: 'disabled',
  error: null,
};

describe('semanticStore', () => {
  beforeEach(() => {
    __resetSemanticStoreForTests();
    handlers = {};
    mockListen.mockReset();
    // Capture event handlers so tests can simulate backend events.
    mockListen.mockImplementation(async (event, handler) => {
      handlers[event as string] = handler as Handler;
      return () => {};
    });
    mockInvoke.mockReset();
    mockInvoke.mockImplementation(async (cmd) => {
      if (cmd === 'semantic_status') return disabledStatus;
      return undefined;
    });
  });

  it('initialize fetches status and subscribes to the three events', async () => {
    await useSemanticStore.getState().initialize();
    expect(mockInvoke).toHaveBeenCalledWith('semantic_status', undefined);
    expect(Object.keys(handlers).sort()).toEqual([
      'semantic:error',
      'semantic:progress',
      'semantic:ready',
    ]);
    expect(useSemanticStore.getState().state).toBe('disabled');
  });

  it('initialize is idempotent', async () => {
    await useSemanticStore.getState().initialize();
    await useSemanticStore.getState().initialize();
    expect(mockListen).toHaveBeenCalledTimes(3);
  });

  it('mirrors an enabled/ready backend status', async () => {
    mockInvoke.mockImplementation(async (cmd) => {
      if (cmd === 'semantic_status') {
        return {
          enabled: true,
          modelReady: true,
          indexedCount: 128,
          state: 'ready',
          error: null,
        };
      }
      return undefined;
    });
    await useSemanticStore.getState().initialize();
    const s = useSemanticStore.getState();
    expect(s.enabled).toBe(true);
    expect(s.state).toBe('ready');
    expect(s.indexedCount).toBe(128);
  });

  it('progress events drive downloading → indexing with live counts', async () => {
    await useSemanticStore.getState().initialize();

    emit('semantic:progress', { phase: 'downloading', done: 0, total: 0 });
    expect(useSemanticStore.getState().state).toBe('downloading');

    emit('semantic:progress', { phase: 'indexing', done: 5, total: 40 });
    const s = useSemanticStore.getState();
    expect(s.state).toBe('indexing');
    expect(s.progress).toEqual({ phase: 'indexing', done: 5, total: 40 });
  });

  it('ready event finalizes state and clears progress', async () => {
    await useSemanticStore.getState().initialize();
    emit('semantic:progress', { phase: 'indexing', done: 40, total: 40 });
    emit('semantic:ready', { indexedCount: 40 });
    const s = useSemanticStore.getState();
    expect(s.state).toBe('ready');
    expect(s.indexedCount).toBe(40);
    expect(s.modelReady).toBe(true);
    expect(s.progress).toBeNull();
  });

  it('error event surfaces the message', async () => {
    await useSemanticStore.getState().initialize();
    emit('semantic:error', { error: 'download failed' });
    const s = useSemanticStore.getState();
    expect(s.state).toBe('error');
    expect(s.error).toBe('download failed');
  });

  it('setEnabled(true) invokes the backend and enters downloading first', async () => {
    await useSemanticStore.getState().initialize();
    await useSemanticStore.getState().setEnabled(true);
    expect(mockInvoke).toHaveBeenCalledWith('semantic_set_enabled', { enabled: true });
    const s = useSemanticStore.getState();
    expect(s.enabled).toBe(true);
    expect(s.state).toBe('downloading'); // model not cached yet
  });

  it('setEnabled(true) skips to indexing when the model is already cached', async () => {
    await useSemanticStore.getState().initialize();
    useSemanticStore.setState({ modelReady: true });
    await useSemanticStore.getState().setEnabled(true);
    expect(useSemanticStore.getState().state).toBe('indexing');
  });

  it('setEnabled(false) disables and clears transient state', async () => {
    await useSemanticStore.getState().initialize();
    emit('semantic:error', { error: 'boom' });
    await useSemanticStore.getState().setEnabled(false);
    expect(mockInvoke).toHaveBeenCalledWith('semantic_set_enabled', { enabled: false });
    const s = useSemanticStore.getState();
    expect(s.enabled).toBe(false);
    expect(s.state).toBe('disabled');
    expect(s.error).toBeNull();
  });

  it('rebuildIndex invokes semantic_reindex and enters indexing', async () => {
    await useSemanticStore.getState().initialize();
    emit('semantic:ready', { indexedCount: 10 });
    await useSemanticStore.getState().rebuildIndex();
    expect(mockInvoke).toHaveBeenCalledWith('semantic_reindex', undefined);
    expect(useSemanticStore.getState().state).toBe('indexing');
  });
});

/**
 * Whether the active Forge can be read yet.
 *
 * A local Forge always can. The synced Forge cannot until iCloud finishes its first
 * metadata pass after launch, and every read before that fails. The app waits here
 * before its first loads and shows one message if iCloud does not become available.
 * A late `icloud:ready` still makes it ready.
 */

import { create } from 'zustand';
import { listen } from '@tauri-apps/api/event';
import { safeInvoke } from './ipc';
import { getActiveForgeName } from './forgeStorage';

/** Must match `FORGE_ID` in `src-tauri/src/cloud_forge.rs`. */
export const SYNCED_FORGE_ID = 'icloud://moldavite';

export type ForgeReadinessStatus = 'checking' | 'ready' | 'unavailable';

interface ForgeReadinessState {
  status: ForgeReadinessStatus;
  message: string | null;
}

interface CloudReadiness {
  state: 'local' | 'ready' | 'preparing' | 'unavailable';
  message: string | null;
}

// The cached active Forge decides the first render, so a local Forge renders at once.
export const useForgeReadinessStore = create<ForgeReadinessState>(() => ({
  status: getActiveForgeName() === SYNCED_FORGE_ID ? 'checking' : 'ready',
  message: null,
}));

function setStatus(status: ForgeReadinessStatus, message: string | null = null): void {
  useForgeReadinessStore.setState({ status, message });
}

/** Follow iCloud readiness for the window's lifetime; returns the unsubscribe. */
export function watchForgeReadiness(): () => void {
  let disposed = false;
  const unlisteners: (() => void)[] = [];

  const keep = (unlisten: () => void) => {
    if (disposed) unlisten();
    else unlisteners.push(unlisten);
  };

  const start = async () => {
    try {
      keep(await listen('icloud:ready', () => setStatus('ready')));
      keep(
        await listen<string>('icloud:error', (event) => {
          if (useForgeReadinessStore.getState().status !== 'ready') {
            setStatus('unavailable', event.payload);
          }
        })
      );
      if (disposed) return;
      const readiness = await safeInvoke<CloudReadiness>('icloud_readiness');
      if (disposed) return;
      if (readiness.state === 'preparing') setStatus('checking');
      else if (readiness.state === 'unavailable') setStatus('unavailable', readiness.message);
      else setStatus('ready');
    } catch (error) {
      // Without the readiness command there is nothing to wait for.
      console.error('[forgeReadiness] readiness check failed:', error);
      if (!disposed) setStatus('ready');
    }
  };

  void start();
  return () => {
    disposed = true;
    for (const unlisten of unlisteners.splice(0)) unlisten();
  };
}

/** Resolves once the active Forge can be read. */
export function whenForgeReady(): Promise<void> {
  if (useForgeReadinessStore.getState().status === 'ready') return Promise.resolve();
  return new Promise((resolve) => {
    const unsubscribe = useForgeReadinessStore.subscribe((state) => {
      if (state.status !== 'ready') return;
      unsubscribe();
      resolve();
    });
  });
}

/** Cold-start and running-instance delivery for website plugin install links. */

import { useEffect } from 'react';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { safeInvoke } from '@/lib/ipc';
import { useGraphStore } from '@/stores/graphStore';
import { usePluginInstallStore } from '@/stores/pluginInstallStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { useTimelineStore } from '@/stores/timelineStore';

export const PLUGIN_INSTALL_EVENT = 'plugin-install-requested';
const PLUGIN_ID_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;

/** Route only backend-validated plugin ids into Settings; fail closed otherwise. */
export function routePluginInstallRequest(value: unknown): boolean {
  if (typeof value !== 'string' || !PLUGIN_ID_RE.test(value)) {
    return false;
  }

  useTimelineStore.getState().close();
  useGraphStore.getState().close();
  const settings = useSettingsStore.getState();
  settings.setActiveSettingsTab('plugins');
  settings.setIsSettingsOpen(true);
  usePluginInstallStore.getState().request(value);
  return true;
}

/**
 * Subscribe before draining so a URL arriving during startup cannot be lost.
 * The Rust queue is also the payload source for live events, avoiding separate
 * cold/running routing paths.
 */
export function usePluginDeepLinks() {
  useEffect(() => {
    let disposed = false;
    let unlisten: UnlistenFn | undefined;

    const drain = async () => {
      try {
        const pending = await safeInvoke<unknown>('take_pending_plugin_install_links');
        if (!Array.isArray(pending)) return;
        pending.forEach(routePluginInstallRequest);
      } catch (error) {
        console.error('[deep-link] could not read pending plugin requests:', error);
      }
    };

    const initialize = async () => {
      const stop = await listen(PLUGIN_INSTALL_EVENT, () => {
        void drain();
      });
      if (disposed) {
        stop();
        return;
      }
      unlisten = stop;
      await drain();
    };

    void initialize();
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);
}

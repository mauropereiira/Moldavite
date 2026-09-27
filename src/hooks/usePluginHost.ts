/**
 * React lifecycle adapter for the active Forge's plugin host.
 * It starts validated, enabled workers once on mount; sandboxing and teardown
 * invariants remain in `lib/plugins/host.ts`.
 */

import { useEffect } from 'react';
import { setPluginsPaused, startPluginsAtLaunch } from '@/lib/plugins/host';
import { whenForgeReady } from '@/lib/forgeReadiness';
import { useToastStore } from '@/stores/toastStore';
import type { SafeModeStatus } from '@/stores/pluginSafeModeStore';
import { openPluginSettings } from './usePluginDeepLinks';

export function safeModeLaunchMessage(status: SafeModeStatus): string | null {
  if (!status.active) return null;
  if (status.reason === 'unfinishedStart') {
    return "Moldavite started without plugins because the last start didn't finish. If a plugin caused it, turn that plugin off before turning plugins back on.";
  }
  if (status.reason === 'launchFlag') {
    return 'Moldavite started in safe mode, without plugins.';
  }
  return null;
}

function announceSafeMode(status: SafeModeStatus): void {
  const message = safeModeLaunchMessage(status);
  if (!message) return;
  useToastStore.getState().addToast('warning', message, undefined, [
    { label: 'Manage plugins', onClick: () => openPluginSettings() },
    {
      label: 'Turn plugins back on',
      onClick: () => {
        void setPluginsPaused(false).catch((err) =>
          console.error('[plugins] could not turn plugins back on:', err)
        );
      },
    },
  ]);
}

/** Start enabled plugins for the active Forge once on mount. */
export function usePluginHost(): void {
  useEffect(() => {
    whenForgeReady()
      .then(startPluginsAtLaunch)
      .then(announceSafeMode)
      .catch((err) => console.error('[plugins] host init failed:', err));
  }, []);
}

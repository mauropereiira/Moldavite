import { lazy, Suspense, useSyncExternalStore } from 'react';
import { getPluginDialogSnapshot, subscribePluginDialogs } from '@/lib/plugins/dialogs';

const LazyPluginDialogHost = lazy(async () => {
  const module = await import('./PluginDialogHost');
  return { default: module.PluginDialogHost };
});

/**
 * Keep the dialog broker eager, but load the form/dialog UI only when a plugin
 * has an active request. The broker retains the pending Promise and rejects a
 * second request while this chunk is loading.
 */
export function PluginDialogHostLoader() {
  const request = useSyncExternalStore(
    subscribePluginDialogs,
    getPluginDialogSnapshot,
    getPluginDialogSnapshot
  );

  if (!request) return null;
  return (
    <Suspense fallback={null}>
      <LazyPluginDialogHost />
    </Suspense>
  );
}

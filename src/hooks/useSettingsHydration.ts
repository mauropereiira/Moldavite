import { useSyncExternalStore } from 'react';
import { useSettingsStore } from '@/stores/settingsStore';

function subscribe(onStoreChange: () => void) {
  const stopWaiting = useSettingsStore.persist.onHydrate(onStoreChange);
  const finishWaiting = useSettingsStore.persist.onFinishHydration(onStoreChange);
  return () => {
    stopWaiting();
    finishWaiting();
  };
}

export function useSettingsHydration(): boolean {
  return useSyncExternalStore(
    subscribe,
    useSettingsStore.persist.hasHydrated,
    useSettingsStore.persist.hasHydrated
  );
}

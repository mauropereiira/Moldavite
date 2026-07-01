import { useEffect } from 'react';
import { loadEnabledPlugins } from '@/lib/plugins/host';

/** Load enabled plugins for the active Forge once on mount. */
export function usePluginHost(): void {
  useEffect(() => {
    loadEnabledPlugins().catch((err) => console.error('[plugins] host init failed:', err));
  }, []);
}

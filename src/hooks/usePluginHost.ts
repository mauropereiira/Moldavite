/**
 * React lifecycle adapter for the active Forge's plugin host.
 * It starts validated, enabled workers once on mount; sandboxing and teardown
 * invariants remain in `lib/plugins/host.ts`.
 */

import { useEffect } from 'react';
import { loadEnabledPlugins } from '@/lib/plugins/host';

/** Load enabled plugins for the active Forge once on mount. */
export function usePluginHost(): void {
  useEffect(() => {
    loadEnabledPlugins().catch((err) => console.error('[plugins] host init failed:', err));
  }, []);
}

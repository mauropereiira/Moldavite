/**
 * Helpers for per-Forge localStorage namespacing.
 *
 * The active Forge name has to be readable synchronously when stores
 * initialize, but it lives in the Rust config (which is async to read).
 * As soon as `useForgeStore.loadForges()` resolves we cache the active
 * name in localStorage under a single well-known key, and the namespaced
 * helpers read that cache. On the very first launch (cache empty), keys
 * fall back to `default` so existing single-Forge users keep their
 * recent-notes/quick-switcher state under the same name.
 */

const ACTIVE_FORGE_CACHE_KEY = '__moldavite_active_forge';

export function rememberActiveForge(name: string | null) {
  try {
    if (name) {
      localStorage.setItem(ACTIVE_FORGE_CACHE_KEY, name);
    }
  } catch {
    // ignore — private mode etc.
  }
}

export function getActiveForgeName(): string {
  try {
    const cached = localStorage.getItem(ACTIVE_FORGE_CACHE_KEY);
    if (cached && cached.length > 0) return cached;
  } catch {
    // ignore
  }
  return 'default';
}

/**
 * Namespace a base localStorage key by the active Forge name. Falls back
 * to the legacy unnamespaced key when no Forge is known yet so that
 * users upgrading from single-Forge installs don't lose state on first
 * launch.
 */
export function namespacedKey(baseKey: string): string {
  return `${baseKey}:${getActiveForgeName()}`;
}

/**
 * Helpers for per-Forge localStorage namespacing.
 *
 * The active Forge name has to be readable synchronously when stores
 * initialize, but it lives in the Rust config (which is async to read).
 * As soon as `useForgeStore.loadForges()` resolves we cache the active
 * name in localStorage under a single well-known key, and the namespaced
 * helpers read that cache. On the very first launch (cache empty), keys
 * fall back to the backend's default Forge name so that session's state
 * is still found on the next launch.
 */

import type { StateStorage } from 'zustand/middleware';

const ACTIVE_FORGE_CACHE_KEY = '__moldavite_active_forge';

/**
 * Must match `DEFAULT_FORGE_NAME` in `src-tauri/src/paths.rs`. Everything
 * written before the first `loadForges()` resolves lands under this name; if
 * it disagreed with what the backend then reports, that whole first session's
 * state would be orphaned under a key nothing ever reads again.
 */
const DEFAULT_FORGE_NAME = 'Default';

type ActiveForgeListener = () => void;
const activeForgeListeners = new Set<ActiveForgeListener>();

/**
 * Subscribe to "the cached active Forge name just changed".
 *
 * Stores that hydrate at import time need this. Switching Forge sets the
 * backend and reloads the page, so during that reload the cache still names
 * the *previous* Forge until `loadForges()` resolves — anything hydrated
 * before then is holding the wrong Forge's slice and must re-read.
 *
 * @returns An unsubscribe function.
 */
export function onActiveForgeChange(listener: ActiveForgeListener): () => void {
  activeForgeListeners.add(listener);
  return () => activeForgeListeners.delete(listener);
}

export function rememberActiveForge(name: string | null) {
  if (!name) return;
  let previous: string | null = null;
  try {
    previous = localStorage.getItem(ACTIVE_FORGE_CACHE_KEY);
    localStorage.setItem(ACTIVE_FORGE_CACHE_KEY, name);
  } catch {
    // ignore — private mode etc.
  }
  if (previous !== name) {
    for (const listener of activeForgeListeners) listener();
  }
}

export function getActiveForgeName(): string {
  try {
    const cached = localStorage.getItem(ACTIVE_FORGE_CACHE_KEY);
    if (cached && cached.length > 0) return cached;
  } catch {
    // ignore
  }
  return DEFAULT_FORGE_NAME;
}

/**
 * Namespace a base localStorage key by the active Forge name. Falls back
 * to the backend's default Forge name when no Forge is known yet so that
 * users upgrading from single-Forge installs don't lose state on first
 * launch.
 */
export function namespacedKey(baseKey: string): string {
  return `${baseKey}:${getActiveForgeName()}`;
}

/** Read a namespaced value; null when absent or storage is unavailable. */
export function readNamespaced(baseKey: string): string | null {
  try {
    return localStorage.getItem(namespacedKey(baseKey));
  } catch {
    return null;
  }
}

/**
 * Read a namespaced value, falling back once to a flat (pre-namespacing)
 * key of the same name. When the namespaced slot is empty and the flat key
 * has a value, that value is copied into the namespaced slot for the active
 * Forge — the flat key is left in place, since another Forge's first read
 * may still need it. Null when neither is present or storage is unavailable.
 */
export function readNamespacedWithLegacyFallback(baseKey: string): string | null {
  const namespaced = readNamespaced(baseKey);
  if (namespaced !== null) return namespaced;
  let legacy: string | null = null;
  try {
    legacy = localStorage.getItem(baseKey);
  } catch {
    return null;
  }
  if (legacy !== null) {
    try {
      localStorage.setItem(namespacedKey(baseKey), legacy);
    } catch {
      // ignore — private mode etc.
    }
  }
  return legacy;
}

/**
 * A zustand `StateStorage` that namespaces the store's `name` on every call
 * instead of once at import time. Persisted stores are imported long before
 * the active-Forge cache is trustworthy, so a key captured at import time
 * would address the previous Forge for the entire session.
 */
export const forgeNamespacedStorage: StateStorage = {
  getItem: (name) => readNamespaced(name),
  setItem: (name, value) => {
    try {
      localStorage.setItem(namespacedKey(name), value);
    } catch {
      // ignore — private mode etc.
    }
  },
  removeItem: (name) => {
    try {
      localStorage.removeItem(namespacedKey(name));
    } catch {
      // ignore
    }
  },
};

/**
 * Like `forgeNamespacedStorage`, but for a store migrating off a flat
 * (non-namespaced) key of the same name — see `readNamespacedWithLegacyFallback`.
 */
export const forgeNamespacedStorageWithLegacyFallback: StateStorage = {
  getItem: (name) => readNamespacedWithLegacyFallback(name),
  setItem: forgeNamespacedStorage.setItem,
  removeItem: forgeNamespacedStorage.removeItem,
};

/**
 * Per-Forge localStorage namespacing tests.
 *
 * Two invariants matter here: the first-launch fallback has to be the name the
 * backend will report (or that session's state is orphaned), and keys have to
 * be resolved per call, because persisted stores are imported while the cache
 * still names the Forge the user just switched away from.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  forgeNamespacedStorage,
  forgeNamespacedStorageWithLegacyFallback,
  getActiveForgeName,
  namespacedKey,
  onActiveForgeChange,
  readNamespaced,
  readNamespacedWithLegacyFallback,
  rememberActiveForge,
} from './forgeStorage';

beforeEach(() => {
  localStorage.clear();
});

describe('active Forge fallback', () => {
  it("falls back to the backend's DEFAULT_FORGE_NAME", () => {
    // Mirrors `DEFAULT_FORGE_NAME` in src-tauri/src/paths.rs.
    expect(getActiveForgeName()).toBe('Default');
    expect(namespacedKey('moldavite-recent-notes')).toBe('moldavite-recent-notes:Default');
  });

  it('prefers the cached name once a Forge is known', () => {
    rememberActiveForge('Research');
    expect(getActiveForgeName()).toBe('Research');
    expect(namespacedKey('k')).toBe('k:Research');
  });

  it('ignores a null active Forge', () => {
    rememberActiveForge('Research');
    rememberActiveForge(null);
    expect(getActiveForgeName()).toBe('Research');
  });
});

describe('forgeNamespacedStorage', () => {
  it('resolves the key at call time, not when the storage was captured', () => {
    const storage = forgeNamespacedStorage;
    rememberActiveForge('Alpha');
    storage.setItem('store', 'alpha-state');
    rememberActiveForge('Beta');
    storage.setItem('store', 'beta-state');

    expect(localStorage.getItem('store:Alpha')).toBe('alpha-state');
    expect(localStorage.getItem('store:Beta')).toBe('beta-state');
    expect(storage.getItem('store')).toBe('beta-state');
  });

  it('removes only the active Forge slot', () => {
    rememberActiveForge('Alpha');
    forgeNamespacedStorage.setItem('store', 'alpha-state');
    rememberActiveForge('Beta');
    forgeNamespacedStorage.setItem('store', 'beta-state');

    forgeNamespacedStorage.removeItem('store');

    expect(localStorage.getItem('store:Beta')).toBeNull();
    expect(localStorage.getItem('store:Alpha')).toBe('alpha-state');
  });

  it('reports a missing slot as null', () => {
    expect(readNamespaced('never-written')).toBeNull();
  });
});

describe('readNamespacedWithLegacyFallback', () => {
  it('copies a flat legacy value into the namespaced slot on first read, once', () => {
    localStorage.setItem('moldavite-folders', 'legacy-value');

    expect(readNamespacedWithLegacyFallback('moldavite-folders')).toBe('legacy-value');
    expect(localStorage.getItem('moldavite-folders:Default')).toBe('legacy-value');

    // The legacy key is left in place, but a later read no longer needs it —
    // the namespaced slot now answers directly.
    localStorage.setItem('moldavite-folders', 'changed-after-migration');
    expect(readNamespacedWithLegacyFallback('moldavite-folders')).toBe('legacy-value');
  });

  it('keeps two Forges separate even when both start from the same legacy value', () => {
    localStorage.setItem('moldavite-folders', 'legacy-value');

    rememberActiveForge('Alpha');
    expect(readNamespacedWithLegacyFallback('moldavite-folders')).toBe('legacy-value');
    forgeNamespacedStorageWithLegacyFallback.setItem('moldavite-folders', 'alpha-edit');

    rememberActiveForge('Beta');
    expect(readNamespacedWithLegacyFallback('moldavite-folders')).toBe('legacy-value');
    forgeNamespacedStorageWithLegacyFallback.setItem('moldavite-folders', 'beta-edit');

    expect(localStorage.getItem('moldavite-folders:Alpha')).toBe('alpha-edit');
    expect(localStorage.getItem('moldavite-folders:Beta')).toBe('beta-edit');
  });

  it('returns null when neither the namespaced slot nor the legacy key exist', () => {
    expect(readNamespacedWithLegacyFallback('never-written')).toBeNull();
  });
});

describe('onActiveForgeChange', () => {
  it('notifies subscribers when the cached name changes', () => {
    const listener = vi.fn();
    const unsubscribe = onActiveForgeChange(listener);

    rememberActiveForge('Alpha');
    expect(listener).toHaveBeenCalledTimes(1);

    // Same name again: nothing moved, nothing to re-read.
    rememberActiveForge('Alpha');
    expect(listener).toHaveBeenCalledTimes(1);

    rememberActiveForge('Beta');
    expect(listener).toHaveBeenCalledTimes(2);

    unsubscribe();
    rememberActiveForge('Gamma');
    expect(listener).toHaveBeenCalledTimes(2);
  });
});

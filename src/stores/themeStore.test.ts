import { describe, it, expect, beforeEach, vi } from 'vitest';

const STORAGE_KEY = 'moldavite-theme';

/**
 * The persist middleware hydrates storage at store-creation time. To exercise
 * different persisted states we have to seed `localStorage` first, then force
 * a fresh module load via `vi.resetModules()`.
 */
async function loadStoreFresh() {
  vi.resetModules();
  const mod = await import('./themeStore');
  // persist hydrates asynchronously in zustand v5 — wait for it.
  await mod.useThemeStore.persist.rehydrate();
  return mod;
}

describe('themeStore persistence', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('migrates a v0/v1 persisted state ({ theme: "dark" }) to the new schema', async () => {
    // Old shape: only `theme`, no version, no preset.
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ state: { theme: 'dark' } }));

    const { useThemeStore } = await loadStoreFresh();
    const state = useThemeStore.getState();

    expect(state.baseMode).toBe('dark');
    expect(state.preset).toBe('default');
    // back-compat alias still mirrors baseMode
    expect(state.theme).toBe('dark');
  });

  it('falls back to defaults when persisted state is missing', async () => {
    const { useThemeStore } = await loadStoreFresh();
    const state = useThemeStore.getState();
    expect(state.baseMode).toBe('system');
    expect(state.preset).toBe('default');
  });

  it('rejects unknown preset ids during migration', async () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ state: { theme: 'light', preset: 'totally-fake' } })
    );

    const { useThemeStore } = await loadStoreFresh();
    const state = useThemeStore.getState();
    expect(state.baseMode).toBe('light');
    expect(state.preset).toBe('default');
  });

  it('preserves a valid preset across reload', async () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ state: { baseMode: 'light', preset: 'dracula' }, version: 2 })
    );

    const { useThemeStore } = await loadStoreFresh();
    const state = useThemeStore.getState();
    expect(state.preset).toBe('dracula');
    expect(state.baseMode).toBe('light');
  });
});

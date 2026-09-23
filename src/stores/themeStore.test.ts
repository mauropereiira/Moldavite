/** Theme hydration validation and deterministic DOM-projection tests. */

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
    // 'light', not 'system': Cream is the product's identity, so a first
    // launch shows it regardless of the OS appearance setting.
    expect(state.baseMode).toBe('light');
    expect(state.theme).toBe('light');
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
      JSON.stringify({ state: { baseMode: 'light', preset: 'plum' }, version: 2 })
    );

    const { useThemeStore } = await loadStoreFresh();
    const state = useThemeStore.getState();
    expect(state.preset).toBe('plum');
    expect(state.baseMode).toBe('light');
  });

  it.each([
    ['solarized', 'slate'],
    ['nord', 'slate'],
    ['dracula', 'plum'],
    ['sepia', 'clay'],
    ['gruvbox', 'clay'],
  ])('moves the retired %s preset to %s', async (retired, replacement) => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ state: { baseMode: 'dark', preset: retired }, version: 2 })
    );

    const { useThemeStore } = await loadStoreFresh();
    expect(useThemeStore.getState().preset).toBe(replacement);
  });
});

describe('theme presets', () => {
  it('apply the preset in both base modes', async () => {
    const { applyTheme, PRESETS } = await loadStoreFresh();
    for (const { id } of PRESETS) {
      for (const mode of ['light', 'dark'] as const) {
        applyTheme(mode, id);
        expect(document.documentElement.getAttribute('data-theme')).toBe(id);
        expect(document.documentElement.classList.contains('dark')).toBe(mode === 'dark');
      }
    }
  });
});

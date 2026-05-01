import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/**
 * Theme model — split into two orthogonal axes:
 *   - baseMode: light / dark / system (controls the `dark` class)
 *   - preset:   the palette family (controls the `data-theme` attribute)
 *
 * Each preset supplies tokens for one or both base modes. When a preset
 * doesn't fit a given base mode (e.g. Dracula in light), the CSS falls
 * back to the `default` palette. We don't try to invent palettes that
 * weren't designed for a given mode — designers chose them deliberately.
 */
export type BaseMode = 'light' | 'dark' | 'system';

export type ThemePreset =
  | 'default'
  | 'solarized'
  | 'dracula'
  | 'nord'
  | 'sepia'
  | 'gruvbox';

/**
 * Coverage descriptor for the picker UI.
 * - `both`  — the preset has both light and dark token blocks
 * - `dark`  — dark-only; the preset falls back to `default` in light mode
 * - `light` — light-only; the preset falls back to `default` in dark mode
 */
export type PresetCoverage = 'both' | 'dark' | 'light';

export interface PresetMeta {
  id: ThemePreset;
  label: string;
  coverage: PresetCoverage;
  /** 5 representative swatches: bg, surface, accent, text, border. */
  swatches: {
    bg: string;
    surface: string;
    accent: string;
    text: string;
    border: string;
  };
}

export const PRESETS: PresetMeta[] = [
  {
    id: 'default',
    label: 'Moldavite',
    coverage: 'both',
    swatches: {
      bg: '#f0f5f2',
      surface: '#ffffff',
      accent: '#2d5a3d',
      text: '#0a0f0d',
      border: '#c4d4c9',
    },
  },
  {
    id: 'solarized',
    label: 'Solarized',
    coverage: 'both',
    swatches: {
      bg: '#fdf6e3',
      surface: '#eee8d5',
      accent: '#268bd2',
      text: '#073642',
      border: '#d8d2bd',
    },
  },
  {
    id: 'dracula',
    label: 'Dracula',
    coverage: 'dark',
    swatches: {
      bg: '#282a36',
      surface: '#383a4a',
      accent: '#bd93f9',
      text: '#f8f8f2',
      border: '#44475a',
    },
  },
  {
    id: 'nord',
    label: 'Nord',
    coverage: 'dark',
    swatches: {
      bg: '#2e3440',
      surface: '#3b4252',
      accent: '#88c0d0',
      text: '#eceff4',
      border: '#434c5e',
    },
  },
  {
    id: 'sepia',
    label: 'Sepia',
    coverage: 'light',
    swatches: {
      bg: '#f4ecd8',
      surface: '#fbf4e0',
      accent: '#8b5a2b',
      text: '#3b2a1a',
      border: '#d8c8a8',
    },
  },
  {
    id: 'gruvbox',
    label: 'Gruvbox',
    coverage: 'both',
    swatches: {
      bg: '#fbf1c7',
      surface: '#f2e5bc',
      accent: '#af3a03',
      text: '#3c3836',
      border: '#d5c4a1',
    },
  },
];

const PRESET_IDS = PRESETS.map((p) => p.id) as ThemePreset[];

export const isThemePreset = (v: unknown): v is ThemePreset =>
  typeof v === 'string' && (PRESET_IDS as string[]).includes(v);

interface ThemeState {
  /** Light/dark/system base mode (drives the `dark` class). */
  baseMode: BaseMode;
  /** Color preset (drives the `data-theme` attribute). */
  preset: ThemePreset;

  setBaseMode: (mode: BaseMode) => void;
  setPreset: (preset: ThemePreset) => void;

  /**
   * Back-compat shim. Existing call sites use `theme` and `setTheme` for the
   * light/dark/system axis. Keep them working as aliases for `baseMode`.
   */
  theme: BaseMode;
  setTheme: (mode: BaseMode) => void;
}

export const useThemeStore = create<ThemeState>()(
  persist(
    (set) => ({
      baseMode: 'system',
      preset: 'default',
      theme: 'system',
      setBaseMode: (mode) => set({ baseMode: mode, theme: mode }),
      setPreset: (preset) => set({ preset }),
      setTheme: (mode) => set({ baseMode: mode, theme: mode }),
    }),
    {
      name: 'moldavite-theme',
      version: 2,
      // v0/v1 stored only `theme: 'light'|'dark'|'system'` and had no
      // `version` key. zustand only invokes `migrate` when the persisted
      // version is a number that differs from `options.version`, so legacy
      // payloads without a version skip `migrate` entirely. We therefore
      // also normalize inside `merge`, which always runs on hydration.
      migrate: (persistedState, _version) => {
        const state = (persistedState as Record<string, unknown>) ?? {};
        const legacyTheme = state.theme;
        const baseMode: BaseMode =
          legacyTheme === 'light' || legacyTheme === 'dark' || legacyTheme === 'system'
            ? legacyTheme
            : ((state.baseMode as BaseMode) ?? 'system');
        const preset: ThemePreset = isThemePreset(state.preset) ? state.preset : 'default';
        return { baseMode, preset, theme: baseMode } as ThemeState;
      },
      merge: (persistedState, currentState) => {
        const persisted = (persistedState as Partial<ThemeState> & Record<string, unknown>) ?? {};
        const legacyTheme = persisted.theme;
        const baseMode: BaseMode =
          persisted.baseMode === 'light' ||
          persisted.baseMode === 'dark' ||
          persisted.baseMode === 'system'
            ? persisted.baseMode
            : legacyTheme === 'light' || legacyTheme === 'dark' || legacyTheme === 'system'
            ? legacyTheme
            : currentState.baseMode;
        const preset: ThemePreset = isThemePreset(persisted.preset)
          ? persisted.preset
          : 'default';
        return { ...currentState, baseMode, preset, theme: baseMode };
      },
    }
  )
);

/** Apply the current theme (base mode + preset) to <html>. */
export const applyTheme = (mode: BaseMode, preset: ThemePreset = 'default') => {
  const root = document.documentElement;
  if (mode === 'system') {
    const systemDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    root.classList.toggle('dark', systemDark);
  } else {
    root.classList.toggle('dark', mode === 'dark');
  }
  root.setAttribute('data-theme', preset);
};

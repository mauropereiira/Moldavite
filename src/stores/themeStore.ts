/** Persisted theme axes and their deterministic projection onto document state. */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/**
 * Theme model — split into two orthogonal axes:
 *   - baseMode: light / dark / system (controls the `dark` class)
 *   - preset:   the palette family (controls the `data-theme` attribute)
 *
 * Persisted values are validated during hydration. Applied DOM classes and attributes
 * are a deterministic projection of the two axes, never a second theme state.
 * Every preset supplies tokens for both base modes, so the two axes combine
 * freely.
 */
export type BaseMode = 'light' | 'dark' | 'system';

export type ThemePreset = 'default' | 'sage' | 'slate' | 'clay' | 'plum' | 'graphite';

export interface PresetSwatches {
  bg: string;
  surface: string;
  accent: string;
  text: string;
  border: string;
}

export interface PresetMeta {
  id: ThemePreset;
  label: string;
  /** 5 representative swatches per mode: paper, chrome, accent, text, border. */
  swatches: PresetSwatches;
  darkSwatches: PresetSwatches;
}

export const PRESETS: PresetMeta[] = [
  {
    id: 'default',
    label: 'Cream',
    swatches: {
      bg: '#FFFDF6',
      surface: '#F2EEE1',
      accent: '#2E5B3C',
      text: '#0E0D0A',
      border: 'rgba(14, 13, 10, 0.13)',
    },
    darkSwatches: {
      bg: '#1A1811',
      surface: '#0D0B07',
      accent: '#7FB58C',
      text: '#F9F6ED',
      border: 'rgba(249, 246, 237, 0.14)',
    },
  },
  {
    id: 'sage',
    label: 'Sage',
    swatches: {
      bg: '#EDF7EA',
      surface: '#D6E5D0',
      accent: '#4E591B',
      text: '#0E170B',
      border: 'rgba(14, 23, 11, 0.13)',
    },
    darkSwatches: {
      bg: '#1B2817',
      surface: '#0B1B06',
      accent: '#ACB880',
      text: '#E3EDE0',
      border: 'rgba(227, 237, 224, 0.14)',
    },
  },
  {
    id: 'slate',
    label: 'Slate',
    swatches: {
      bg: '#EBF5FE',
      surface: '#D2E2F0',
      accent: '#235585',
      text: '#0C151D',
      border: 'rgba(12, 21, 29, 0.13)',
    },
    darkSwatches: {
      bg: '#182631',
      surface: '#071725',
      accent: '#87B6E6',
      text: '#E0EBF5',
      border: 'rgba(224, 235, 245, 0.14)',
    },
  },
  {
    id: 'clay',
    label: 'Clay',
    swatches: {
      bg: '#FFF0E8',
      surface: '#F2DACD',
      accent: '#86371D',
      text: '#1D1009',
      border: 'rgba(29, 16, 9, 0.13)',
    },
    darkSwatches: {
      bg: '#321F14',
      surface: '#260F03',
      accent: '#EA9A81',
      text: '#F6E6DE',
      border: 'rgba(246, 230, 222, 0.14)',
    },
  },
  {
    id: 'plum',
    label: 'Plum',
    swatches: {
      bg: '#FCF0F8',
      surface: '#ECD9E7',
      accent: '#753A66',
      text: '#1A1018',
      border: 'rgba(26, 16, 24, 0.13)',
    },
    darkSwatches: {
      bg: '#2D1F2A',
      surface: '#200F1D',
      accent: '#D79BC5',
      text: '#F2E5EE',
      border: 'rgba(242, 229, 238, 0.14)',
    },
  },
  {
    id: 'graphite',
    label: 'Graphite',
    swatches: {
      bg: '#F1F4F7',
      surface: '#DCE0E5',
      accent: '#23272C',
      text: '#111418',
      border: 'rgba(17, 20, 24, 0.13)',
    },
    darkSwatches: {
      bg: '#212428',
      surface: '#13161B',
      accent: '#CCD1D8',
      text: '#E5EAF0',
      border: 'rgba(229, 234, 240, 0.14)',
    },
  },
];

const PRESET_IDS = PRESETS.map((p) => p.id) as ThemePreset[];

export const isThemePreset = (v: unknown): v is ThemePreset =>
  typeof v === 'string' && (PRESET_IDS as string[]).includes(v);

/** Presets retired in the 2026 revamp, mapped to the closest current palette. */
const RETIRED_PRESETS: Record<string, ThemePreset> = {
  solarized: 'slate',
  nord: 'slate',
  dracula: 'plum',
  sepia: 'clay',
  gruvbox: 'clay',
};

export const normalizePreset = (v: unknown): ThemePreset => {
  if (isThemePreset(v)) return v;
  if (typeof v === 'string' && v in RETIRED_PRESETS) return RETIRED_PRESETS[v];
  return 'default';
};

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
      // Cream is the identity, so it is what you get on first launch — not
      // 'system', which would open the app inverted on any Mac set to dark and
      // hide the palette the whole design is built around. 'system' remains
      // available in Appearance for anyone who wants it.
      baseMode: 'light',
      preset: 'default',
      theme: 'light',
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
        const preset = normalizePreset(state.preset);
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
        const preset = normalizePreset(persisted.preset);
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

/**
 * Persisted editor, appearance, behavior, and privacy preferences.
 * Store values are the single frontend source of truth; exported apply helpers mirror
 * visual settings onto document attributes and must remain deterministic/idempotent.
 */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { useOverlayStore } from './overlayStore';

export type FontSize = 'small' | 'medium' | 'large' | 'extra-large';
export type LineHeight = 'comfortable' | 'compact';
export type EditorWidth = 'narrow' | 'medium' | 'wide' | 'full';
export type DefaultNoteType = 'daily' | 'standalone';
export type FontFamily = 'system-sans' | 'system-serif' | 'system-mono' | 'inter' | 'merriweather';
export type AutoLockTimeout = 0 | 5 | 15 | 30 | 60; // 0 = never, values in minutes
export type SortOption =
  | 'name-asc'
  | 'name-desc'
  | 'modified-desc'
  | 'modified-asc'
  | 'created-desc'
  | 'created-asc';
export type ChromeMode = 'overlay' | 'pinned' | 'off';
export type SettingsTab =
  | 'general'
  | 'appearance'
  | 'layout'
  | 'editor'
  | 'features'
  | 'sidebar'
  | 'calendar'
  | 'templates'
  | 'plugins'
  | 'agents'
  | 'data'
  | 'import'
  | 'about';

export interface SettingsState {
  // General
  notesDirectory: string;
  autoSaveDelay: number;
  showAutoSaveStatus: boolean;

  // Appearance
  fontSize: FontSize;
  fontFamily: FontFamily;
  sidebarWidth: number;
  rightPanelWidth: number;
  compactMode: boolean;

  // Editor
  defaultNoteType: DefaultNoteType;
  spellCheck: boolean;
  autoCapitalize: boolean;
  showWordCount: boolean;
  lineHeight: LineHeight;
  editorWidth: EditorWidth;
  tagsEnabled: boolean;
  focusModeEnabled: boolean;

  // Layout
  showIconRail: boolean;
  indexMode: ChromeMode;
  agendaMode: ChromeMode;
  showNoteHeader: boolean;
  showTabBar: boolean;
  showEditorFooter: boolean;
  showBacklinksPanel: boolean;
  showWelcomeDots: boolean;
  showWelcomeStats: boolean;
  showWelcomeDate: boolean;
  showAsteroidCursor: boolean;

  // Sidebar
  sortOption: SortOption;
  showFoldersSection: boolean;
  showBacklinksSection: boolean;
  backlinksEnabled: boolean;

  // Right Panel
  showCalendarWidget: boolean;
  showTimelineWidget: boolean;

  // Security
  autoLockTimeout: AutoLockTimeout;

  // Onboarding
  hasSeenAppOnboarding: boolean;
  /**
   * Highest onboarding content version the user has seen. Bumped when new
   * feature pages are added to `AppOnboardingModal` so existing users see
   * just the new pages once (see `APP_ONBOARDING_VERSION` in the modal).
   */
  lastSeenOnboardingVersion: number;

  // UI State
  isSettingsOpen: boolean;
  activeSettingsTab: SettingsTab;

  // Actions
  setNotesDirectory: (path: string) => void;
  setAutoSaveDelay: (delay: number) => void;
  setShowAutoSaveStatus: (show: boolean) => void;
  setFontSize: (size: FontSize) => void;
  setFontFamily: (family: FontFamily) => void;
  setSidebarWidth: (width: number) => void;
  setRightPanelWidth: (width: number) => void;
  setCompactMode: (compact: boolean) => void;
  setDefaultNoteType: (type: DefaultNoteType) => void;
  setSpellCheck: (enabled: boolean) => void;
  setAutoCapitalize: (enabled: boolean) => void;
  setShowWordCount: (show: boolean) => void;
  setLineHeight: (height: LineHeight) => void;
  setEditorWidth: (width: EditorWidth) => void;
  setTagsEnabled: (enabled: boolean) => void;
  setFocusModeEnabled: (enabled: boolean) => void;
  setIndexMode: (mode: ChromeMode) => void;
  setAgendaMode: (mode: ChromeMode) => void;
  setSortOption: (option: SortOption) => void;
  setShowFoldersSection: (show: boolean) => void;
  setShowBacklinksSection: (show: boolean) => void;
  setBacklinksEnabled: (enabled: boolean) => void;
  setShowCalendarWidget: (show: boolean) => void;
  setShowTimelineWidget: (show: boolean) => void;
  setAutoLockTimeout: (timeout: AutoLockTimeout) => void;
  setHasSeenAppOnboarding: (seen: boolean) => void;
  setLastSeenOnboardingVersion: (version: number) => void;
  setIsSettingsOpen: (open: boolean) => void;
  setActiveSettingsTab: (tab: SettingsTab) => void;
  resetToDefaults: () => void;
}

const defaultSettings = {
  notesDirectory: '~/Documents/Moldavite/',
  autoSaveDelay: 300,
  showAutoSaveStatus: true,
  fontSize: 'medium' as FontSize,
  fontFamily: 'system-sans' as FontFamily,
  sidebarWidth: 280,
  rightPanelWidth: 288,
  compactMode: false,
  defaultNoteType: 'daily' as DefaultNoteType,
  spellCheck: true,
  autoCapitalize: true,
  showWordCount: false,
  lineHeight: 'comfortable' as LineHeight,
  editorWidth: 'wide' as EditorWidth,
  tagsEnabled: true,
  focusModeEnabled: false,
  showIconRail: true,
  indexMode: 'overlay' as ChromeMode,
  agendaMode: 'overlay' as ChromeMode,
  showNoteHeader: true,
  showTabBar: true,
  showEditorFooter: true,
  showBacklinksPanel: true,
  showWelcomeDots: true,
  showWelcomeStats: true,
  showWelcomeDate: true,
  showAsteroidCursor: true,
  sortOption: 'name-asc' as SortOption,
  showFoldersSection: true,
  showBacklinksSection: true,
  backlinksEnabled: true,
  showCalendarWidget: true,
  showTimelineWidget: true,
  autoLockTimeout: 15 as AutoLockTimeout, // 15 minutes default
  hasSeenAppOnboarding: false,
  lastSeenOnboardingVersion: 0,
  isSettingsOpen: false,
  activeSettingsTab: 'general' as SettingsTab,
};

const isChromeMode = (value: unknown): value is ChromeMode =>
  value === 'overlay' || value === 'pinned' || value === 'off';

/**
 * v0 stored `showSidebar` and `showRightPanel` as pin booleans. Preserve a
 * pinned choice while moving unpinned users to the new overlay default.
 *
 * Exported for tests because silently losing a pin during hydration would
 * change the app's whole frame on upgrade.
 */
export function migrateSettingsState(
  persisted: unknown,
  _version: number
): Record<string, unknown> {
  const legacy = (persisted ?? {}) as Record<string, unknown>;
  const state = { ...legacy };

  if (!isChromeMode(state.indexMode)) {
    state.indexMode = state.showSidebar === true ? 'pinned' : 'overlay';
  }
  if (!isChromeMode(state.agendaMode)) {
    state.agendaMode = state.showRightPanel === true ? 'pinned' : 'overlay';
  }

  delete state.showSidebar;
  delete state.showRightPanel;
  return state;
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      ...defaultSettings,

      setNotesDirectory: (path) => set({ notesDirectory: path }),
      setAutoSaveDelay: (delay) => set({ autoSaveDelay: delay }),
      setShowAutoSaveStatus: (show) => set({ showAutoSaveStatus: show }),
      setFontSize: (size) => set({ fontSize: size }),
      setFontFamily: (family) => set({ fontFamily: family }),
      setSidebarWidth: (width) => set({ sidebarWidth: width }),
      setRightPanelWidth: (width) => set({ rightPanelWidth: width }),
      setCompactMode: (compact) => set({ compactMode: compact }),
      setDefaultNoteType: (type) => set({ defaultNoteType: type }),
      setSpellCheck: (enabled) => set({ spellCheck: enabled }),
      setAutoCapitalize: (enabled) => set({ autoCapitalize: enabled }),
      setShowWordCount: (show) => set({ showWordCount: show }),
      setLineHeight: (height) => set({ lineHeight: height }),
      setEditorWidth: (width) => set({ editorWidth: width }),
      setTagsEnabled: (enabled) => set({ tagsEnabled: enabled }),
      setFocusModeEnabled: (enabled) => set({ focusModeEnabled: enabled }),
      setIndexMode: (mode) => {
        set({ indexMode: mode });
        if (mode === 'pinned') {
          useOverlayStore.getState().openIndex(true);
        } else if (useOverlayStore.getState().activeOverlay === 'index') {
          useOverlayStore.getState().closeOverlay();
        }
      },
      setAgendaMode: (mode) => {
        set({ agendaMode: mode });
        if (mode === 'pinned') {
          useOverlayStore.getState().openAgenda(true);
        } else if (useOverlayStore.getState().activeOverlay === 'agenda') {
          useOverlayStore.getState().closeOverlay();
        }
      },
      setSortOption: (option) => set({ sortOption: option }),
      setShowFoldersSection: (show) => set({ showFoldersSection: show }),
      setShowBacklinksSection: (show) => set({ showBacklinksSection: show }),
      setBacklinksEnabled: (enabled) => set({ backlinksEnabled: enabled }),
      setShowCalendarWidget: (show) => set({ showCalendarWidget: show }),
      setShowTimelineWidget: (show) => set({ showTimelineWidget: show }),
      setAutoLockTimeout: (timeout) => set({ autoLockTimeout: timeout }),
      setHasSeenAppOnboarding: (seen) => set({ hasSeenAppOnboarding: seen }),
      setLastSeenOnboardingVersion: (version) => set({ lastSeenOnboardingVersion: version }),
      setIsSettingsOpen: (open) => set({ isSettingsOpen: open }),
      setActiveSettingsTab: (tab) => set({ activeSettingsTab: tab }),
      resetToDefaults: () => set(defaultSettings),
    }),
    {
      name: 'moldavite-settings',
      version: 1,
      migrate: migrateSettingsState,
      // Legacy payloads without a version can skip Zustand's migrate hook.
      // Normalize in merge as well, while preserving current actions/defaults.
      merge: (persistedState, currentState) => ({
        ...currentState,
        ...migrateSettingsState(persistedState, 0),
      }),
      partialize: (state) => ({
        // Only persist actual settings, not UI state
        notesDirectory: state.notesDirectory,
        autoSaveDelay: state.autoSaveDelay,
        showAutoSaveStatus: state.showAutoSaveStatus,
        fontSize: state.fontSize,
        fontFamily: state.fontFamily,
        sidebarWidth: state.sidebarWidth,
        rightPanelWidth: state.rightPanelWidth,
        compactMode: state.compactMode,
        defaultNoteType: state.defaultNoteType,
        spellCheck: state.spellCheck,
        autoCapitalize: state.autoCapitalize,
        showWordCount: state.showWordCount,
        lineHeight: state.lineHeight,
        editorWidth: state.editorWidth,
        tagsEnabled: state.tagsEnabled,
        focusModeEnabled: state.focusModeEnabled,
        showIconRail: state.showIconRail,
        indexMode: state.indexMode,
        agendaMode: state.agendaMode,
        showNoteHeader: state.showNoteHeader,
        showTabBar: state.showTabBar,
        showEditorFooter: state.showEditorFooter,
        showBacklinksPanel: state.showBacklinksPanel,
        showWelcomeDots: state.showWelcomeDots,
        showWelcomeStats: state.showWelcomeStats,
        showWelcomeDate: state.showWelcomeDate,
        showAsteroidCursor: state.showAsteroidCursor,
        sortOption: state.sortOption,
        showFoldersSection: state.showFoldersSection,
        showBacklinksSection: state.showBacklinksSection,
        backlinksEnabled: state.backlinksEnabled,
        showCalendarWidget: state.showCalendarWidget,
        showTimelineWidget: state.showTimelineWidget,
        autoLockTimeout: state.autoLockTimeout,
        hasSeenAppOnboarding: state.hasSeenAppOnboarding,
        lastSeenOnboardingVersion: state.lastSeenOnboardingVersion,
      }),
    }
  )
);

// Helper to apply font size CSS variable
export function applyFontSize(size: FontSize) {
  const sizes = {
    small: '14px',
    medium: '16px',
    large: '18px',
    'extra-large': '20px',
  };
  document.documentElement.style.setProperty('--editor-font-size', sizes[size]);
}

// Helper to apply line height CSS variable
export function applyLineHeight(height: LineHeight) {
  const heights = {
    comfortable: '1.75',
    compact: '1.4',
  };
  document.documentElement.style.setProperty('--editor-line-height', heights[height]);
}

/**
 * Width of the writing column.
 *
 * A 68ch measure is the typographic textbook answer and it looked starved on a
 * wide window — the note occupied a third of the screen with cream either side.
 * These are deliberately wider, and each caps against the viewport so a narrow
 * window still keeps its margins instead of running text to the edges.
 *
 * (An `editorWidth` setting existed here before and was deleted as dead code:
 * it had no consumer and no UI. This one is wired to `--editor-measure`, which
 * both `.tiptap` and the note header read.)
 */
export function applyEditorWidth(width: EditorWidth) {
  const widths = {
    narrow: 'min(68ch, calc(100% - 4rem))',
    medium: 'min(100ch, calc(100% - 5rem))',
    wide: 'min(140ch, calc(100% - 8rem))',
    full: 'calc(100% - 4rem)',
  };
  document.documentElement.style.setProperty('--editor-measure', widths[width]);
}

// Helper to apply compact mode
export function applyCompactMode(compact: boolean) {
  if (compact) {
    document.documentElement.classList.add('compact-mode');
  } else {
    document.documentElement.classList.remove('compact-mode');
  }
}

// Helper to apply font family CSS variable
export function applyFontFamily(family: FontFamily) {
  const fonts: Record<FontFamily, string> = {
    'system-sans':
      '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", sans-serif',
    'system-serif': 'Georgia, "Times New Roman", Times, serif',
    'system-mono': 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Monaco, Consolas, monospace',
    inter: '"Inter", -apple-system, BlinkMacSystemFont, sans-serif',
    merriweather: '"Merriweather", Georgia, serif',
  };
  document.documentElement.style.setProperty('--editor-font-family', fonts[family]);
}

// Helper to apply focus mode
export function applyFocusMode(enabled: boolean) {
  if (enabled) {
    document.documentElement.classList.add('focus-mode');
  } else {
    document.documentElement.classList.remove('focus-mode');
  }
}

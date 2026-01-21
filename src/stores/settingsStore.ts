import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type FontSize = 'small' | 'medium' | 'large' | 'extra-large';
export type LineHeight = 'comfortable' | 'compact';
export type DefaultNoteType = 'daily' | 'standalone';
export type FontFamily = 'system-sans' | 'system-serif' | 'system-mono' | 'inter' | 'merriweather';
export type AutoLockTimeout = 0 | 5 | 15 | 30 | 60; // 0 = never, values in minutes
export type SortOption = 'name-asc' | 'name-desc' | 'modified-desc' | 'modified-asc' | 'created-desc' | 'created-asc';
export type EditorWidth = 'narrow' | 'medium' | 'wide' | 'full';
export type StartupView = 'last-note' | 'daily-note' | 'empty';

interface SettingsState {
  // General
  notesDirectory: string;
  autoSaveDelay: number;
  showAutoSaveStatus: boolean;
  startupView: StartupView;

  // Appearance
  fontSize: FontSize;
  fontFamily: FontFamily;
  sidebarWidth: number;
  rightPanelWidth: number;
  editorWidth: EditorWidth;
  compactMode: boolean;
  reduceAnimations: boolean;

  // Editor
  defaultNoteType: DefaultNoteType;
  spellCheck: boolean;
  autoCapitalize: boolean;
  showWordCount: boolean;
  lineHeight: LineHeight;
  tagsEnabled: boolean;
  slashCommandsEnabled: boolean;
  wikiLinksEnabled: boolean;
  focusModeEnabled: boolean;

  // Sidebar
  sortOption: SortOption;
  showDailyNotesSection: boolean;
  showWeeklyNotesSection: boolean;
  showFoldersSection: boolean;
  showBacklinksSection: boolean;
  backlinksEnabled: boolean;

  // Right Panel
  showRightPanel: boolean;
  showCalendarWidget: boolean;
  showTimelineWidget: boolean;

  // Quick Switcher
  quickSwitcherEnabled: boolean;

  // Security
  autoLockTimeout: AutoLockTimeout;

  // UI State
  isSettingsOpen: boolean;

  // Actions
  setNotesDirectory: (path: string) => void;
  setAutoSaveDelay: (delay: number) => void;
  setShowAutoSaveStatus: (show: boolean) => void;
  setStartupView: (view: StartupView) => void;
  setFontSize: (size: FontSize) => void;
  setFontFamily: (family: FontFamily) => void;
  setSidebarWidth: (width: number) => void;
  setRightPanelWidth: (width: number) => void;
  setEditorWidth: (width: EditorWidth) => void;
  setCompactMode: (compact: boolean) => void;
  setReduceAnimations: (reduce: boolean) => void;
  setDefaultNoteType: (type: DefaultNoteType) => void;
  setSpellCheck: (enabled: boolean) => void;
  setAutoCapitalize: (enabled: boolean) => void;
  setShowWordCount: (show: boolean) => void;
  setLineHeight: (height: LineHeight) => void;
  setTagsEnabled: (enabled: boolean) => void;
  setSlashCommandsEnabled: (enabled: boolean) => void;
  setWikiLinksEnabled: (enabled: boolean) => void;
  setFocusModeEnabled: (enabled: boolean) => void;
  setSortOption: (option: SortOption) => void;
  setShowDailyNotesSection: (show: boolean) => void;
  setShowWeeklyNotesSection: (show: boolean) => void;
  setShowFoldersSection: (show: boolean) => void;
  setShowBacklinksSection: (show: boolean) => void;
  setBacklinksEnabled: (enabled: boolean) => void;
  setShowRightPanel: (show: boolean) => void;
  setShowCalendarWidget: (show: boolean) => void;
  setShowTimelineWidget: (show: boolean) => void;
  setQuickSwitcherEnabled: (enabled: boolean) => void;
  setAutoLockTimeout: (timeout: AutoLockTimeout) => void;
  setIsSettingsOpen: (open: boolean) => void;
  resetToDefaults: () => void;
}

const defaultSettings = {
  notesDirectory: '~/Documents/Moldavite/',
  autoSaveDelay: 300,
  showAutoSaveStatus: true,
  startupView: 'daily-note' as StartupView,
  fontSize: 'medium' as FontSize,
  fontFamily: 'system-sans' as FontFamily,
  sidebarWidth: 280,
  rightPanelWidth: 288,
  editorWidth: 'medium' as EditorWidth,
  compactMode: false,
  reduceAnimations: false,
  defaultNoteType: 'daily' as DefaultNoteType,
  spellCheck: true,
  autoCapitalize: true,
  showWordCount: false,
  lineHeight: 'comfortable' as LineHeight,
  tagsEnabled: true,
  slashCommandsEnabled: true,
  wikiLinksEnabled: true,
  focusModeEnabled: false,
  sortOption: 'name-asc' as SortOption,
  showDailyNotesSection: true,
  showWeeklyNotesSection: true,
  showFoldersSection: true,
  showBacklinksSection: true,
  backlinksEnabled: true,
  showRightPanel: true,
  showCalendarWidget: true,
  showTimelineWidget: true,
  quickSwitcherEnabled: true,
  autoLockTimeout: 15 as AutoLockTimeout, // 15 minutes default
  isSettingsOpen: false,
};

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      ...defaultSettings,

      setNotesDirectory: (path) => set({ notesDirectory: path }),
      setAutoSaveDelay: (delay) => set({ autoSaveDelay: delay }),
      setShowAutoSaveStatus: (show) => set({ showAutoSaveStatus: show }),
      setStartupView: (view) => set({ startupView: view }),
      setFontSize: (size) => set({ fontSize: size }),
      setFontFamily: (family) => set({ fontFamily: family }),
      setSidebarWidth: (width) => set({ sidebarWidth: width }),
      setRightPanelWidth: (width) => set({ rightPanelWidth: width }),
      setEditorWidth: (width) => set({ editorWidth: width }),
      setCompactMode: (compact) => set({ compactMode: compact }),
      setReduceAnimations: (reduce) => set({ reduceAnimations: reduce }),
      setDefaultNoteType: (type) => set({ defaultNoteType: type }),
      setSpellCheck: (enabled) => set({ spellCheck: enabled }),
      setAutoCapitalize: (enabled) => set({ autoCapitalize: enabled }),
      setShowWordCount: (show) => set({ showWordCount: show }),
      setLineHeight: (height) => set({ lineHeight: height }),
      setTagsEnabled: (enabled) => set({ tagsEnabled: enabled }),
      setSlashCommandsEnabled: (enabled) => set({ slashCommandsEnabled: enabled }),
      setWikiLinksEnabled: (enabled) => set({ wikiLinksEnabled: enabled }),
      setFocusModeEnabled: (enabled) => set({ focusModeEnabled: enabled }),
      setSortOption: (option) => set({ sortOption: option }),
      setShowDailyNotesSection: (show) => set({ showDailyNotesSection: show }),
      setShowWeeklyNotesSection: (show) => set({ showWeeklyNotesSection: show }),
      setShowFoldersSection: (show) => set({ showFoldersSection: show }),
      setShowBacklinksSection: (show) => set({ showBacklinksSection: show }),
      setBacklinksEnabled: (enabled) => set({ backlinksEnabled: enabled }),
      setShowRightPanel: (show) => set({ showRightPanel: show }),
      setShowCalendarWidget: (show) => set({ showCalendarWidget: show }),
      setShowTimelineWidget: (show) => set({ showTimelineWidget: show }),
      setQuickSwitcherEnabled: (enabled) => set({ quickSwitcherEnabled: enabled }),
      setAutoLockTimeout: (timeout) => set({ autoLockTimeout: timeout }),
      setIsSettingsOpen: (open) => set({ isSettingsOpen: open }),
      resetToDefaults: () => set(defaultSettings),
    }),
    {
      name: 'moldavite-settings',
      partialize: (state) => ({
        // Only persist actual settings, not UI state
        notesDirectory: state.notesDirectory,
        autoSaveDelay: state.autoSaveDelay,
        showAutoSaveStatus: state.showAutoSaveStatus,
        startupView: state.startupView,
        fontSize: state.fontSize,
        fontFamily: state.fontFamily,
        sidebarWidth: state.sidebarWidth,
        rightPanelWidth: state.rightPanelWidth,
        editorWidth: state.editorWidth,
        compactMode: state.compactMode,
        reduceAnimations: state.reduceAnimations,
        defaultNoteType: state.defaultNoteType,
        spellCheck: state.spellCheck,
        autoCapitalize: state.autoCapitalize,
        showWordCount: state.showWordCount,
        lineHeight: state.lineHeight,
        tagsEnabled: state.tagsEnabled,
        slashCommandsEnabled: state.slashCommandsEnabled,
        wikiLinksEnabled: state.wikiLinksEnabled,
        focusModeEnabled: state.focusModeEnabled,
        sortOption: state.sortOption,
        showDailyNotesSection: state.showDailyNotesSection,
        showWeeklyNotesSection: state.showWeeklyNotesSection,
        showFoldersSection: state.showFoldersSection,
        showBacklinksSection: state.showBacklinksSection,
        backlinksEnabled: state.backlinksEnabled,
        showRightPanel: state.showRightPanel,
        showCalendarWidget: state.showCalendarWidget,
        showTimelineWidget: state.showTimelineWidget,
        quickSwitcherEnabled: state.quickSwitcherEnabled,
        autoLockTimeout: state.autoLockTimeout,
      }),
    }
  )
);

// Helper to apply font size CSS variable
export function applyFontSize(size: FontSize) {
  const sizes = {
    'small': '14px',
    'medium': '16px',
    'large': '18px',
    'extra-large': '20px',
  };
  document.documentElement.style.setProperty('--editor-font-size', sizes[size]);
}

// Helper to apply line height CSS variable
export function applyLineHeight(height: LineHeight) {
  const heights = {
    'comfortable': '1.75',
    'compact': '1.4',
  };
  document.documentElement.style.setProperty('--editor-line-height', heights[height]);
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
    'system-sans': '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", sans-serif',
    'system-serif': 'Georgia, "Times New Roman", Times, serif',
    'system-mono': 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Monaco, Consolas, monospace',
    'inter': '"Inter", -apple-system, BlinkMacSystemFont, sans-serif',
    'merriweather': '"Merriweather", Georgia, serif',
  };
  document.documentElement.style.setProperty('--editor-font-family', fonts[family]);
}

// Helper to apply editor width CSS variable
export function applyEditorWidth(width: EditorWidth) {
  const widths = {
    'narrow': '600px',
    'medium': '720px',
    'wide': '900px',
    'full': '100%',
  };
  document.documentElement.style.setProperty('--editor-max-width', widths[width]);
}

// Helper to apply reduced animations
export function applyReduceAnimations(reduce: boolean) {
  if (reduce) {
    document.documentElement.classList.add('reduce-animations');
  } else {
    document.documentElement.classList.remove('reduce-animations');
  }
}

// Helper to apply focus mode
export function applyFocusMode(enabled: boolean) {
  if (enabled) {
    document.documentElement.classList.add('focus-mode');
  } else {
    document.documentElement.classList.remove('focus-mode');
  }
}

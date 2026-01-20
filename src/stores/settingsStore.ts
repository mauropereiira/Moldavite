import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type FontSize = 'small' | 'medium' | 'large' | 'extra-large';
export type LineHeight = 'comfortable' | 'compact';
export type DefaultNoteType = 'daily' | 'standalone';
export type FontFamily = 'system-sans' | 'system-serif' | 'system-mono' | 'inter' | 'merriweather';
export type AutoLockTimeout = 0 | 5 | 15 | 30 | 60; // 0 = never, values in minutes
export type SortOption = 'name-asc' | 'name-desc';

interface SettingsState {
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
  tagsEnabled: boolean;

  // Sidebar
  sortOption: SortOption;

  // Security
  autoLockTimeout: AutoLockTimeout;

  // UI State
  isSettingsOpen: boolean;

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
  setTagsEnabled: (enabled: boolean) => void;
  setAutoLockTimeout: (timeout: AutoLockTimeout) => void;
  setSortOption: (option: SortOption) => void;
  setIsSettingsOpen: (open: boolean) => void;
  resetToDefaults: () => void;
}

const defaultSettings = {
  notesDirectory: '~/Documents/Notomattic/',
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
  tagsEnabled: true,
  autoLockTimeout: 15 as AutoLockTimeout, // 15 minutes default
  sortOption: 'name-asc' as SortOption,
  isSettingsOpen: false,
};

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
      setTagsEnabled: (enabled) => set({ tagsEnabled: enabled }),
      setAutoLockTimeout: (timeout) => set({ autoLockTimeout: timeout }),
      setSortOption: (option) => set({ sortOption: option }),
      setIsSettingsOpen: (open) => set({ isSettingsOpen: open }),
      resetToDefaults: () => set(defaultSettings),
    }),
    {
      name: 'notomattic-settings',
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
        tagsEnabled: state.tagsEnabled,
        autoLockTimeout: state.autoLockTimeout,
        sortOption: state.sortOption,
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

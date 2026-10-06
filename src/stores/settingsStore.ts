/**
 * Persisted editor, appearance, behavior, and privacy preferences.
 * Store values are the single frontend source of truth; exported apply helpers mirror
 * visual settings onto document attributes and must remain deterministic/idempotent.
 */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { useOverlayStore } from './overlayStore';
import { isMobilePlatform } from '@/lib/platform';

export type FontSize = 'small' | 'medium' | 'large' | 'extra-large';
export type LineHeight = 'comfortable' | 'compact';
export type EditorWidth = 'narrow' | 'medium' | 'wide' | 'full';
export type FontFamily = 'system-sans' | 'system-serif' | 'system-mono' | 'inter' | 'merriweather';
export type AutoLockTimeout = 0 | 5 | 15 | 30 | 60; // 0 = never, values in minutes
export type SortOption =
  /** The order the user dragged the sidebar into; see `useSidebarOrderStore`. */
  | 'manual'
  | 'name-asc'
  | 'name-desc'
  | 'modified-desc'
  | 'modified-asc'
  | 'created-desc'
  | 'created-asc';
export type ChromeMode = 'overlay' | 'pinned' | 'off';
export type IconRailSide = 'left' | 'right';
export type SettingsTab =
  | 'general'
  | 'appearance'
  | 'layout'
  | 'writing'
  | 'calendar'
  | 'agents'
  | 'plugins'
  | 'data'
  | 'about';
/** Tabs that were folded into others when Settings was regrouped. */
export type LegacySettingsTab = 'editor' | 'features' | 'sidebar' | 'templates' | 'import';
/** A tab, an old tab id, or `tab#anchor` for one group or setting inside a tab. */
export type SettingsTarget = SettingsTab | LegacySettingsTab | `${SettingsTab}#${string}`;

const SETTINGS_TABS: readonly string[] = [
  'general',
  'appearance',
  'layout',
  'writing',
  'calendar',
  'agents',
  'plugins',
  'data',
  'about',
];

const LEGACY_TABS: Record<LegacySettingsTab, string> = {
  editor: 'writing',
  features: 'writing#linking',
  sidebar: 'layout#index',
  templates: 'writing#templates',
  import: 'data#import',
};

/** Groups and settings that moved to another tab; `general#danger` still finds the Danger zone. */
const MOVED_ANCHORS: Record<string, SettingsTab> = {
  danger: 'data',
  'delete-all': 'data',
};

/**
 * Where a target lands. Old ids keep working because plugins, deep links and
 * persisted phone state can still name them; anything unknown opens General.
 */
export function resolveSettingsTarget(target: string): {
  tab: SettingsTab;
  anchor: string | null;
} {
  const [named, anchor = null] = (LEGACY_TABS[target as LegacySettingsTab] ?? target).split('#');
  const tab = (anchor && MOVED_ANCHORS[anchor]) || named;
  return SETTINGS_TABS.includes(tab)
    ? { tab: tab as SettingsTab, anchor }
    : { tab: 'general', anchor: null };
}

export interface SettingsState {
  fontSize: FontSize;
  fontFamily: FontFamily;
  sidebarWidth: number;
  rightPanelWidth: number;
  compactMode: boolean;

  spellCheck: boolean;
  autoCapitalize: boolean;
  /** Desktop: the toolbar and + above the block being written in. */
  showWritingToolbar: boolean;
  showWordCount: boolean;
  lineHeight: LineHeight;
  editorWidth: EditorWidth;
  tagsEnabled: boolean;
  focusModeEnabled: boolean;

  showIconRail: boolean;
  /**
   * Which window edge the rail sits on. The Index column travels with it, so
   * the rail and the panel it opens stay together; the Agenda takes the far
   * side.
   */
  iconRailSide: IconRailSide;
  indexMode: ChromeMode;
  agendaMode: ChromeMode;
  showNoteHeader: boolean;
  showTabBar: boolean;
  showEditorFooter: boolean;
  showBacklinksPanel: boolean;
  /** The home screen without its sky, date, counts and asteroid cursor. */
  quietHomeScreen: boolean;
  showSeasonalTouches: boolean;

  sortOption: SortOption;
  showFoldersSection: boolean;
  showBacklinksSection: boolean;

  showCalendarWidget: boolean;

  autoLockTimeout: AutoLockTimeout;

  hasSeenAppOnboarding: boolean;
  /**
   * Highest onboarding content version the user has seen. Bumped when new
   * feature pages are added to `AppOnboardingModal` so existing users see
   * just the new pages once (see `APP_ONBOARDING_VERSION` in the modal).
   */
  lastSeenOnboardingVersion: number;

  isSettingsOpen: boolean;
  activeSettingsTab: SettingsTab;
  /** The phone's open section; `null` is its list. */
  settingsSection: SettingsTab | null;
  /** A group or setting to open, scroll to and mark once its tab renders. */
  settingsAnchor: string | null;

  setFontSize: (size: FontSize) => void;
  setFontFamily: (family: FontFamily) => void;
  setSidebarWidth: (width: number) => void;
  setRightPanelWidth: (width: number) => void;
  setCompactMode: (compact: boolean) => void;
  setSpellCheck: (enabled: boolean) => void;
  setAutoCapitalize: (enabled: boolean) => void;
  setShowWritingToolbar: (show: boolean) => void;
  setShowWordCount: (show: boolean) => void;
  setLineHeight: (height: LineHeight) => void;
  setEditorWidth: (width: EditorWidth) => void;
  setTagsEnabled: (enabled: boolean) => void;
  setFocusModeEnabled: (enabled: boolean) => void;
  setIconRailSide: (side: IconRailSide) => void;
  setIndexMode: (mode: ChromeMode) => void;
  setAgendaMode: (mode: ChromeMode) => void;
  setSortOption: (option: SortOption) => void;
  setShowFoldersSection: (show: boolean) => void;
  setShowBacklinksSection: (show: boolean) => void;
  setQuietHomeScreen: (quiet: boolean) => void;
  setShowCalendarWidget: (show: boolean) => void;
  setAutoLockTimeout: (timeout: AutoLockTimeout) => void;
  setHasSeenAppOnboarding: (seen: boolean) => void;
  setLastSeenOnboardingVersion: (version: number) => void;
  setIsSettingsOpen: (open: boolean) => void;
  setActiveSettingsTab: (target: SettingsTarget) => void;
  setSettingsSection: (target: SettingsTarget | null) => void;
  setSettingsAnchor: (anchor: string | null) => void;
  resetToDefaults: () => void;
}

const defaultSettings = {
  fontSize: 'medium' as FontSize,
  fontFamily: 'system-sans' as FontFamily,
  sidebarWidth: 280,
  rightPanelWidth: 288,
  compactMode: false,
  spellCheck: true,
  autoCapitalize: true,
  showWritingToolbar: true,
  showWordCount: false,
  lineHeight: 'comfortable' as LineHeight,
  editorWidth: 'wide' as EditorWidth,
  tagsEnabled: true,
  focusModeEnabled: false,
  showIconRail: true,
  iconRailSide: 'left' as IconRailSide,
  indexMode: 'overlay' as ChromeMode,
  agendaMode: 'overlay' as ChromeMode,
  showNoteHeader: true,
  showTabBar: true,
  showEditorFooter: true,
  showBacklinksPanel: true,
  quietHomeScreen: false,
  showSeasonalTouches: true,
  sortOption: 'name-asc' as SortOption,
  showFoldersSection: true,
  showBacklinksSection: true,
  showCalendarWidget: true,
  autoLockTimeout: 15 as AutoLockTimeout, // 15 minutes default
  hasSeenAppOnboarding: false,
  lastSeenOnboardingVersion: 0,
  isSettingsOpen: false,
  activeSettingsTab: 'general' as SettingsTab,
  settingsSection: null as SettingsTab | null,
  settingsAnchor: null as string | null,
};

const HOME_DECORATIONS = [
  'showWelcomeDots',
  'showWelcomeStats',
  'showWelcomeDate',
  'showAsteroidCursor',
];
const REMOVED_KEYS = ['backlinksEnabled', 'autoSaveDelay', 'showAutoSaveStatus', 'notesDirectory'];

const isChromeMode = (value: unknown): value is ChromeMode =>
  value === 'overlay' || value === 'pinned' || value === 'off';

const isIconRailSide = (value: unknown): value is IconRailSide =>
  value === 'left' || value === 'right';

/**
 * Bring a pre-2.0 payload onto the chrome-mode frame.
 *
 * 1.9.0 had no pin concept: `showRightPanel` was the visibility of a fixed
 * column and `showSidebar` was never persisted at all. Mapping either onto a
 * tri-state mode is a false equivalence — and reading `showRightPanel: true`
 * as "pinned" promotes that version's *default* into a decision the user never
 * made, landing the Index summoned and the Agenda parked. Both halves of the
 * frame move together instead, to the 2.0 default.
 *
 * `editorWidth` goes the same way: 1.9.0 persisted it while nothing read it, so
 * a stale 'medium' nobody chose would outrank 2.0's 'wide' and hand upgraders a
 * narrower column than a fresh install. It cannot be told apart by validity —
 * 'medium' is a perfectly valid width — so the chrome modes discriminate
 * instead: 2.0 always writes them and 1.9.0 never did. That also keeps this
 * function idempotent, which matters because `merge` re-runs it on every
 * hydration, including on payloads it has already migrated.
 *
 * A mode already in the payload is a real 2.0 choice and is always preserved.
 *
 * Version 2 removed settings. A switch someone had turned off folds into what
 * replaced it, so nothing they see changes: Backlinks off turns off both places
 * backlinks show, and any home screen decoration off turns on the quiet home
 * screen. The old keys are deleted, which keeps this idempotent too.
 *
 * Exported for tests because silently changing the app's whole frame on upgrade
 * is exactly the regression worth pinning down.
 */
export function migrateSettingsState(
  persisted: unknown,
  _version: number
): Record<string, unknown> {
  const legacy = (persisted ?? {}) as Record<string, unknown>;
  const state = { ...legacy };
  const predatesChromeModes = !isChromeMode(legacy.indexMode) && !isChromeMode(legacy.agendaMode);

  if (!isChromeMode(state.indexMode)) state.indexMode = defaultSettings.indexMode;
  if (!isChromeMode(state.agendaMode)) state.agendaMode = defaultSettings.agendaMode;
  if ('iconRailSide' in state && !isIconRailSide(state.iconRailSide)) {
    state.iconRailSide = defaultSettings.iconRailSide;
  }

  delete state.showSidebar;
  delete state.showRightPanel;
  delete state.showTimelineWidget;
  if (predatesChromeModes) delete state.editorWidth;

  if (state.backlinksEnabled === false) {
    state.showBacklinksPanel = false;
    state.showBacklinksSection = false;
  }
  if (HOME_DECORATIONS.some((key) => state[key] === false)) state.quietHomeScreen = true;
  for (const key of [...HOME_DECORATIONS, ...REMOVED_KEYS]) delete state[key];
  return state;
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      ...defaultSettings,

      setFontSize: (size) => set({ fontSize: size }),
      setFontFamily: (family) => set({ fontFamily: family }),
      setSidebarWidth: (width) => set({ sidebarWidth: width }),
      setRightPanelWidth: (width) => set({ rightPanelWidth: width }),
      setCompactMode: (compact) => set({ compactMode: compact }),
      setSpellCheck: (enabled) => set({ spellCheck: enabled }),
      setAutoCapitalize: (enabled) => set({ autoCapitalize: enabled }),
      setShowWritingToolbar: (show) => set({ showWritingToolbar: show }),
      setShowWordCount: (show) => set({ showWordCount: show }),
      setLineHeight: (height) => set({ lineHeight: height }),
      setEditorWidth: (width) => set({ editorWidth: width }),
      setTagsEnabled: (enabled) => set({ tagsEnabled: enabled }),
      setFocusModeEnabled: (enabled) => set({ focusModeEnabled: enabled }),
      setIconRailSide: (side) => set({ iconRailSide: side }),
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
      setQuietHomeScreen: (quiet) => set({ quietHomeScreen: quiet }),
      setShowCalendarWidget: (show) => set({ showCalendarWidget: show }),
      setAutoLockTimeout: (timeout) => set({ autoLockTimeout: timeout }),
      setHasSeenAppOnboarding: (seen) => set({ hasSeenAppOnboarding: seen }),
      setLastSeenOnboardingVersion: (version) => set({ lastSeenOnboardingVersion: version }),
      // Closing forgets the phone section, so Settings reopens at its list.
      setIsSettingsOpen: (open) =>
        set(open ? { isSettingsOpen: true } : { isSettingsOpen: false, settingsSection: null }),
      setActiveSettingsTab: (target) => {
        const { tab, anchor } = resolveSettingsTarget(target);
        set({ activeSettingsTab: tab, settingsAnchor: anchor });
      },
      setSettingsSection: (target) => {
        if (target === null) return set({ settingsSection: null });
        const { tab, anchor } = resolveSettingsTarget(target);
        set({ settingsSection: tab, activeSettingsTab: tab, settingsAnchor: anchor });
      },
      setSettingsAnchor: (anchor) => set({ settingsAnchor: anchor }),
      resetToDefaults: () => set(defaultSettings),
    }),
    {
      name: 'moldavite-settings',
      version: 2,
      migrate: migrateSettingsState,
      // Legacy payloads without a version can skip Zustand's migrate hook.
      // Normalize in merge as well, while preserving current actions/defaults.
      merge: (persistedState, currentState) => ({
        ...currentState,
        ...migrateSettingsState(persistedState, 0),
      }),
      partialize: (state) => ({
        // Only persist actual settings, not UI state
        fontSize: state.fontSize,
        fontFamily: state.fontFamily,
        sidebarWidth: state.sidebarWidth,
        rightPanelWidth: state.rightPanelWidth,
        compactMode: state.compactMode,
        spellCheck: state.spellCheck,
        autoCapitalize: state.autoCapitalize,
        showWritingToolbar: state.showWritingToolbar,
        showWordCount: state.showWordCount,
        lineHeight: state.lineHeight,
        editorWidth: state.editorWidth,
        tagsEnabled: state.tagsEnabled,
        focusModeEnabled: state.focusModeEnabled,
        showIconRail: state.showIconRail,
        iconRailSide: state.iconRailSide,
        indexMode: state.indexMode,
        agendaMode: state.agendaMode,
        showNoteHeader: state.showNoteHeader,
        showTabBar: state.showTabBar,
        showEditorFooter: state.showEditorFooter,
        showBacklinksPanel: state.showBacklinksPanel,
        quietHomeScreen: state.quietHomeScreen,
        showSeasonalTouches: state.showSeasonalTouches,
        sortOption: state.sortOption,
        showFoldersSection: state.showFoldersSection,
        showBacklinksSection: state.showBacklinksSection,
        showCalendarWidget: state.showCalendarWidget,
        autoLockTimeout: state.autoLockTimeout,
        hasSeenAppOnboarding: state.hasSeenAppOnboarding,
        lastSeenOnboardingVersion: state.lastSeenOnboardingVersion,
      }),
    }
  )
);

export function applyFontSize(size: FontSize) {
  const sizes = {
    small: '14px',
    medium: '16px',
    large: '18px',
    'extra-large': '20px',
  };
  document.documentElement.style.setProperty('--editor-font-size', sizes[size]);
}

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
 * Wired to `--editor-measure`, which both `.tiptap` and the note header read.
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

export function applyCompactMode(compact: boolean) {
  if (compact) {
    document.documentElement.classList.add('compact-mode');
  } else {
    document.documentElement.classList.remove('compact-mode');
  }
}

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

// On a phone the icon rail focus mode hides is the only way back to Settings.
export function applyFocusMode(enabled: boolean) {
  if (enabled && !isMobilePlatform()) {
    document.documentElement.classList.add('focus-mode');
  } else {
    document.documentElement.classList.remove('focus-mode');
  }
}

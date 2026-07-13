import { useEffect } from 'react';
import {
  Layout,
  ToastContainer,
  UpdateNotification,
  WhatsNewModal,
  CalendarOnboardingModal,
  AppOnboardingModal,
} from './components';
import { QuickSwitcher } from './components/quick-switcher';
import { ShortcutHelpHost } from './components/ShortcutHelpModal';
import { GraphView } from './components/graph';
import { PluginDialogHostLoader } from './components/plugins/PluginDialogHostLoader';
import {
  useThemeStore,
  applyTheme,
  useSettingsStore,
  applyFontSize,
  applyLineHeight,
  applyCompactMode,
  applyFontFamily,
  useNoteColorsStore,
  useSemanticStore,
} from './stores';
import { fixNotePermissions } from './lib/fileSystem';
import { useAutoLock, useForgeWatcher, usePluginDeepLinks, usePluginHost } from './hooks';

function App() {
  const { theme, preset } = useThemeStore();
  const { fontSize, fontFamily, lineHeight, compactMode } = useSettingsStore();
  const { loadColors } = useNoteColorsStore();

  // Auto-lock: Monitor inactivity and re-lock notes after timeout
  useAutoLock();

  // Forge watcher: refresh notes list when files change on disk
  useForgeWatcher();

  // Plugin host: load enabled plugins for the active Forge on startup
  usePluginHost();

  // Website install links: subscribe first, then drain cold-start requests.
  usePluginDeepLinks();

  // Fix note permissions on startup (privacy improvement)
  useEffect(() => {
    fixNotePermissions().catch(console.error);
  }, []);

  // Load note colors on startup
  useEffect(() => {
    loadColors();
  }, [loadColors]);

  // Semantic search: fetch status + subscribe to progress events (idempotent)
  const initializeSemantic = useSemanticStore((s) => s.initialize);
  useEffect(() => {
    void initializeSemantic();
  }, [initializeSemantic]);

  // Apply theme on mount and when it changes
  useEffect(() => {
    applyTheme(theme, preset);

    // Listen for system theme changes
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const handleChange = () => {
      if (theme === 'system') {
        applyTheme('system', preset);
      }
    };

    mediaQuery.addEventListener('change', handleChange);
    return () => mediaQuery.removeEventListener('change', handleChange);
  }, [theme, preset]);

  // Apply settings on mount and when they change
  useEffect(() => {
    applyFontSize(fontSize);
  }, [fontSize]);

  useEffect(() => {
    applyFontFamily(fontFamily);
  }, [fontFamily]);

  useEffect(() => {
    applyLineHeight(lineHeight);
  }, [lineHeight]);

  useEffect(() => {
    applyCompactMode(compactMode);
  }, [compactMode]);

  return (
    <>
      <Layout />
      <ToastContainer />
      <UpdateNotification />
      <WhatsNewModal />
      <CalendarOnboardingModal />
      <AppOnboardingModal />
      <QuickSwitcher />
      <GraphView />
      <ShortcutHelpHost />
      <PluginDialogHostLoader />
    </>
  );
}

export default App;

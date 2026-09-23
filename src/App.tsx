import { lazy, Suspense, useEffect } from 'react';
import { isTauri } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
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
import { ChromeShortcutHost } from './components/ChromeShortcutHost';
import { GraphView } from './components/graph';
import { PluginDialogHostLoader } from './components/plugins/PluginDialogHostLoader';
import {
  useThemeStore,
  applyTheme,
  useSettingsStore,
  applyFontSize,
  applyLineHeight,
  applyCompactMode,
  applyEditorWidth,
  applyFocusMode,
  applyFontFamily,
  useNoteColorsStore,
  useSemanticStore,
} from './stores';
import { fixNotePermissions } from './lib/fileSystem';
import { isMobilePlatform } from './lib/platform';
import { syncMobileAppearance } from './lib/mobileAppearance';
import {
  initializeNotes,
  useAutoLock,
  useForgeWatcher,
  usePluginDeepLinks,
  usePluginHost,
} from './hooks';
import { flushAutosaveWhenHidden, registerAutosaveCloseGuard } from './lib/autosaveFlush';
import { useForgeReadinessStore, watchForgeReadiness } from './lib/forgeReadiness';
import { ForgeReadinessScreen } from './components/ui/ForgeReadinessScreen';

const SettingsModal = lazy(() =>
  import('./components/settings').then((module) => ({ default: module.SettingsModal }))
);

function App() {
  const { theme, preset } = useThemeStore();
  const { fontSize, fontFamily, lineHeight, compactMode, focusModeEnabled, editorWidth } =
    useSettingsStore();
  const { loadColors } = useNoteColorsStore();
  const forgeStatus = useForgeReadinessStore((state) => state.status);

  useAutoLock();

  useForgeWatcher();

  usePluginHost();

  // Website install links: subscribe first, then drain cold-start requests.
  usePluginDeepLinks();

  useEffect(() => watchForgeReadiness(), []);

  // The one note-list load for the window; components that use useNotes share it.
  // The synced Forge cannot be read until iCloud is ready, so everything that
  // reads it waits for that.
  useEffect(() => {
    if (forgeStatus !== 'ready') return;
    void initializeNotes();
    fixNotePermissions().catch(console.error);
    loadColors();
  }, [forgeStatus, loadColors]);

  useEffect(() => flushAutosaveWhenHidden(), []);

  // Semantic search: fetch status + subscribe to progress events (idempotent)
  const initializeSemantic = useSemanticStore((s) => s.initialize);
  useEffect(() => {
    void initializeSemantic();
  }, [initializeSemantic]);

  // Native close must wait for path-changing operations and their held edits.
  useEffect(() => {
    if (!isTauri()) return;

    const appWindow = getCurrentWindow();
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void registerAutosaveCloseGuard(appWindow)
      .then((stopListening) => {
        if (disposed) stopListening();
        else unlisten = stopListening;
      })
      .catch((error) => console.error('[App] Failed to register close guard:', error));

    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  useEffect(() => {
    applyTheme(theme, preset);
    void syncMobileAppearance(theme).catch((error) =>
      console.error('[App] Failed to apply native appearance:', error)
    );

    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const handleChange = () => {
      if (theme === 'system') {
        applyTheme('system', preset);
      }
    };

    mediaQuery.addEventListener('change', handleChange);
    return () => mediaQuery.removeEventListener('change', handleChange);
  }, [theme, preset]);

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

  useEffect(() => {
    applyEditorWidth(editorWidth);
  }, [editorWidth]);

  useEffect(() => {
    applyFocusMode(focusModeEnabled);
  }, [focusModeEnabled]);

  return (
    <>
      {forgeStatus === 'ready' ? <Layout /> : <ForgeReadinessScreen />}
      <ToastContainer />
      {isMobilePlatform() && (
        <div className="mobile-field-keyboard-bar">
          <button
            type="button"
            onPointerDown={(event) => event.preventDefault()}
            onClick={() => (document.activeElement as HTMLElement | null)?.blur()}
          >
            Done
          </button>
        </div>
      )}
      {!isMobilePlatform() && <UpdateNotification />}
      {!isMobilePlatform() && <WhatsNewModal />}
      {!isMobilePlatform() && <CalendarOnboardingModal />}
      <AppOnboardingModal />
      <QuickSwitcher />
      <GraphView />
      <ShortcutHelpHost />
      <ChromeShortcutHost />
      <Suspense fallback={null}>
        <SettingsModal />
      </Suspense>
      <PluginDialogHostLoader />
    </>
  );
}

export default App;

import { useEffect } from 'react';
import { Layout, ToastContainer, UpdateNotification, CalendarOnboardingModal } from './components';
import { useThemeStore, applyTheme, useSettingsStore, applyFontSize, applyLineHeight, applyCompactMode, applyFontFamily, useNoteColorsStore } from './stores';
import { fixNotePermissions } from './lib/fileSystem';

function App() {
  const { theme } = useThemeStore();
  const { fontSize, fontFamily, lineHeight, compactMode } = useSettingsStore();
  const { loadColors } = useNoteColorsStore();

  // Fix note permissions on startup (privacy improvement)
  useEffect(() => {
    fixNotePermissions().catch(console.error);
  }, []);

  // Load note colors on startup
  useEffect(() => {
    loadColors();
  }, [loadColors]);

  // Apply theme on mount and when it changes
  useEffect(() => {
    applyTheme(theme);

    // Listen for system theme changes
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const handleChange = () => {
      if (theme === 'system') {
        applyTheme('system');
      }
    };

    mediaQuery.addEventListener('change', handleChange);
    return () => mediaQuery.removeEventListener('change', handleChange);
  }, [theme]);

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
      <CalendarOnboardingModal />
    </>
  );
}

export default App;

import React, { useEffect } from 'react';
import { Layout, ToastContainer } from './components';
import { useThemeStore, applyTheme, useSettingsStore, applyFontSize, applyLineHeight, applyCompactMode } from './stores';

function App() {
  const { theme } = useThemeStore();
  const { fontSize, lineHeight, compactMode } = useSettingsStore();

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
    applyLineHeight(lineHeight);
  }, [lineHeight]);

  useEffect(() => {
    applyCompactMode(compactMode);
  }, [compactMode]);

  return (
    <>
      <Layout />
      <ToastContainer />
    </>
  );
}

export default App;

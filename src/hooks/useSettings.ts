import { useEffect } from 'react';
import {
  useSettingsStore,
  applyFontSize,
  applyLineHeight,
  applyCompactMode,
} from '@/stores';

export function useSettings() {
  const settings = useSettingsStore();

  // Apply visual settings on mount and when they change
  useEffect(() => {
    applyFontSize(settings.fontSize);
  }, [settings.fontSize]);

  useEffect(() => {
    applyLineHeight(settings.lineHeight);
  }, [settings.lineHeight]);

  useEffect(() => {
    applyCompactMode(settings.compactMode);
  }, [settings.compactMode]);

  return settings;
}

// Hook to open/close settings modal
export function useSettingsModal() {
  const { isSettingsOpen, setIsSettingsOpen } = useSettingsStore();

  const openSettings = () => setIsSettingsOpen(true);
  const closeSettings = () => setIsSettingsOpen(false);
  const toggleSettings = () => setIsSettingsOpen(!isSettingsOpen);

  return {
    isOpen: isSettingsOpen,
    openSettings,
    closeSettings,
    toggleSettings,
  };
}

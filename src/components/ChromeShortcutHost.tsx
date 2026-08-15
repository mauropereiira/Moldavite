import { useEffect } from 'react';
import { useGraphStore, useOverlayStore, useQuickSwitcherStore, useSettingsStore } from '@/stores';

/**
 * Keyboard handling for the navigation surfaces — ⌘\ (Index), ⌘⌥\ (Agenda),
 * ⌘P (Search), ⌘⇧G (Graph), Esc (close the active one) — and ⌘. (focus mode).
 * Mount once near the app root.
 *
 * The listener lives here rather than in `useKeyboardShortcuts` for the same
 * reason `ShortcutHelpHost` does: that hook is owned by the editor tree, which
 * is not mounted when no note is open or when the Timeline has replaced the
 * editor pane — and those are exactly the moments you want a way out.
 *
 * Every surface toggles through `useOverlayStore`, so a shortcut behaves
 * identically to the matching icon-rail button.
 *
 * Registered in `src/lib/shortcuts.ts` so the help modal lists them.
 */
export function ChromeShortcutHost() {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && useOverlayStore.getState().activeOverlay) {
        e.preventDefault();
        useOverlayStore.getState().closeOverlay();
        return;
      }

      if (!(e.metaKey || e.ctrlKey)) return;

      const key = e.key.toLowerCase();
      if (key === 'p' && !e.altKey && !e.shiftKey) {
        e.preventDefault();
        useQuickSwitcherStore.getState().toggle();
        return;
      }
      if (key === 'g' && e.shiftKey) {
        e.preventDefault();
        useGraphStore.getState().toggle();
        return;
      }

      // `e.key` for ⌥\ on macOS is the composed character «, not a backslash,
      // so match on the physical key instead.
      const isBackslash = e.code === 'Backslash';
      const isPeriod = e.code === 'Period';
      if (!isBackslash && !isPeriod) return;

      const s = useSettingsStore.getState();
      if (isBackslash && e.altKey) {
        if (s.agendaMode === 'off') return;
        e.preventDefault();
        useOverlayStore.getState().toggleAgenda(s.agendaMode === 'pinned');
      } else if (isBackslash) {
        if (s.indexMode === 'off') return;
        e.preventDefault();
        useOverlayStore.getState().toggleIndex(s.indexMode === 'pinned');
      } else if (isPeriod && !e.altKey) {
        e.preventDefault();
        s.setFocusModeEnabled(!s.focusModeEnabled);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  return null;
}

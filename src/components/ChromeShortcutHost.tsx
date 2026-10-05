import { useEffect } from 'react';
import { isPrimaryModifier } from '@/lib/shortcuts';
import { isMobilePlatform } from '@/lib/platform';
import { openFileWithDialog } from '@/lib/looseFiles';
import { routeNoteRequest } from '@/hooks/usePluginDeepLinks';
import { useNotes } from '@/hooks/useNotes';
import {
  useGraphStore,
  useNoteSelectionStore,
  useNoteStore,
  useOverlayStore,
  useQuickSwitcherStore,
  useSettingsStore,
} from '@/stores';

/**
 * Esc leaves the open note, landing back on the wordmark screen when it was the
 * last one. Esc is the most contested key in the app, so it only acts when
 * nothing else wants it: no handler has already claimed the event (ProseMirror
 * marks its own suggestion menus that way), no dialog is on screen, no bulk
 * selection is waiting to be cleared, and focus is in the note itself rather
 * than in a field, a menu, or a toolbar button.
 */
function closeActiveNote(event: KeyboardEvent) {
  if (event.defaultPrevented) return;
  if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;

  const target = event.target as HTMLElement | null;
  const inNote = target === document.body || Boolean(target?.closest?.('.tiptap'));
  if (!inNote) return;
  if (document.querySelector('[role="dialog"], [aria-modal="true"]')) return;
  if (useNoteSelectionStore.getState().selectedIds.size > 0) return;

  const { activeTabId, closeTab } = useNoteStore.getState();
  if (!activeTabId) return;
  event.preventDefault();
  closeTab(activeTabId);
}

/**
 * Keyboard handling for the navigation surfaces — ⌘\ (Index), ⌘⌥\ (Agenda),
 * ⌘P (Search), ⌘⇧G (Graph), Esc (close the active one, or the open note when
 * none is up) — ⌘. (focus mode) and ⌘O (open a Markdown file). Mount once near
 * the app root.
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
  const { loadNote, refresh } = useNotes();

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (useOverlayStore.getState().activeOverlay) {
          e.preventDefault();
          useOverlayStore.getState().closeOverlay();
        } else {
          closeActiveNote(e);
        }
        return;
      }

      if (!isPrimaryModifier(e)) return;

      const key = e.key.toLowerCase();
      if (key === 'p' && !e.altKey && !e.shiftKey) {
        e.preventDefault();
        useQuickSwitcherStore.getState().toggle();
        return;
      }
      if (key === 'o' && !e.altKey && !e.shiftKey && !isMobilePlatform()) {
        e.preventDefault();
        void openFileWithDialog((rel) => routeNoteRequest(rel, loadNote, refresh));
        return;
      }
      if (key === 'g' && e.shiftKey && !e.altKey) {
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
  }, [loadNote, refresh]);

  return null;
}

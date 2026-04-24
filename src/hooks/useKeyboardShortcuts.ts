import { useEffect, useState, useCallback } from 'react';
import type { Editor } from '@tiptap/react';
import { safeInvoke as invoke } from '@/lib/ipc';
import { useSettingsStore, useNoteStore } from '@/stores';
import { useQuickSwitcherStore } from '@/stores/quickSwitcherStore';
import { useGraphStore } from '@/stores/graphStore';
import { filenameToNote, markdownToHtml, applyTemplate } from '@/lib';
import { SHORTCUTS, type ShortcutId } from '@/lib/shortcuts';
import { useToast } from './useToast';
import type { NoteFile } from '@/types';

interface ShortcutOptions {
  editor: Editor | null;
  onNewNote?: () => void;
  onToggleTheme?: () => void;
  onInsertLink?: () => void;
}

/**
 * Manages global keyboard shortcuts for the application.
 *
 * The shortcut registry lives in `@/lib/shortcuts.ts`. This hook dispatches
 * each event to the correct handler by matching on shortcut id. Adding a new
 * shortcut therefore requires two edits:
 *   1. Append an entry to `SHORTCUTS` in `shortcuts.ts` (updates the help modal)
 *   2. Add a case for its `id` in `runShortcut` below (wires the handler)
 *
 * @param options - Configuration including editor instance and callback handlers
 * @returns Template picker state and handlers
 */
export function useKeyboardShortcuts({
  editor,
  onNewNote,
  onToggleTheme,
  onInsertLink,
}: ShortcutOptions) {
  const { setIsSettingsOpen } = useSettingsStore();
  const { setCurrentNote, notes, setNotes, activeTabId, closeTab, openTabs, switchTab } = useNoteStore();
  const { open: openQuickSwitcher } = useQuickSwitcherStore();
  const { toggle: toggleGraph } = useGraphStore();
  const toast = useToast();
  const [showTemplatePicker, setShowTemplatePicker] = useState(false);

  /**
   * Applies a template to the current note, or creates a new note if none is open.
   * @param templateId - The template to use, or null to cancel
   */
  const handleTemplateSelect = useCallback(async (templateId: string | null) => {
    setShowTemplatePicker(false);

    if (!templateId) return;

    // Get current note from store
    const { currentNote } = useNoteStore.getState();

    try {
      if (currentNote && editor) {
        // Apply template to current note - update editor directly
        const markdownContent = await applyTemplate(templateId);
        const htmlContent = markdownToHtml(markdownContent);
        editor.commands.setContent(htmlContent);
        toast.success('Template applied');
      } else {
        // No note open - create a new note from template
        const timestamp = new Date().toISOString().slice(0, 19).replace(/[:.]/g, '-');
        const filename = `Note ${timestamp}.md`;

        await invoke('create_note_from_template', {
          filename,
          templateId,
          isDaily: false
        });

        const noteFile: NoteFile = {
          name: filename,
          path: filename,
          isDaily: false,
          isWeekly: false,
          isLocked: false,
        };

        setNotes([...notes, noteFile]);

        const readContent = await invoke<string>('read_note', {
          filename,
          isDaily: false
        });

        const htmlContent = markdownToHtml(readContent);
        const note = filenameToNote(noteFile, htmlContent);
        setCurrentNote(note);

        toast.success('Note created from template');
      }
    } catch (error) {
      console.error('[useKeyboardShortcuts] Failed to apply template:', error);
      toast.error('Failed to apply template');
    }
  }, [editor, notes, setNotes, setCurrentNote, toast]);

  // Close template picker
  const handleTemplatePickerClose = useCallback(() => {
    setShowTemplatePicker(false);
  }, []);

  // Open template picker programmatically
  const openTemplatePicker = useCallback(() => {
    setShowTemplatePicker(true);
  }, []);

  useEffect(() => {
    /**
     * Resolve a KeyboardEvent to a known shortcut id, or null if none matched.
     * Centralising this logic here keeps the dispatch table below tidy and
     * ensures the help modal and handler agree on what each combo means.
     */
    const identify = (e: KeyboardEvent): ShortcutId | null => {
      const isMod = e.metaKey || e.ctrlKey;
      const key = e.key.toLowerCase();

      // Cmd+/ (help modal) is intentionally NOT handled here — it's owned by
      // `ShortcutHelpHost`, which mounts at the app root so the help modal
      // is reachable even when no editor is mounted.
      if (isMod && (key === 'p')) return 'quickSwitcher';
      if (isMod && key === ',') return 'settings';
      if (isMod && key === 'n') return 'newNote';
      if (isMod && e.shiftKey && key === 'l') return 'toggleTheme';
      if (isMod && e.shiftKey && key === 'g') return 'toggleGraph';
      if (isMod && key === 'w') return 'closeTab';
      if (isMod && key === 't') return 'templatePicker';
      if (isMod && key === 'k') return 'insertLink';
      if (isMod && e.altKey && (key === 'arrowright' || key === 'arrowdown')) return 'nextTab';
      if (isMod && e.altKey && (key === 'arrowleft' || key === 'arrowup')) return 'prevTab';
      // Cmd+F is also owned by this list (registered in SHORTCUTS), but the
      // actual focus handler lives in Sidebar.tsx since that's where the
      // input ref is. We intentionally don't handle it here.
      return null;
    };

    const runShortcut = (id: ShortcutId, e: KeyboardEvent) => {
      switch (id) {
        case 'quickSwitcher':
          e.preventDefault();
          openQuickSwitcher();
          return;
        case 'settings':
          e.preventDefault();
          setIsSettingsOpen(true);
          return;
        case 'newNote':
          e.preventDefault();
          onNewNote?.();
          return;
        case 'toggleTheme':
          e.preventDefault();
          onToggleTheme?.();
          return;
        case 'toggleGraph':
          e.preventDefault();
          toggleGraph();
          return;
        case 'closeTab':
          e.preventDefault();
          if (activeTabId) closeTab(activeTabId);
          return;
        case 'templatePicker':
          e.preventDefault();
          setShowTemplatePicker(true);
          return;
        case 'insertLink':
          if (!editor) return;
          e.preventDefault();
          onInsertLink?.();
          return;
        case 'nextTab':
        case 'prevTab': {
          if (openTabs.length < 2 || !activeTabId) return;
          e.preventDefault();
          const idx = openTabs.findIndex((t) => t.id === activeTabId);
          if (idx === -1) return;
          const delta = id === 'nextTab' ? 1 : -1;
          const nextIdx = (idx + delta + openTabs.length) % openTabs.length;
          switchTab(openTabs[nextIdx].id);
          return;
        }
        // Shortcuts listed in SHORTCUTS but handled elsewhere (e.g. 'search').
        default:
          return;
      }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      const id = identify(e);
      if (!id) return;
      // Defense: make sure the id we dispatched on is actually registered in
      // the public list; helps catch drift if someone edits the dispatcher
      // without updating shortcuts.ts.
      if (!SHORTCUTS.some((s) => s.id === id)) return;
      runShortcut(id, e);
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [
    editor,
    onNewNote,
    onToggleTheme,
    onInsertLink,
    setIsSettingsOpen,
    activeTabId,
    closeTab,
    openTabs,
    switchTab,
    openQuickSwitcher,
    toggleGraph,
  ]);

  return {
    showTemplatePicker,
    handleTemplateSelect,
    handleTemplatePickerClose,
    openTemplatePicker,
  };
}

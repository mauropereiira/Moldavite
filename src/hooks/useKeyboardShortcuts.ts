import { useEffect, useState, useCallback } from 'react';
import type { Editor } from '@tiptap/react';
import { invoke } from '@tauri-apps/api/core';
import { useSettingsStore, useNoteStore } from '@/stores';
import { useQuickSwitcherStore } from '@/stores/quickSwitcherStore';
import { filenameToNote, markdownToHtml, applyTemplate } from '@/lib';
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
 * Handles shortcuts for settings, new notes, theme toggling, templates, and editor operations.
 * @param options - Configuration including editor instance and callback handlers
 * @returns Template picker state and handlers
 */
export function useKeyboardShortcuts({ editor, onNewNote, onToggleTheme, onInsertLink }: ShortcutOptions) {
  const { setIsSettingsOpen } = useSettingsStore();
  const { setCurrentNote, notes, setNotes, activeTabId, closeTab } = useNoteStore();
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

  const { open: openQuickSwitcher } = useQuickSwitcherStore();

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const isMod = e.metaKey || e.ctrlKey;

      // Cmd/Ctrl + P: Quick Switcher (also Cmd+K when not focused on editor)
      if (isMod && (e.key === 'p' || e.key === 'P')) {
        e.preventDefault();
        openQuickSwitcher();
        return;
      }

      // Cmd/Ctrl + ,: Open settings
      if (isMod && e.key === ',') {
        e.preventDefault();
        setIsSettingsOpen(true);
        return;
      }

      // Cmd/Ctrl + N: New note
      if (isMod && e.key === 'n') {
        e.preventDefault();
        onNewNote?.();
        return;
      }

      // Cmd/Ctrl + Shift + L: Toggle theme
      if (isMod && e.shiftKey && e.key === 'l') {
        e.preventDefault();
        onToggleTheme?.();
        return;
      }

      // Cmd/Ctrl + W: Close active tab
      if (isMod && e.key === 'w') {
        e.preventDefault();
        if (activeTabId) {
          closeTab(activeTabId);
        }
        return;
      }

      // Cmd/Ctrl + T: Open template picker
      if (isMod && (e.key === 't' || e.key === 'T')) {
        e.preventDefault();
        setShowTemplatePicker(true);
        return;
      }

      // Editor shortcuts (only if editor exists)
      // Note: TipTap handles most formatting shortcuts natively (Bold, Italic, Underline, etc.)
      // We only handle custom shortcuts here that need special behavior
      if (!editor) return;

      // Cmd/Ctrl + K: Link (custom handler with modal)
      if (isMod && e.key === 'k') {
        e.preventDefault();
        onInsertLink?.();
        return;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [editor, onNewNote, onToggleTheme, onInsertLink, setIsSettingsOpen, activeTabId, closeTab, openQuickSwitcher]);

  return {
    showTemplatePicker,
    handleTemplateSelect,
    handleTemplatePickerClose,
    openTemplatePicker,
  };
}

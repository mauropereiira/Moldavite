import { useCallback, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useNoteStore, useTemplateStore } from '@/stores';
import {
  ensureDirectories,
  listNotes,
  readNote,
  writeNote,
  deleteNote,
  createNote as createNoteFile,
  getDailyNoteFilename,
  filenameToNote,
  markdownToHtml,
  htmlToMarkdown,
  isHtmlContent
} from '@/lib';
import type { NoteFile } from '@/types';
import { format } from 'date-fns';

/**
 * Checks if note content is effectively empty by stripping HTML tags.
 * @param content - The HTML content to check
 * @returns True if content contains no meaningful text
 */
function isContentEmpty(content: string): boolean {
  if (!content) return true;
  const textOnly = content
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .trim();
  return textOnly === '';
}

/**
 * Manages note operations including loading, creating, and deleting notes.
 * Handles both daily notes and standalone notes with automatic state synchronization.
 * @returns Note management functions and state
 */
export function useNotes() {
  const {
    notes,
    setNotes,
    currentNote,
    setCurrentNote,
    setIsLoading
  } = useNoteStore();

  // Get fresh state to avoid stale closures
  const getState = useNoteStore.getState;

  /**
   * Saves the current note to disk immediately before switching to another note.
   * Deletes daily notes if they're empty, converts HTML to Markdown before saving.
   * @throws {Error} If file operations fail
   */
  const flushCurrentNote = useCallback(async () => {
    const state = getState();
    const note = state.currentNote;
    if (!note) return;

    const filename = note.isDaily && note.date
      ? `${note.date}.md`
      : `${note.title}.md`;

    const isEmpty = isContentEmpty(note.content);
    const freshNotes = state.notes;

    if (note.isDaily) {
      const dateStr = note.date;
      const existsInList = freshNotes.some(n => n.isDaily && n.date === dateStr);

      if (isEmpty) {
        if (existsInList) {
          try {
            await deleteNote(filename, true);
            const updatedNotes = freshNotes.filter(n => !(n.isDaily && n.date === dateStr));
            setNotes(updatedNotes);
          } catch (error) {
            console.error('[useNotes] Flush: Delete failed:', error);
          }
        }
      } else {
        // Convert HTML to Markdown before saving
        const markdownContent = htmlToMarkdown(note.content);
        await writeNote(filename, markdownContent, true);
        if (!existsInList) {
          const noteFile: NoteFile = {
            name: filename,
            path: filename,
            isDaily: true,
            date: dateStr,
            isLocked: false,
          };
          setNotes([...freshNotes, noteFile]);
        }
      }
    } else {
      // Standalone note - just save
      // Convert HTML to Markdown before saving
      const markdownContent = htmlToMarkdown(note.content);
      await writeNote(filename, markdownContent, false);
    }
  }, [getState, setNotes]);

  /**
   * Initializes the note system by creating required directories and loading all notes.
   * Called automatically on mount.
   */
  const initialize = useCallback(async () => {
    try {
      setIsLoading(true);
      await ensureDirectories();
      const noteFiles = await listNotes();
      setNotes(noteFiles);
    } catch (error) {
      console.error('[useNotes] Failed to initialize:', error);
    } finally {
      setIsLoading(false);
    }
  }, [setNotes, setIsLoading]);

  /**
   * Loads a specific note from disk into the editor.
   * Automatically flushes the current note before switching and converts Markdown to HTML.
   * @param noteFile - The note file to load
   */
  const loadNote = useCallback(async (noteFile: NoteFile) => {
    try {
      // Flush current note before switching
      await flushCurrentNote();

      setIsLoading(true);
      const rawContent = await readNote(noteFile.name, noteFile.isDaily);

      // Convert Markdown to HTML for the editor
      // Check if content is already HTML (backwards compatibility with old format)
      let htmlContent: string;
      if (isHtmlContent(rawContent)) {
        htmlContent = rawContent;
      } else {
        htmlContent = markdownToHtml(rawContent);
      }

      const note = filenameToNote(noteFile, htmlContent);
      setCurrentNote(note);
    } catch (error) {
      console.error('[useNotes] Failed to load note:', error);
    } finally {
      setIsLoading(false);
    }
  }, [flushCurrentNote, setCurrentNote, setIsLoading]);

  /**
   * Loads or creates a daily note for the specified date.
   * If a default daily template is set, applies it to new daily notes.
   * @param date - The date for the daily note
   */
  const loadDailyNote = useCallback(async (date: Date) => {
    const filename = getDailyNoteFilename(date);
    const dateStr = format(date, 'yyyy-MM-dd');

    // Flush current note before switching
    await flushCurrentNote();

    // Get fresh notes from store to avoid stale closure
    const currentNotes = getState().notes;

    // Check if note exists
    const existingNote = currentNotes.find(n => n.isDaily && n.date === dateStr);

    if (existingNote) {
      await loadNote(existingNote);
    } else {
      // Check for default daily template
      const { defaultDailyTemplate } = useTemplateStore.getState();

      if (defaultDailyTemplate) {
        // Create note from default template
        try {
          await invoke('create_note_from_template', {
            filename,
            templateId: defaultDailyTemplate,
            isDaily: true
          });

          const noteFile: NoteFile = {
            name: filename,
            path: filename,
            isDaily: true,
            date: dateStr,
            isLocked: false,
          };

          // Add to notes list
          setNotes([...currentNotes, noteFile]);

          // Load the created note
          await loadNote(noteFile);
        } catch (error) {
          console.error('[useNotes] Failed to create daily note from template:', error);
          // Fall back to creating virtual note
          const noteFile: NoteFile = {
            name: filename,
            path: filename,
            isDaily: true,
            date: dateStr,
            isLocked: false,
          };
          const note = filenameToNote(noteFile, '');
          setCurrentNote(note);
        }
      } else {
        // Create virtual note in memory (don't create file yet)
        // File will be created by auto-save when user types content
        const noteFile: NoteFile = {
          name: filename,
          path: filename,
          isDaily: true,
          date: dateStr,
          isLocked: false,
        };
        const note = filenameToNote(noteFile, '');
        setCurrentNote(note);
      }
    }
  }, [flushCurrentNote, getState, loadNote, setCurrentNote, setNotes]);

  /**
   * Creates a new standalone note with the specified title.
   * @param title - The title for the new note
   * @throws {Error} If note creation fails
   */
  const createNote = useCallback(async (title: string) => {
    try {
      setIsLoading(true);
      const filename = await createNoteFile(title);
      const noteFile: NoteFile = {
        name: filename,
        path: filename,
        isDaily: false,
        isLocked: false,
      };
      // Get fresh notes to avoid stale closure
      const freshNotes = getState().notes;
      // Check if already exists (prevent duplicates)
      if (!freshNotes.find(n => n.name === filename)) {
        setNotes([...freshNotes, noteFile]);
      }
      const note = filenameToNote(noteFile, '');
      setCurrentNote(note);
    } catch (error) {
      console.error('[useNotes] Failed to create note:', error);
    } finally {
      setIsLoading(false);
    }
  }, [getState, setNotes, setCurrentNote, setIsLoading]);

  /**
   * Creates a new note from a template.
   * @param title - The title/filename for the new note
   * @param templateId - The ID of the template to use
   * @param isDaily - Whether this is a daily note
   * @throws {Error} If note creation or template application fails
   */
  const createFromTemplate = useCallback(async (
    title: string,
    templateId: string,
    isDaily: boolean = false
  ) => {
    try {
      setIsLoading(true);
      const filename = isDaily ? `${title}.md` : `${title}.md`;

      // Call Tauri command to create note from template
      await invoke('create_note_from_template', {
        filename,
        templateId,
        isDaily
      });

      // Create note file object
      const noteFile: NoteFile = {
        name: filename,
        path: filename,
        isDaily,
        date: isDaily ? title : undefined,
        isLocked: false,
      };

      // Get fresh notes to avoid stale closure
      const freshNotes = getState().notes;
      // Check if already exists (prevent duplicates)
      if (!freshNotes.find(n => n.name === filename)) {
        setNotes([...freshNotes, noteFile]);
      }

      // Load the created note
      await loadNote(noteFile);
    } catch (error) {
      console.error('[useNotes] Failed to create note from template:', error);
      throw error;
    } finally {
      setIsLoading(false);
    }
  }, [getState, setNotes, loadNote, setIsLoading]);

  /**
   * Deletes the currently loaded note from disk and removes it from the note list.
   * @throws {Error} If note deletion fails
   */
  const deleteCurrentNote = useCallback(async () => {
    const state = getState();
    const note = state.currentNote;
    if (!note) return;

    const filename = note.isDaily && note.date
      ? `${note.date}.md`
      : `${note.title}.md`;

    try {
      setIsLoading(true);
      await deleteNote(filename, note.isDaily || false);

      // Remove from notes list
      const freshNotes = state.notes;
      let updatedNotes: NoteFile[];
      if (note.isDaily && note.date) {
        updatedNotes = freshNotes.filter(n => !(n.isDaily && n.date === note.date));
      } else {
        updatedNotes = freshNotes.filter(n => n.path !== note.id);
      }
      setNotes(updatedNotes);

      // Clear current note
      setCurrentNote(null);
    } catch (error) {
      console.error('[useNotes] Failed to delete note:', error);
      throw error;
    } finally {
      setIsLoading(false);
    }
  }, [getState, setNotes, setCurrentNote, setIsLoading]);

  // Initialize on mount
  useEffect(() => {
    initialize();
  }, [initialize]);

  return {
    notes,
    currentNote,
    loadNote,
    loadDailyNote,
    createNote,
    createFromTemplate,
    deleteCurrentNote,
    refresh: initialize,
  };
}

import { useCallback, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useNoteStore, useTemplateStore, useTaskStatusStore } from '@/stores';
import {
  ensureDirectories,
  listNotes,
  readNote,
  writeNote,
  deleteNote,
  createNote as createNoteFile,
  getDailyNoteFilename,
  getWeeklyNoteFilename,
  filenameToNote,
  markdownToHtml,
  htmlToMarkdown,
  isHtmlContent,
  isContentEmpty,
  parseTaskStatus,
} from '@/lib';
import type { NoteFile } from '@/types';
import { format, getISOWeek, getISOWeekYear } from 'date-fns';

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
    setIsLoading,
    openTab
  } = useNoteStore();

  // Get fresh state to avoid stale closures
  const getState = useNoteStore.getState;

  /**
   * Saves the current note to disk immediately before switching to another note.
   * Deletes daily/weekly notes if they're empty, converts HTML to Markdown before saving.
   * @throws {Error} If file operations fail
   */
  const flushCurrentNote = useCallback(async () => {
    const state = getState();
    const note = state.currentNote;
    if (!note) return;

    let filename: string;
    if (note.isDaily && note.date) {
      filename = `${note.date}.md`;
    } else if (note.isWeekly && note.week) {
      filename = `${note.week}.md`;
    } else {
      filename = `${note.title}.md`;
    }

    const isEmpty = isContentEmpty(note.content);
    const freshNotes = state.notes;

    if (note.isDaily) {
      const dateStr = note.date;
      const existsInList = freshNotes.some(n => n.isDaily && n.date === dateStr);

      if (isEmpty) {
        if (existsInList) {
          try {
            await deleteNote(filename, true, false);
            const updatedNotes = freshNotes.filter(n => !(n.isDaily && n.date === dateStr));
            setNotes(updatedNotes);
          } catch (error) {
            console.error('[useNotes] Flush: Delete failed:', error);
          }
        }
      } else {
        // Convert HTML to Markdown before saving
        const markdownContent = htmlToMarkdown(note.content);
        await writeNote(filename, markdownContent, true, false);
        if (!existsInList) {
          const noteFile: NoteFile = {
            name: filename,
            path: filename,
            isDaily: true,
            isWeekly: false,
            date: dateStr,
            isLocked: false,
          };
          setNotes([...freshNotes, noteFile]);
        }
      }
    } else if (note.isWeekly) {
      const weekStr = note.week;
      const existsInList = freshNotes.some(n => n.isWeekly && n.week === weekStr);

      if (isEmpty) {
        if (existsInList) {
          try {
            await deleteNote(filename, false, true);
            const updatedNotes = freshNotes.filter(n => !(n.isWeekly && n.week === weekStr));
            setNotes(updatedNotes);
          } catch (error) {
            console.error('[useNotes] Flush: Delete weekly note failed:', error);
          }
        }
      } else {
        // Convert HTML to Markdown before saving
        const markdownContent = htmlToMarkdown(note.content);
        await writeNote(filename, markdownContent, false, true);
        if (!existsInList) {
          const noteFile: NoteFile = {
            name: filename,
            path: `weekly/${filename}`,
            isDaily: false,
            isWeekly: true,
            week: weekStr,
            isLocked: false,
          };
          setNotes([...freshNotes, noteFile]);
        }
      }
    } else {
      // Standalone note - just save
      // Convert HTML to Markdown before saving
      const markdownContent = htmlToMarkdown(note.content);
      await writeNote(filename, markdownContent, false, false);
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

      // Build task status cache for daily notes (non-blocking)
      const dailyNotes = noteFiles.filter(n => n.isDaily && n.date);
      const { setTaskStatus } = useTaskStatusStore.getState();

      // Process daily notes in the background
      Promise.all(
        dailyNotes.map(async (noteFile) => {
          try {
            const rawContent = await readNote(noteFile.name, true, false);
            const htmlContent = isHtmlContent(rawContent) ? rawContent : markdownToHtml(rawContent);
            const status = parseTaskStatus(htmlContent);
            if (status.totalTasks > 0 && noteFile.date) {
              setTaskStatus(noteFile.date, status);
            }
          } catch {
            // Silently skip notes that can't be parsed
          }
        })
      );
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
   * @param inNewTab - If true, opens in a new tab instead of replacing the current one
   */
  const loadNote = useCallback(async (noteFile: NoteFile, inNewTab: boolean = false) => {
    try {
      // Flush current note before switching
      await flushCurrentNote();

      setIsLoading(true);
      const rawContent = await readNote(noteFile.name, noteFile.isDaily, noteFile.isWeekly || false);

      // Convert Markdown to HTML for the editor
      // Check if content is already HTML (backwards compatibility with old format)
      let htmlContent: string;
      if (isHtmlContent(rawContent)) {
        htmlContent = rawContent;
      } else {
        htmlContent = markdownToHtml(rawContent);
      }

      // Update task status cache for daily notes
      if (noteFile.isDaily && noteFile.date) {
        const taskStatus = parseTaskStatus(htmlContent);
        useTaskStatusStore.getState().setTaskStatus(noteFile.date, taskStatus);
      }

      const note = filenameToNote(noteFile, htmlContent);
      openTab(note, inNewTab);
    } catch (error) {
      console.error('[useNotes] Failed to load note:', error);
    } finally {
      setIsLoading(false);
    }
  }, [flushCurrentNote, openTab, setIsLoading]);

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
            isWeekly: false,
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
            isWeekly: false,
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
          isWeekly: false,
          date: dateStr,
          isLocked: false,
        };
        const note = filenameToNote(noteFile, '');
        setCurrentNote(note);
      }
    }
  }, [flushCurrentNote, getState, loadNote, setCurrentNote, setNotes]);

  /**
   * Loads or creates a weekly note for the specified week.
   * If a default weekly template is set, applies it to new weekly notes.
   * @param date - Any date within the target week (uses ISO week numbering)
   */
  const loadWeeklyNote = useCallback(async (date: Date) => {
    const filename = getWeeklyNoteFilename(date);
    const weekYear = getISOWeekYear(date);
    const weekNum = getISOWeek(date);
    const weekStr = `${weekYear}-W${weekNum.toString().padStart(2, '0')}`;

    // Flush current note before switching
    await flushCurrentNote();

    // Get fresh notes from store to avoid stale closure
    const currentNotes = getState().notes;

    // Check if note exists
    const existingNote = currentNotes.find(n => n.isWeekly && n.week === weekStr);

    if (existingNote) {
      await loadNote(existingNote);
    } else {
      // Check for default weekly template (future feature)
      const { defaultWeeklyTemplate } = useTemplateStore.getState() as { defaultWeeklyTemplate?: string };

      if (defaultWeeklyTemplate) {
        // Create note from default template
        try {
          await invoke('create_note_from_template', {
            filename,
            templateId: defaultWeeklyTemplate,
            isDaily: false,
            isWeekly: true
          });

          const noteFile: NoteFile = {
            name: filename,
            path: `weekly/${filename}`,
            isDaily: false,
            isWeekly: true,
            week: weekStr,
            isLocked: false,
          };

          // Add to notes list
          setNotes([...currentNotes, noteFile]);

          // Load the created note
          await loadNote(noteFile);
        } catch (error) {
          console.error('[useNotes] Failed to create weekly note from template:', error);
          // Fall back to creating virtual note
          const noteFile: NoteFile = {
            name: filename,
            path: `weekly/${filename}`,
            isDaily: false,
            isWeekly: true,
            week: weekStr,
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
          path: `weekly/${filename}`,
          isDaily: false,
          isWeekly: true,
          week: weekStr,
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
   * @param folderPath - Optional folder path to create the note in
   * @throws {Error} If note creation fails
   */
  const createNote = useCallback(async (title: string, folderPath?: string | null) => {
    try {
      setIsLoading(true);
      const filename = await createNoteFile(title, folderPath || undefined);
      const noteFile: NoteFile = {
        name: filename.split('/').pop() || filename,
        path: `notes/${filename}`,
        isDaily: false,
        isWeekly: false,
        isLocked: false,
        folderPath: folderPath || undefined,
      };
      // Get fresh notes to avoid stale closure
      const freshNotes = getState().notes;
      // Check if already exists (prevent duplicates)
      if (!freshNotes.find(n => n.path === noteFile.path)) {
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
   * @param folderPath - Optional folder path to create the note in
   * @throws {Error} If note creation or template application fails
   */
  const createFromTemplate = useCallback(async (
    title: string,
    templateId: string,
    isDaily: boolean = false,
    folderPath?: string | null
  ) => {
    try {
      setIsLoading(true);
      const filename = isDaily ? `${title}.md` : `${title}.md`;
      const fullPath = folderPath ? `${folderPath}/${filename}` : filename;

      // Call Tauri command to create note from template
      await invoke('create_note_from_template', {
        filename: fullPath,
        templateId,
        isDaily
      });

      // Create note file object
      const noteFile: NoteFile = {
        name: filename,
        path: isDaily ? `daily/${filename}` : `notes/${fullPath}`,
        isDaily,
        isWeekly: false,
        date: isDaily ? title : undefined,
        isLocked: false,
        folderPath: folderPath || undefined,
      };

      // Get fresh notes to avoid stale closure
      const freshNotes = getState().notes;
      // Check if already exists (prevent duplicates)
      if (!freshNotes.find(n => n.path === noteFile.path)) {
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
   * Duplicates an existing note with " (copy)" suffix.
   * @param sourceNote - The note to duplicate
   * @throws {Error} If note duplication fails
   */
  const duplicateNote = useCallback(async (sourceNote: NoteFile) => {
    try {
      setIsLoading(true);
      // Flush current note first to ensure all content is saved to disk
      await flushCurrentNote();
      const newFilename = await invoke<string>('duplicate_note', {
        filename: sourceNote.name,
        isDaily: sourceNote.isDaily || false,
        isWeekly: sourceNote.isWeekly || false,
      });

      // Create note file object for the duplicate
      const noteFile: NoteFile = {
        name: newFilename,
        path: sourceNote.isDaily
          ? `daily/${newFilename}`
          : sourceNote.isWeekly
          ? `weekly/${newFilename}`
          : sourceNote.folderPath
          ? `notes/${sourceNote.folderPath}/${newFilename}`
          : `notes/${newFilename}`,
        isDaily: sourceNote.isDaily || false,
        isWeekly: sourceNote.isWeekly || false,
        isLocked: false,
        folderPath: sourceNote.folderPath,
      };

      // Get fresh notes to avoid stale closure
      const freshNotes = getState().notes;
      // Add to notes list
      if (!freshNotes.find(n => n.path === noteFile.path)) {
        setNotes([...freshNotes, noteFile]);
      }

      // Load the duplicated note
      await loadNote(noteFile);
    } catch (error) {
      console.error('[useNotes] Failed to duplicate note:', error);
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

    let filename: string;
    if (note.isDaily && note.date) {
      filename = `${note.date}.md`;
    } else if (note.isWeekly && note.week) {
      filename = `${note.week}.md`;
    } else {
      filename = `${note.title}.md`;
    }

    try {
      setIsLoading(true);
      await deleteNote(filename, note.isDaily || false, note.isWeekly || false);

      // Remove from notes list
      const freshNotes = state.notes;
      let updatedNotes: NoteFile[];
      if (note.isDaily && note.date) {
        updatedNotes = freshNotes.filter(n => !(n.isDaily && n.date === note.date));
      } else if (note.isWeekly && note.week) {
        updatedNotes = freshNotes.filter(n => !(n.isWeekly && n.week === note.week));
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
    loadWeeklyNote,
    createNote,
    createFromTemplate,
    duplicateNote,
    deleteCurrentNote,
    refresh: initialize,
  };
}

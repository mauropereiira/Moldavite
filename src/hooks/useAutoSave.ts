import { useEffect, useRef } from 'react';
import { useNoteStore, useSettingsStore } from '@/stores';
import { writeNote, deleteNote, htmlToMarkdown } from '@/lib';
import type { NoteFile } from '@/types';

/**
 * Checks if note content is effectively empty by stripping HTML tags.
 * @param content - The HTML content to check
 * @returns True if content contains no meaningful text
 */
function isContentEmpty(content: string): boolean {
  if (!content) return true;

  // Remove HTML tags and check if anything remains
  const textOnly = content
    .replace(/<[^>]*>/g, '') // Remove all HTML tags
    .replace(/&nbsp;/g, ' ') // Replace &nbsp; with space
    .trim();

  if (textOnly === '') {
    return true;
  }

  return false;
}

/**
 * Automatically saves note changes after a configurable delay.
 * Handles daily note creation/deletion based on content and converts HTML to Markdown.
 * Debounces saves to prevent excessive disk writes while typing.
 */
export function useAutoSave() {
  const { currentNote, setIsSaving, setNotes } = useNoteStore();
  const { autoSaveDelay } = useSettingsStore();
  const getState = useNoteStore.getState;
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastContentRef = useRef<string>('');
  const lastNoteIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (!currentNote) {
      lastNoteIdRef.current = null;
      lastContentRef.current = '';
      return;
    }

    // Check if this is a new note being loaded
    const isNewNote = currentNote.id !== lastNoteIdRef.current;

    if (isNewNote) {
      // Update refs for the new note - don't save yet
      lastNoteIdRef.current = currentNote.id;
      lastContentRef.current = currentNote.content;

      // Clear any pending save from previous note
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
      return;
    }

    // Don't save if content hasn't changed
    if (currentNote.content === lastContentRef.current) {
      return;
    }

    // Clear previous timeout
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }

    // Set new timeout for auto-save
    timeoutRef.current = setTimeout(async () => {
      try {
        setIsSaving(true);
        const filename = currentNote.isDaily && currentNote.date
          ? `${currentNote.date}.md`
          : `${currentNote.title}.md`;

        const isEmpty = isContentEmpty(currentNote.content);
        const freshNotes = getState().notes;

        if (currentNote.isDaily) {
          const dateStr = currentNote.date;
          const existsInList = freshNotes.some(n => n.isDaily && n.date === dateStr);

          if (isEmpty) {
            // Content is empty - delete the file if it exists
            if (existsInList) {
              try {
                await deleteNote(filename, true);
              } catch (deleteError) {
                console.error('[useAutoSave] Delete failed:', deleteError);
              }
              // Remove from notes list
              const updatedNotes = freshNotes.filter(n => !(n.isDaily && n.date === dateStr));
              setNotes(updatedNotes);
            }
          } else {
            // Content is not empty - save and add to list if needed
            // Convert HTML to Markdown before saving
            const markdownContent = htmlToMarkdown(currentNote.content);
            await writeNote(filename, markdownContent, true);

            if (!existsInList) {
              // Add to notes list
              const noteFile: NoteFile = {
                name: filename,
                path: filename,
                isDaily: true,
                date: dateStr,
              };
              setNotes([...freshNotes, noteFile]);
            }
          }
        } else {
          // Standalone note - just save normally
          // Convert HTML to Markdown before saving
          const markdownContent = htmlToMarkdown(currentNote.content);
          await writeNote(filename, markdownContent, false);
        }

        lastContentRef.current = currentNote.content;
      } catch (error) {
        console.error('[useAutoSave] Auto-save failed:', error);
      } finally {
        setIsSaving(false);
      }
    }, autoSaveDelay);

    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, [currentNote?.content, currentNote?.id, currentNote?.isDaily, currentNote?.date, currentNote?.title, setIsSaving, setNotes, getState, autoSaveDelay]);
}

/**
 * Debounced persistence lifecycle for the active editable note.
 *
 * A note switch seeds the baseline and cancels the prior timer; content changes
 * replace one pending debounce; effect cleanup cancels stale callbacks. Navigation
 * performs its immediate flush in `useNotes.flushCurrentNote`, while lock transitions
 * reject new writes and drain in-flight writes in `lib/fileSystem.ts`. Temporarily
 * unlocked notes are view-only and must never be written back as plaintext.
 */

import { useCallback, useEffect, useRef } from 'react';
import { useNoteStore, useSettingsStore, useTaskStatusStore, useToastStore } from '@/stores';
import {
  writeNote,
  deleteNote,
  htmlToMarkdown,
  isContentEmpty,
  parseTaskStatus,
  notifyConflictCopy,
  LockedNoteWriteError,
} from '@/lib';
import {
  registerAutosaveBaselineReset,
  registerAutosaveFlush,
  registerAutosavePendingProbe,
} from '@/lib/autosaveFlush';
import type { Note, NoteFile } from '@/types';

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
  /**
   * The note a debounced write is still owed to. Held separately from
   * `currentNote` so that switching notes can settle the previous one's edit
   * against the note it actually belongs to.
   */
  const pendingRef = useRef<Note | null>(null);

  /**
   * Write one note to disk immediately. Takes the note explicitly rather than
   * closing over `currentNote`, so a flush triggered by a note switch persists
   * the note being left rather than the one being opened.
   */
  const persistNote = useCallback(
    async (note: Note) => {
      try {
        setIsSaving(true);

        // Determine filename based on note type
        let filename: string;
        if (note.isDaily && note.date) {
          filename = `${note.date}.md`;
        } else if (note.isWeekly && note.week) {
          filename = `${note.week}.md`;
        } else {
          // Address the note by its on-disk path (folder included); the display
          // title can diverge from the filename and must never decide where we save.
          filename = note.id.startsWith('notes/')
            ? note.id.slice('notes/'.length)
            : `${note.title}.md`;
        }

        const currentNote = note;
        const isEmpty = isContentEmpty(currentNote.content);
        const freshNotes = getState().notes;

        if (currentNote.isDaily) {
          const dateStr = currentNote.date;
          const existsInList = freshNotes.some((n) => n.isDaily && n.date === dateStr);
          const { setTaskStatus, removeTaskStatus } = useTaskStatusStore.getState();

          if (isEmpty) {
            // Content is empty - delete the file if it exists
            if (existsInList) {
              try {
                await deleteNote(filename, true, false, { guarded: true });
                const updatedNotes = freshNotes.filter((n) => !(n.isDaily && n.date === dateStr));
                setNotes(updatedNotes);
                if (dateStr) removeTaskStatus(dateStr);
              } catch (deleteError) {
                console.error('[useAutoSave] Delete failed:', deleteError);
              }
            } else if (dateStr) {
              removeTaskStatus(dateStr);
            }
          } else {
            // Content is not empty - save and add to list if needed
            // Convert HTML to Markdown before saving
            const markdownContent = htmlToMarkdown(currentNote.content);
            notifyConflictCopy(await writeNote(filename, markdownContent, true, false));

            if (!existsInList) {
              // Add to notes list
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

            // Update task status for this date
            if (dateStr) {
              const taskStatus = parseTaskStatus(currentNote.content);
              setTaskStatus(dateStr, taskStatus);
            }
          }
        } else if (currentNote.isWeekly) {
          const weekStr = currentNote.week;
          const existsInList = freshNotes.some((n) => n.isWeekly && n.week === weekStr);

          if (isEmpty) {
            // Content is empty - delete the file if it exists
            if (existsInList) {
              try {
                await deleteNote(filename, false, true, { guarded: true });
                const updatedNotes = freshNotes.filter((n) => !(n.isWeekly && n.week === weekStr));
                setNotes(updatedNotes);
              } catch (deleteError) {
                console.error('[useAutoSave] Delete weekly note failed:', deleteError);
              }
            }
          } else {
            // Content is not empty - save and add to list if needed
            // Convert HTML to Markdown before saving
            const markdownContent = htmlToMarkdown(currentNote.content);
            notifyConflictCopy(await writeNote(filename, markdownContent, false, true));

            if (!existsInList) {
              // Add to notes list
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
          // Standalone note - just save normally
          // Convert HTML to Markdown before saving
          const markdownContent = htmlToMarkdown(currentNote.content);
          notifyConflictCopy(await writeNote(filename, markdownContent, false, false));
        }

        if (pendingRef.current === note) pendingRef.current = null;
        lastContentRef.current = currentNote.content;
      } catch (error) {
        if (error instanceof LockedNoteWriteError) return;
        console.error('[useAutoSave] Auto-save failed:', error);
        const msg = error instanceof Error ? error.message : String(error);
        useToastStore.getState().addToast('error', `Auto-save failed: ${msg}`);
      } finally {
        setIsSaving(false);
      }
    },
    [setIsSaving, setNotes, getState]
  );

  /** Settle any owed write now, cancelling the debounce that would have done it. */
  const flushPending = useCallback(async () => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
    const pending = pendingRef.current;
    pendingRef.current = null;
    if (pending) await persistNote(pending);
  }, [persistNote]);

  // Expose the flush so a Forge switch can await it before reloading the window.
  useEffect(() => registerAutosaveFlush(flushPending), [flushPending]);

  const pendingProbe = useCallback(
    () => (timeoutRef.current !== null ? (pendingRef.current?.id ?? null) : null),
    []
  );
  useEffect(() => registerAutosavePendingProbe(pendingProbe), [pendingProbe]);

  const resetBaseline = useCallback((noteId: string, content: string) => {
    if (pendingRef.current?.id === noteId) {
      if (timeoutRef.current !== null) clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
      pendingRef.current = null;
    }
    if (lastNoteIdRef.current === noteId) {
      lastContentRef.current = content;
    }
  }, []);
  useEffect(() => registerAutosaveBaselineReset(resetBaseline), [resetBaseline]);

  useEffect(() => {
    if (!currentNote) {
      // Losing the active note must not drop an edit it was still owed.
      void flushPending();
      lastNoteIdRef.current = null;
      lastContentRef.current = '';
      return;
    }

    // Temporarily decrypted notes remain encrypted on disk and are view-only.
    if (getState().unlockedNotes.has(currentNote.id)) {
      return;
    }

    // Check if this is a new note being loaded
    const isNewNote = currentNote.id !== lastNoteIdRef.current;

    if (isNewNote) {
      // Switching notes (tab click, Cmd+W, tab shortcuts) used to cancel the
      // previous note's debounce outright, losing the edit — and re-seeding the
      // baseline below meant switching back could not recover it either.
      void flushPending();
      lastNoteIdRef.current = currentNote.id;
      lastContentRef.current = currentNote.content;
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

    pendingRef.current = currentNote;
    timeoutRef.current = setTimeout(() => {
      timeoutRef.current = null;
      void persistNote(currentNote);
    }, autoSaveDelay);

    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, [currentNote, getState, autoSaveDelay, persistNote, flushPending]);

  // Unmount (app close, Forge switch reload) must also settle what is owed.
  // Kept separate from the effect above, whose cleanup runs on every keystroke.
  useEffect(() => () => void flushPending(), [flushPending]);
}

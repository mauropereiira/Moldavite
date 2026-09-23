/**
 * Save-on-leave for the note being navigated away from.
 *
 * A note is written only when it has unsaved edits: its tab body differs from the
 * store's `savedContent` for it, autosave still owes it a write, or an earlier
 * leave-save for it failed. A failed save never blocks navigation. The buffer is held here and
 * retried with backoff; when the retries run out, one sticky toast per note offers
 * Retry and Save as a copy. Nothing here discards a buffer that did not reach disk.
 */

import {
  LockedNoteWriteError,
  createNote,
  deleteNote,
  htmlToMarkdown,
  listNotes,
  preserveBufferCopy,
  writeNote,
} from './fileSystem';
import { notifyConflictCopy } from './noteConflicts';
import { isContentEmpty } from './validation';
import { getPendingAutosaveNoteId, resetAutosaveBaseline } from './autosaveFlush';
// Concrete store modules, not the '@/stores' index, to avoid a module cycle.
import { useNoteStore } from '@/stores/noteStore';
import { useToastStore } from '@/stores/toastStore';
import type { Note, NoteFile } from '@/types';

const RETRY_DELAYS_MS = [1000, 2000, 4000];

interface PendingLeaveSave {
  note: Note;
  attempt: number;
  timer: ReturnType<typeof setTimeout> | null;
  toastId: string | null;
}

const pendingLeaveSaves = new Map<string, PendingLeaveSave>();

function noteDiskFilename(note: Note): string {
  if (note.isDaily && note.date) return `${note.date}.md`;
  if (note.isWeekly && note.week) return `${note.week}.md`;
  // The display title can diverge from the filename and must never decide where we save.
  return note.id.startsWith('notes/') ? note.id.slice('notes/'.length) : `${note.title}.md`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Write one note, deleting a daily or weekly note whose body was emptied. */
async function writeNoteToDisk(note: Note): Promise<void> {
  const filename = noteDiskFilename(note);
  const isEmpty = isContentEmpty(note.content);
  const { notes: freshNotes, setNotes } = useNoteStore.getState();

  if (note.isDaily) {
    const dateStr = note.date;
    const existsInList = freshNotes.some((n) => n.isDaily && n.date === dateStr);

    if (isEmpty) {
      if (existsInList) {
        try {
          await deleteNote(filename, true, false, { guarded: true });
          setNotes(freshNotes.filter((n) => !(n.isDaily && n.date === dateStr)));
        } catch (error) {
          console.error('[leaveSave] Delete failed:', error);
          return;
        }
      }
    } else {
      notifyConflictCopy(await writeNote(filename, htmlToMarkdown(note.content), true, false));
      if (!existsInList) {
        const noteFile: NoteFile = {
          name: filename,
          path: `daily/${filename}`,
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
    const existsInList = freshNotes.some((n) => n.isWeekly && n.week === weekStr);

    if (isEmpty) {
      if (existsInList) {
        try {
          await deleteNote(filename, false, true, { guarded: true });
          setNotes(freshNotes.filter((n) => !(n.isWeekly && n.week === weekStr)));
        } catch (error) {
          console.error('[leaveSave] Delete weekly note failed:', error);
          return;
        }
      }
    } else {
      notifyConflictCopy(await writeNote(filename, htmlToMarkdown(note.content), false, true));
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
    notifyConflictCopy(await writeNote(filename, htmlToMarkdown(note.content), false, false));
  }
  useNoteStore.getState().markNoteSaved(note.id, note.content);
}

function hasUnsavedEditsInTab(noteId: string): boolean {
  if (getPendingAutosaveNoteId() === noteId) return true;
  const { openTabs, savedContent } = useNoteStore.getState();
  const tab = openTabs.find((candidate) => candidate.id === noteId);
  return !!tab && tab.content !== savedContent.get(noteId);
}

/** Whether a note holds text that has not reached disk. */
export function hasUnsavedEdits(noteId: string): boolean {
  return pendingLeaveSaves.has(noteId) || hasUnsavedEditsInTab(noteId);
}

function dismissFailureToast(entry: PendingLeaveSave): void {
  if (entry.toastId) useToastStore.getState().removeToast(entry.toastId);
  entry.toastId = null;
}

/** Stop retrying a note, for example because it was deleted or trashed on purpose. */
export function discardLeaveSave(noteId: string): void {
  const entry = pendingLeaveSaves.get(noteId);
  if (!entry) return;
  if (entry.timer !== null) clearTimeout(entry.timer);
  dismissFailureToast(entry);
  pendingLeaveSaves.delete(noteId);
}

/** The newest text for a held note: its open tab when there is one. */
function liveBuffer(entry: PendingLeaveSave): Note {
  const tab = useNoteStore.getState().openTabs.find((candidate) => candidate.id === entry.note.id);
  return tab ?? entry.note;
}

function showFailureToast(entry: PendingLeaveSave, error: unknown): void {
  const toasts = useToastStore.getState();
  if (entry.toastId && toasts.toasts.some((toast) => toast.id === entry.toastId)) return;
  const noteId = entry.note.id;
  entry.toastId = toasts.addToast(
    'error',
    `Couldn't save "${entry.note.title}": ${errorMessage(error)}. Your changes are kept here until it saves.`,
    undefined,
    [
      {
        label: 'Retry',
        onClick: () => {
          dismissFailureToast(entry);
          void retryLeaveSave(noteId);
        },
      },
      {
        label: 'Save as a copy',
        onClick: () => {
          dismissFailureToast(entry);
          void saveLeaveSaveAsCopy(noteId);
        },
      },
    ]
  );
}

function scheduleRetry(entry: PendingLeaveSave, error: unknown): void {
  if (entry.timer !== null) return;
  if (entry.attempt < RETRY_DELAYS_MS.length) {
    const noteId = entry.note.id;
    entry.timer = setTimeout(() => void retryLeaveSave(noteId), RETRY_DELAYS_MS[entry.attempt]);
    return;
  }
  showFailureToast(entry, error);
}

async function retryLeaveSave(noteId: string): Promise<void> {
  const entry = pendingLeaveSaves.get(noteId);
  if (!entry) return;
  if (entry.timer !== null) {
    clearTimeout(entry.timer);
    entry.timer = null;
  }
  const tab = useNoteStore.getState().openTabs.find((candidate) => candidate.id === noteId);
  if (tab && !hasUnsavedEditsInTab(noteId)) {
    discardLeaveSave(noteId);
    return;
  }
  entry.note = liveBuffer(entry);
  entry.attempt += 1;
  try {
    await writeNoteToDisk(entry.note);
    if (pendingLeaveSaves.get(noteId) === entry) discardLeaveSave(noteId);
  } catch (error) {
    if (pendingLeaveSaves.get(noteId) !== entry) return;
    if (error instanceof LockedNoteWriteError) {
      discardLeaveSave(noteId);
      return;
    }
    console.error('[leaveSave] Retry failed:', error);
    scheduleRetry(entry, error);
  }
}

async function saveLeaveSaveAsCopy(noteId: string): Promise<void> {
  const entry = pendingLeaveSaves.get(noteId);
  if (!entry) return;
  const note = liveBuffer(entry);
  const markdown = htmlToMarkdown(note.content);
  try {
    let copy: string;
    try {
      copy = await preserveBufferCopy(
        noteDiskFilename(note),
        markdown,
        note.isDaily,
        note.isWeekly
      );
    } catch (error) {
      // The note's own folder may be what is failing; fall back to the notes root.
      console.error('[leaveSave] Copy beside the note failed:', error);
      copy = await createNote(`${note.title} (unsaved copy)`);
      notifyConflictCopy(await writeNote(copy, markdown, false, false));
    }
    discardLeaveSave(noteId);
    useNoteStore.getState().markNoteSaved(noteId, note.content);
    listNotes()
      .then((notes) => useNoteStore.getState().setNotes(notes))
      .catch((error) => console.error('[leaveSave] Failed to refresh notes:', error));
    useToastStore
      .getState()
      .addToast('success', `Saved your changes as ${copy.split('/').pop() ?? copy}`);
  } catch (error) {
    console.error('[leaveSave] Save as a copy failed:', error);
    showFailureToast(entry, error);
  }
}

/**
 * Save a note the user is leaving if it has unsaved edits. Resolves to false when
 * the save failed: the buffer is then held and retried in the background, and the
 * caller should keep the note's tab rather than reuse it.
 */
export async function saveNoteOnLeave(note: Note): Promise<boolean> {
  // A temporary unlock exposes plaintext only in memory. Never recreate a
  // plaintext file beside its encrypted `.locked` file while navigating.
  if (useNoteStore.getState().unlockedNotes.has(note.id)) return true;
  if (!hasUnsavedEdits(note.id)) return true;

  try {
    await writeNoteToDisk(note);
    resetAutosaveBaseline(note.id, note.content);
    discardLeaveSave(note.id);
    return true;
  } catch (error) {
    if (error instanceof LockedNoteWriteError) return true;
    console.error('[leaveSave] Save on leave failed:', error);
    // The retry owns this buffer now; an autosave attempt would only add a second toast.
    resetAutosaveBaseline(note.id, note.content);
    const entry = pendingLeaveSaves.get(note.id) ?? {
      note,
      attempt: 0,
      timer: null,
      toastId: null,
    };
    entry.note = note;
    pendingLeaveSaves.set(note.id, entry);
    scheduleRetry(entry, error);
    return false;
  }
}

/**
 * Save-on-leave for the note being navigated away from.
 *
 * A note is written only when it has unsaved edits: its tab body differs from the
 * store's `savedContent` for it, autosave still owes it a write, or an earlier
 * leave-save for it failed. A failed save never blocks navigation. The buffer is held here and
 * retried with backoff; when the retries run out, one sticky toast per note offers
 * Retry and Save as a copy. Closing the window or hiding the page attempts every
 * held save, and every open tab with unsaved edits, at once (see `registerHeldSaves`).
 * A held note reopens from its held text, never from disk, and a retry is dropped only
 * once that text is what the tab holds as saved. Nothing here discards a buffer that
 * did not reach disk, except trashing or deleting the note. A tab still waiting for
 * iCloud (`cloudPending`) has no text of its own and is never written, retried or copied.
 * A note New made under a generated name and left with nothing in it is deleted, as
 * iOS Notes does (see `discardNewNoteIfLeftEmpty`).
 */

import {
  CloudPlaceholderWriteError,
  LockedNoteWriteError,
  createNote,
  deleteNote,
  htmlToMarkdown,
  listNotes,
  noteContentToEditorHtml,
  preserveBufferCopy,
  readNoteSnapshot,
  readNoteWithMeta,
  writeNote,
} from './fileSystem';
import { notifyConflictCopy } from './noteConflicts';
import { isNotDownloadedError, isOpenCloudPlaceholder } from './cloudNotes';
import { isContentEmpty } from './validation';
import {
  getPendingAutosaveNoteId,
  registerHeldSaves,
  resetAutosaveBaseline,
} from './autosaveFlush';
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
  lastError: unknown;
}

const pendingLeaveSaves = new Map<string, PendingLeaveSave>();

export function noteDiskFilename(note: Note): string {
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
  if (note.cloudPending) throw new CloudPlaceholderWriteError();
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
  const { openTabs, savedContent } = useNoteStore.getState();
  const tab = openTabs.find((candidate) => candidate.id === noteId);
  if (tab?.cloudPending) return false;
  if (getPendingAutosaveNoteId() === noteId) return true;
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

/** The held text of a note whose save failed, to reopen its tab from. */
export function heldLeaveSaveNote(noteId: string): Note | undefined {
  return pendingLeaveSaves.get(noteId)?.note;
}

export function heldLeaveSaveIds(): string[] {
  return [...pendingLeaveSaves.keys()];
}

/** Follow a rename or move, so the retry writes to the note's new address. */
export function readdressLeaveSave(oldId: string, newId: string, newTitle?: string): void {
  const entry = pendingLeaveSaves.get(oldId);
  if (!entry || oldId === newId) return;
  pendingLeaveSaves.delete(oldId);
  entry.note = { ...entry.note, id: newId, title: newTitle ?? entry.note.title };
  pendingLeaveSaves.set(newId, entry);
}

/** Stop retrying a note, for example because it was deleted or trashed on purpose. */
export function discardLeaveSave(noteId: string): void {
  const entry = pendingLeaveSaves.get(noteId);
  if (!entry) return;
  if (entry.timer !== null) clearTimeout(entry.timer);
  dismissFailureToast(entry);
  pendingLeaveSaves.delete(noteId);
}

/**
 * The newest text for a held note: its open tab when that holds unsaved edits. A clean
 * tab shows what is on disk, which is not the text this save is holding.
 */
function liveBuffer(entry: PendingLeaveSave): Note {
  const tab = useNoteStore.getState().openTabs.find((candidate) => candidate.id === entry.note.id);
  return tab && hasUnsavedEditsInTab(tab.id) ? tab : entry.note;
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
  const noteId = entry.note.id;
  if (entry.attempt < RETRY_DELAYS_MS.length) {
    entry.timer = setTimeout(() => void retryLeaveSave(noteId), RETRY_DELAYS_MS[entry.attempt]);
    return;
  }
  showFailureToast(entry, error);
  // iCloud evicted the note while it had edits; the failed save asked for it back,
  // and a retry succeeds once it has downloaded.
  if (isNotDownloadedError(error)) {
    entry.timer = setTimeout(
      () => void retryLeaveSave(noteId),
      RETRY_DELAYS_MS[RETRY_DELAYS_MS.length - 1]
    );
  }
}

/** A refused write is only harmless when the tab really is an iCloud placeholder. */
function isPlaceholderRefusal(error: unknown, noteId: string): boolean {
  return error instanceof CloudPlaceholderWriteError && isOpenCloudPlaceholder(noteId);
}

async function retryLeaveSave(noteId: string): Promise<void> {
  const entry = pendingLeaveSaves.get(noteId);
  if (!entry) return;
  if (entry.timer !== null) {
    clearTimeout(entry.timer);
    entry.timer = null;
  }
  const tab = useNoteStore.getState().openTabs.find((candidate) => candidate.id === noteId);
  if (tab && !hasUnsavedEditsInTab(noteId) && tab.content === entry.note.content) {
    discardLeaveSave(noteId);
    return;
  }
  entry.note = liveBuffer(entry);
  entry.attempt += 1;
  try {
    const written = entry.note;
    await writeNoteToDisk(written);
    if (pendingLeaveSaves.get(noteId) === entry) discardLeaveSave(noteId);
    const liveTab = useNoteStore.getState().openTabs.find((candidate) => candidate.id === noteId);
    if (liveTab && liveTab !== written && !hasUnsavedEditsInTab(noteId)) {
      useNoteStore.getState().applyExternalContent(noteId, written.content);
      resetAutosaveBaseline(noteId, written.content);
    }
  } catch (error) {
    if (pendingLeaveSaves.get(noteId) !== entry) return;
    if (error instanceof LockedNoteWriteError || isPlaceholderRefusal(error, noteId)) {
      discardLeaveSave(noteId);
      return;
    }
    console.error('[leaveSave] Retry failed:', error);
    entry.lastError = error;
    scheduleRetry(entry, error);
  }
}

async function saveLeaveSaveAsCopy(noteId: string): Promise<void> {
  const entry = pendingLeaveSaves.get(noteId);
  if (!entry) return;
  const note = liveBuffer(entry);
  if (note.cloudPending) {
    discardLeaveSave(noteId);
    return;
  }
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
    await reloadFromDisk(note);
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

/** Show the file's own text in an open tab whose edits went to a copy instead. */
async function reloadFromDisk(note: Note): Promise<void> {
  const store = useNoteStore.getState();
  if (!store.openTabs.some((tab) => tab.id === note.id)) return;
  try {
    const disk = await readNoteWithMeta(noteDiskFilename(note), note.isDaily, note.isWeekly);
    const html = noteContentToEditorHtml(disk.content);
    useNoteStore.getState().applyExternalContent(note.id, html);
    resetAutosaveBaseline(note.id, html);
  } catch (error) {
    console.error('[leaveSave] Could not reload the original after saving a copy:', error);
    resetAutosaveBaseline(note.id, note.content);
    useNoteStore.getState().removeTabByPath(note.id);
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
  if (note.cloudPending) return true;
  if (!hasUnsavedEdits(note.id)) return true;

  try {
    await writeNoteToDisk(note);
    resetAutosaveBaseline(note.id, note.content, true);
    discardLeaveSave(note.id);
    return true;
  } catch (error) {
    if (error instanceof LockedNoteWriteError || isPlaceholderRefusal(error, note.id)) {
      return true;
    }
    console.error('[leaveSave] Save on leave failed:', error);
    // Hold the newest text, including anything typed while the write was failing.
    // The retry owns it now; an autosave attempt would only add a second toast.
    const latest =
      useNoteStore.getState().openTabs.find((candidate) => candidate.id === note.id) ?? note;
    resetAutosaveBaseline(note.id, latest.content);
    const entry = pendingLeaveSaves.get(note.id) ?? {
      note: latest,
      attempt: 0,
      timer: null,
      toastId: null,
      lastError: error,
    };
    entry.note = latest;
    entry.lastError = error;
    pendingLeaveSaves.set(note.id, entry);
    scheduleRetry(entry, error);
    return false;
  }
}

function unsavedOpenTabs(): Note[] {
  const { openTabs, unlockedNotes } = useNoteStore.getState();
  return openTabs.filter(
    (tab) =>
      !unlockedNotes.has(tab.id) && !pendingLeaveSaves.has(tab.id) && hasUnsavedEditsInTab(tab.id)
  );
}

/**
 * Attempt every held save, and save every open tab with unsaved edits, once and
 * without waiting for a backoff. A note that still fails gets its Retry / Save as a
 * copy toast straight away.
 */
export async function saveHeldNotesNow(): Promise<void> {
  for (const tab of unsavedOpenTabs()) {
    await saveNoteOnLeave(tab);
  }
  for (const noteId of [...pendingLeaveSaves.keys()]) {
    await retryLeaveSave(noteId);
    const entry = pendingLeaveSaves.get(noteId);
    if (entry) showFailureToast(entry, entry.lastError);
  }
}

/** Notes New made this session under a generated name, until their tab closes or is replaced. */
const newNotesToDiscard = new Set<string>();

/**
 * Delete the note New just made if its tab closes or is replaced while the note is
 * still empty, rather than leave an empty "Untitled" behind. A rename or move
 * readdresses the tab, which ends this without a delete: the list no longer has the
 * old path.
 */
export function discardNewNoteIfLeftEmpty(noteId: string): void {
  newNotesToDiscard.add(noteId);
}

function mayDiscard(noteId: string): boolean {
  const { notes, openTabs, unlockedNotes } = useNoteStore.getState();
  const listed = notes.find((note) => note.path === noteId);
  return (
    !!listed &&
    !listed.isLocked &&
    !listed.notDownloaded &&
    !openTabs.some((tab) => tab.id === noteId) &&
    !unlockedNotes.has(noteId) &&
    !pendingLeaveSaves.has(noteId) &&
    getPendingAutosaveNoteId() !== noteId
  );
}

async function discardIfEmpty(note: Note): Promise<void> {
  if (note.cloudPending || !isContentEmpty(note.content) || !mayDiscard(note.id)) return;
  const filename = noteDiskFilename(note);
  try {
    const disk = await readNoteSnapshot(filename, false, false);
    if (disk.content !== '' || disk.color || !mayDiscard(note.id)) return;
    // Refused unless the body on disk is still the empty one just read. It never
    // had anything in it, so there is nothing to keep in the Trash.
    await deleteNote(filename, false, false, { guarded: true, baseHash: disk.contentHash });
  } catch (error) {
    console.error('[leaveSave] Could not discard an empty new note:', error);
    return;
  }
  useNoteStore.getState().forgetNoteReferences(note.id);
}

useNoteStore.subscribe((state, previous) => {
  if (newNotesToDiscard.size === 0 || state.openTabs === previous.openTabs) return;
  for (const noteId of newNotesToDiscard) {
    const left = previous.openTabs.find((tab) => tab.id === noteId);
    if (!left || state.openTabs.some((tab) => tab.id === noteId)) continue;
    newNotesToDiscard.delete(noteId);
    void discardIfEmpty(left);
  }
});

registerHeldSaves({
  saveNow: saveHeldNotesNow,
  isPending: () => pendingLeaveSaves.size > 0 || unsavedOpenTabs().length > 0,
});

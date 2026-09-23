/**
 * Notes in the synced Forge whose contents iCloud has not downloaded yet.
 *
 * Such a note opens as a placeholder tab (`Note.cloudPending`). Its empty body is not
 * the note's text, so nothing may write it: the note store ignores edits to it,
 * `writeNote` refuses its address until a read of the downloaded file is adopted, and
 * autosave and save-on-leave skip it. Downloading is explicit. When iCloud reports the
 * file on this device, `loadDownloadedNote` puts the real body in the tab, which then
 * behaves like any other note.
 */

import { create } from 'zustand';
import { safeInvoke as invoke } from './ipc';
import {
  adoptNoteSnapshot,
  filenameToNote,
  listNotes,
  noteContentToEditorHtml,
  readNoteSnapshot,
  registerCloudPlaceholderProbe,
} from './fileSystem';
import { resetAutosaveBaseline } from './autosaveFlush';
// Concrete store module, not the '@/stores' index, to avoid a module cycle.
import { useNoteStore } from '@/stores/noteStore';
import type { Note, NoteFile } from '@/types';

/** Must match `NOT_DOWNLOADED` in `src-tauri/src/cloud_forge.rs` and the Swift `pendingDownload` text. */
export const NOT_DOWNLOADED_MESSAGE =
  "This note is in iCloud and hasn't downloaded to this device yet.";

const OFFLINE_MESSAGE = "You're offline. Connect to the internet to download this note.";

export function isNotDownloadedError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes(NOT_DOWNLOADED_MESSAGE);
}

type DownloadStatus = { state: 'downloading' } | { state: 'error'; message: string };

interface CloudDownloadState {
  downloads: Record<string, DownloadStatus>;
  set: (noteId: string, status: DownloadStatus | null) => void;
}

export const useCloudDownloadStore = create<CloudDownloadState>((set) => ({
  downloads: {},
  set: (noteId, status) =>
    set((state) => {
      const downloads = { ...state.downloads };
      if (status) downloads[noteId] = status;
      else delete downloads[noteId];
      return { downloads };
    }),
}));

/** One iCloud item whose download state changed, as `icloud:changed` reports it. */
export interface CloudItemUpdate {
  path: string;
  downloaded: boolean;
  error: string | null;
}

export interface CloudChangePayload {
  refreshList: boolean;
  initial: boolean;
  items: CloudItemUpdate[];
}

interface NoteAddress {
  filename: string;
  isDaily: boolean;
  isWeekly: boolean;
}

function addressOf(note: Note): NoteAddress {
  const filename = note.id.slice(note.id.indexOf('/') + 1);
  return { filename, isDaily: note.isDaily, isWeekly: note.isWeekly };
}

function placeholderTab(noteId: string): Note | undefined {
  return useNoteStore.getState().openTabs.find((tab) => tab.id === noteId && tab.cloudPending);
}

registerCloudPlaceholderProbe((filename, isDaily, isWeekly) =>
  useNoteStore.getState().openTabs.some((tab) => {
    if (!tab.cloudPending || tab.isDaily !== isDaily || tab.isWeekly !== isWeekly) return false;
    return addressOf(tab).filename === filename;
  })
);

/** Whether the open tab for `noteId` is an iCloud placeholder right now. */
export function isOpenCloudPlaceholder(noteId: string): boolean {
  return placeholderTab(noteId) !== undefined;
}

/**
 * Open `noteFile` as a placeholder tab instead of reading it. The note list can
 * trail a download that already finished, so it then loads straight away; a read
 * of a note that is still remote asks iCloud for nothing.
 */
export function openCloudPlaceholder(noteFile: NoteFile, inNewTab: boolean): void {
  useNoteStore
    .getState()
    .openTab({ ...filenameToNote(noteFile, ''), cloudPending: true }, inNewTab);
  void loadDownloadedNote(noteFile.path).catch((error) =>
    console.error('[cloudNotes] Failed to load a downloaded note:', error)
  );
}

/**
 * Put the downloaded body into a placeholder tab. Resolves to false while the file is
 * still remote. A note that disappeared from the Forge closes its placeholder.
 */
export async function loadDownloadedNote(noteId: string): Promise<boolean> {
  const tab = placeholderTab(noteId);
  if (!tab) return false;
  const address = addressOf(tab);
  let result;
  try {
    result = await readNoteSnapshot(address.filename, address.isDaily, address.isWeekly);
  } catch (error) {
    if (isNotDownloadedError(error)) return false;
    throw error;
  }
  if (!placeholderTab(noteId)) return false;
  if (result.content === '') {
    // `read_note` answers a missing file with an empty body; only the list can tell
    // an empty note from one that was deleted in iCloud.
    const listed = (await listNotes()).find((note) => note.path === noteId);
    if (!placeholderTab(noteId)) return false;
    if (!listed) {
      useCloudDownloadStore.getState().set(noteId, null);
      useNoteStore.getState().removeTabByPath(noteId);
      return false;
    }
    if (listed.notDownloaded) return false;
  }
  adoptNoteSnapshot(address.filename, address.isDaily, address.isWeekly, result);
  const html = noteContentToEditorHtml(result.content);
  useNoteStore.getState().applyExternalContent(noteId, html);
  resetAutosaveBaseline(noteId, html);
  useCloudDownloadStore.getState().set(noteId, null);
  return true;
}

/** Ask iCloud for a placeholder's contents; the tab loads them when they arrive. */
export async function downloadCloudNote(note: Note): Promise<void> {
  const downloads = useCloudDownloadStore.getState();
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    downloads.set(note.id, { state: 'error', message: OFFLINE_MESSAGE });
    return;
  }
  downloads.set(note.id, { state: 'downloading' });
  try {
    const result = await invoke<{ downloaded: boolean; error: string | null }>(
      'icloud_download_note',
      { ...addressOf(note) }
    );
    if (result.error) {
      downloads.set(note.id, { state: 'error', message: result.error });
    } else if (result.downloaded) {
      await loadDownloadedNote(note.id);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    downloads.set(note.id, { state: 'error', message });
  }
}

/**
 * Apply an `icloud:changed` event. Download status is kept for every note, open
 * or not, so a note left while downloading does not come back still spinning.
 */
export async function applyCloudChange(change: CloudChangePayload): Promise<void> {
  const downloads = useCloudDownloadStore.getState();
  for (const update of change.items) {
    if (update.downloaded) downloads.set(update.path, null);
    else if (update.error) downloads.set(update.path, { state: 'error', message: update.error });
  }
  const placeholders = useNoteStore
    .getState()
    .openTabs.filter((tab) => tab.cloudPending)
    .map((tab) => tab.id);
  for (const noteId of placeholders) {
    const update = change.items.find((item) => item.path === noteId);
    if (update?.downloaded || change.initial) {
      await loadDownloadedNote(noteId).catch((error) =>
        console.error('[cloudNotes] Failed to load a downloaded note:', error)
      );
    }
  }
}

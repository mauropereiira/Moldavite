/**
 * Loose notes: Markdown files opened from outside the Forge and edited in place.
 *
 * Rust owns every path; this module only ever holds the session id Rust handed
 * out. A file opens view-only when the app's own Markdown conversion would
 * change it (`isFaithfulRoundTrip`), so a save never quietly rewrites a file
 * into something the user did not write. Each save carries the hash of the file
 * as last read or written; when the file changed underneath, nothing is written,
 * the save fails with `LooseConflictError`, and further saves wait for the user
 * to choose in `LooseFileBanner`.
 */

import { create } from 'zustand';
import { generateHTML, generateJSON } from '@tiptap/core';
import { createNoteExtensions } from '@/components/editor/noteExtensions';
import { safeInvoke as invoke } from './ipc';
import {
  htmlToMarkdown,
  markdownForComparison,
  noteContentToEditorHtml,
  type ConversionOptions,
} from './fileSystem';
import { flushPendingAutosave, resetAutosaveBaseline } from './autosaveFlush';
import { markLaunchedWithFile } from './launchContext';
import {
  isDroppedId,
  isLooseId,
  isLooseNote,
  isLooseViewOnly,
  looseNoteId,
  looseSessionId,
} from './looseId';
// Concrete store modules, not the '@/stores' index, to avoid a module cycle.
import { useNoteStore } from '@/stores/noteStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { useToastStore } from '@/stores/toastStore';
import { useSaveFailureStore } from '@/stores/saveFailureStore';
import type { LooseNoteInfo, LooseViewOnlyReason, Note } from '@/types';

export const LOOSE_CONVERSION: ConversionOptions = { forgeImages: false };

const CONFLICT_PREFIX = 'conflict:';
const MOVED = 'Moved';

interface LooseRead {
  body: string;
  hash: string;
  readOnly: boolean;
  name: string;
  dirDisplay: string;
}

export interface LooseAdmission {
  id: string;
  name: string;
  dirDisplay: string;
}

export type OpenFileResult =
  | ({ kind: 'loose' } & LooseAdmission)
  | { kind: 'forgeNote'; rel: string };

export type LooseDiskStatus = 'changed' | 'moved';

interface LooseStatusState {
  status: Record<string, LooseDiskStatus>;
  setStatus: (noteId: string, status: LooseDiskStatus | null) => void;
}

/** Per open loose tab, what the file on disk has done since we last read or wrote it. */
export const useLooseStatusStore = create<LooseStatusState>((set) => ({
  status: {},
  setStatus: (noteId, next) =>
    set((state) => {
      if ((state.status[noteId] ?? null) === next) return state;
      const status = { ...state.status };
      if (next) status[noteId] = next;
      else delete status[noteId];
      return { status };
    }),
}));

export class LooseConflictError extends Error {
  constructor(readonly diskHash: string | null) {
    super('The file changed on disk since it was opened');
    this.name = 'LooseConflictError';
  }
}

const baseHashes = new Map<string, string>();
const writeTails = new Map<string, Promise<void>>();

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function looseIdOf(note: Pick<Note, 'id' | 'loose'>): string {
  if (isDroppedId(note.id)) throw new Error('This file opened without its location');
  return note.loose?.looseId ?? looseSessionId(note.id);
}

/** Whether the editor's actual parse and save preserves this Markdown. */
export function isFaithfulRoundTrip(
  body: string,
  html = noteContentToEditorHtml(body, LOOSE_CONVERSION)
): boolean {
  const extensions = createNoteExtensions(useSettingsStore.getState().tagsEnabled);
  const editorHtml = generateHTML(generateJSON(html, extensions), extensions);
  const back = htmlToMarkdown(editorHtml, LOOSE_CONVERSION);
  return markdownForComparison(back) === markdownForComparison(body);
}

function viewOnlyReason(read: LooseRead, html: string): LooseViewOnlyReason | undefined {
  if (read.readOnly) return 'permissions';
  return isFaithfulRoundTrip(read.body, html) ? undefined : 'lossy';
}

async function readLooseFile(looseId: string): Promise<{ read: LooseRead; html: string }> {
  const read = await invoke<LooseRead>('read_loose_file', { id: looseId });
  baseHashes.set(looseId, read.hash);
  return { read, html: noteContentToEditorHtml(read.body, LOOSE_CONVERSION) };
}

function looseInfo(
  looseId: string,
  read: LooseRead,
  html: string,
  previous?: LooseNoteInfo
): LooseNoteInfo {
  const reason = viewOnlyReason(read, html);
  return {
    looseId,
    name: read.name,
    dir: read.dirDisplay,
    readOnly: reason !== undefined,
    ...(reason ? { viewOnlyReason: reason } : {}),
    ...(reason === 'lossy' && previous?.editAnyway ? { editAnyway: true } : {}),
  };
}

/** Open a file Rust admitted, or switch to its tab if it is already open. */
export async function openLooseFile(
  admission: LooseAdmission,
  options: { atLaunch?: boolean; activate?: boolean } = {}
): Promise<boolean> {
  if (options.atLaunch) markLaunchedWithFile();
  const noteId = looseNoteId(admission.id);
  const store = useNoteStore.getState();
  if (store.openTabs.some((tab) => tab.id === noteId)) {
    if (options.activate !== false) store.switchTab(noteId);
    return true;
  }
  try {
    const { read, html } = await readLooseFile(admission.id);
    const now = new Date();
    const note: Note = {
      id: noteId,
      title: read.name,
      content: html,
      createdAt: now,
      updatedAt: now,
      isDaily: false,
      isWeekly: false,
      loose: looseInfo(admission.id, read, html),
    };
    useNoteStore.getState().openTab(note, true, options.activate !== false);
    return true;
  } catch (error) {
    useToastStore
      .getState()
      .addToast('error', `Couldn't open ${admission.name}: ${errorMessage(error)}`);
    return false;
  }
}

/** Route what the open dialog, an Open With event or a launch argument produced. */
export async function openFileResult(
  result: OpenFileResult,
  openForgeNote: (rel: string) => Promise<unknown>,
  options: { atLaunch?: boolean; activate?: boolean } = {}
): Promise<void> {
  if (result.kind === 'forgeNote') {
    if (options.atLaunch) markLaunchedWithFile();
    await openForgeNote(result.rel);
    return;
  }
  await openLooseFile(result, options);
}

export async function openLooseFileDialog(): Promise<OpenFileResult | null> {
  try {
    return await invoke<OpenFileResult | null>('open_loose_file_dialog');
  } catch (error) {
    useToastStore.getState().addToast('error', `Couldn't open the file: ${errorMessage(error)}`);
    return null;
  }
}

/** ⌘O and the Quick Switcher's Open file…: pick a Markdown file and open it. */
export async function openFileWithDialog(
  openForgeNote: (rel: string) => Promise<unknown>
): Promise<void> {
  const result = await openLooseFileDialog();
  if (result) await openFileResult(result, openForgeNote);
}

/**
 * Save a loose note's body over its file. Writes for one file run one at a
 * time, so each carries the hash the previous one produced rather than a stale
 * base that would read as a conflict.
 */
export function writeLooseNote(note: Note): Promise<void> {
  if (isLooseViewOnly(note)) return Promise.reject(new Error('This file is view-only'));
  const looseId = looseIdOf(note);
  const markdown = htmlToMarkdown(note.content, LOOSE_CONVERSION);
  const run = async () => {
    if (useLooseStatusStore.getState().status[note.id]) throw new LooseConflictError(null);
    const baseHash = baseHashes.get(looseId);
    if (!baseHash) throw new Error('This file has not been read yet');
    try {
      const { hash } = await invoke<{ hash: string }>('write_loose_file', {
        id: looseId,
        body: markdown,
        baseHash,
      });
      baseHashes.set(looseId, hash);
    } catch (error) {
      const message = errorMessage(error);
      if (message.startsWith(CONFLICT_PREFIX)) {
        useLooseStatusStore.getState().setStatus(note.id, 'changed');
        throw new LooseConflictError(message.slice(CONFLICT_PREFIX.length));
      }
      if (message === MOVED) {
        useLooseStatusStore.getState().setStatus(note.id, 'moved');
        throw new LooseConflictError(null);
      }
      throw error;
    }
  };
  const write = (writeTails.get(looseId) ?? Promise.resolve()).then(run, run);
  const tail = write.then(
    () => undefined,
    () => undefined
  );
  writeTails.set(looseId, tail);
  void tail.then(() => {
    if (writeTails.get(looseId) === tail) writeTails.delete(looseId);
  });
  return write;
}

/**
 * Put a failed loose save on the note's warning. A conflict says nothing here:
 * `LooseFileBanner` already does.
 */
export function reportLooseSaveFailure(note: Note, error: unknown): void {
  if (error instanceof LooseConflictError) return;
  useSaveFailureStore.getState().markSaveFailed(note.id, errorMessage(error));
}

/** Compare the file with what this window last read or wrote, and raise the banner if it moved on. */
export async function checkLooseNoteOnDisk(note: Note): Promise<void> {
  if (!isLooseNote(note) || isDroppedId(note.id)) return;
  const looseId = looseIdOf(note);
  const setStatus = useLooseStatusStore.getState().setStatus;
  await (writeTails.get(looseId) ?? Promise.resolve());
  try {
    const { hash } = await invoke<{ hash: string }>('stat_loose_file', { id: looseId });
    const base = baseHashes.get(looseId);
    if (base && hash !== base) setStatus(note.id, 'changed');
  } catch (error) {
    if (errorMessage(error) === MOVED) setStatus(note.id, 'moved');
  }
}

/** Replace the tab's text with the file as it is now. */
export async function reloadLooseNote(note: Note): Promise<void> {
  const looseId = looseIdOf(note);
  const { read, html } = await readLooseFile(looseId);
  const store = useNoteStore.getState();
  store.applyExternalContent(note.id, html);
  store.updateLooseInfo(note.id, looseInfo(looseId, read, html, note.loose));
  resetAutosaveBaseline(note.id, html);
  useLooseStatusStore.getState().setStatus(note.id, null);
}

/** Overwrite the file with the tab's text, accepting what is on disk now as the base. */
export async function keepMineLooseNote(note: Note): Promise<void> {
  if (isLooseViewOnly(note)) throw new Error('This file is view-only');
  const looseId = looseIdOf(note);
  const { hash } = await invoke<{ hash: string }>('stat_loose_file', { id: looseId });
  baseHashes.set(looseId, hash);
  useLooseStatusStore.getState().setStatus(note.id, null);
  const live = useNoteStore.getState().openTabs.find((tab) => tab.id === note.id) ?? note;
  await writeLooseNote(live);
  useNoteStore.getState().markNoteSaved(live.id, live.content);
  resetAutosaveBaseline(live.id, live.content, true);
}

/** Returns the copy's file name, or null when the dialog was cancelled. */
export async function saveLooseCopy(note: Note): Promise<string | null> {
  return invoke<string | null>('save_loose_copy_dialog', {
    id: looseIdOf(note),
    ...(isLooseViewOnly(note) ? {} : { body: htmlToMarkdown(note.content, LOOSE_CONVERSION) }),
  });
}

export async function revealLooseFile(note: Note): Promise<void> {
  await invoke('reveal_loose_file', { id: looseIdOf(note) });
}

/** Copy the file into the open Forge's notes. Returns the new note's `notes/` path. */
export async function addLooseToForge(note: Note): Promise<string> {
  await flushPendingAutosave();
  await (writeTails.get(looseIdOf(note)) ?? Promise.resolve());
  const filename = await invoke<string>('add_loose_to_forge', { id: looseIdOf(note) });
  return `notes/${filename}`;
}

/** Reopen the loose tabs a Forge switch's window reload dropped. */
export async function restoreOpenLooseFiles(): Promise<void> {
  let open: LooseAdmission[];
  try {
    open = await invoke('list_open_loose_files');
  } catch (error) {
    console.error('[looseFiles] Could not list open files:', error);
    return;
  }
  if (!Array.isArray(open)) return;
  for (const file of open) await openLooseFile(file, { activate: false });
}

/**
 * A closed tab gives its file back to Rust once any save still owed to it has
 * run; closing it first would refuse that last save.
 */
async function releaseLooseFile(noteId: string): Promise<void> {
  const looseId = looseSessionId(noteId);
  await flushPendingAutosave();
  await (writeTails.get(looseId) ?? Promise.resolve());
  if (useNoteStore.getState().openTabs.some((tab) => tab.id === noteId)) return;
  baseHashes.delete(looseId);
  useLooseStatusStore.getState().setStatus(noteId, null);
  try {
    await invoke('close_loose_file', { id: looseId });
  } catch (error) {
    console.error('[looseFiles] Could not release a closed file:', error);
  }
}

useNoteStore.subscribe((state, previous) => {
  if (state.openTabs === previous.openTabs) return;
  for (const tab of previous.openTabs) {
    if (
      isLooseId(tab.id) &&
      !isDroppedId(tab.id) &&
      !state.openTabs.some((open) => open.id === tab.id)
    ) {
      void releaseLooseFile(tab.id);
    }
  }
});

/**
 * Markdown files dropped on the window, opened in place like Open With.
 *
 * Rust recovers paths per platform without enabling Tauri's drag handler
 * (`src-tauri/src/dropped_files.rs`): macOS from the drag pasteboard, Windows
 * from the `File` objects posted to WebView2, Linux from the drop's
 * `text/uri-list` (page-supplied, a weaker boundary). The page reports name, size and
 * modification time so Rust admits the right files. A file Rust cannot place
 * opens read-only under a `dropped:` id with no session id, so nothing can
 * save it; its text can still be copied into the Forge.
 */

import { safeInvoke as invoke } from './ipc';
import { noteContentToEditorHtml } from './fileSystem';
import { droppedNoteId, isDroppedId, randomHexId } from './looseId';
import { LOOSE_CONVERSION, openFileResult, type OpenFileResult } from './looseFiles';
import { useNoteStore } from '@/stores/noteStore';
import { useToastStore } from '@/stores/toastStore';
import type { Note } from '@/types';

const MARKDOWN_FILE = /\.(md|markdown|mdown|mkd)$/i;
const MAX_DROPPED_BYTES = 10 * 1024 * 1024;

interface WebView2Bridge {
  postMessageWithAdditionalObjects?: (message: unknown, objects: unknown[]) => void;
}

const droppedTexts = new Map<string, string>();

export function isMarkdownFile(file: File): boolean {
  return MARKDOWN_FILE.test(file.name);
}

function droppedBody(raw: string): string {
  const text = raw.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
  const frontmatter = /^---\n(?:[\s\S]*?\n)?(?:---|\.\.\.)(?:\n|$)/.exec(text);
  return frontmatter ? text.slice(frontmatter[0].length) : text;
}

/**
 * The page posts an object rather than a string: wry's IPC handler reads every
 * WebView2 message as a string and skips one that is not.
 */
function postToWebView2(files: File[]): string | null {
  const webview = (window as { chrome?: { webview?: WebView2Bridge } }).chrome?.webview;
  if (typeof webview?.postMessageWithAdditionalObjects !== 'function') return null;
  const token = randomHexId();
  try {
    webview.postMessageWithAdditionalObjects({ moldaviteDrop: token }, files);
    return token;
  } catch (error) {
    console.error('[droppedFiles] WebView2 refused the dropped files:', error);
    return null;
  }
}

function uriList(event: DragEvent): string | null {
  try {
    return event.dataTransfer?.getData('text/uri-list') || null;
  } catch {
    return null;
  }
}

export async function openDroppedReadOnly(file: File): Promise<void> {
  if (file.size > MAX_DROPPED_BYTES) {
    useToastStore
      .getState()
      .addToast('error', `Couldn't open ${file.name}: it is larger than 10 MB`);
    return;
  }
  let text: string;
  try {
    text = await file.text();
  } catch (error) {
    useToastStore.getState().addToast('error', `Couldn't open ${file.name}: ${String(error)}`);
    return;
  }
  const id = droppedNoteId();
  droppedTexts.set(id, text);
  const now = new Date();
  const note: Note = {
    id,
    title: file.name,
    content: noteContentToEditorHtml(droppedBody(text), LOOSE_CONVERSION),
    createdAt: now,
    updatedAt: now,
    isDaily: false,
    isWeekly: false,
    loose: { name: file.name, dir: '', readOnly: true, viewOnlyReason: 'dropped' },
  };
  useNoteStore.getState().openTab(note, true);
}

/**
 * Open the Markdown files among those dropped where nothing else took them.
 * Call it from inside the drop event: the drop's data and its files can be
 * handed on only while the event is being dispatched.
 */
export function openDroppedFiles(
  files: File[],
  event: DragEvent,
  openForgeNote: (rel: string) => Promise<unknown>
): Promise<void> {
  const markdown = files.filter(isMarkdownFile);
  if (markdown.length === 0) return Promise.resolve();
  return admitAndOpen(markdown, uriList(event), postToWebView2(markdown), openForgeNote);
}

async function admitAndOpen(
  files: File[],
  uris: string | null,
  token: string | null,
  openForgeNote: (rel: string) => Promise<unknown>
): Promise<void> {
  let results: Array<OpenFileResult | null> = [];
  try {
    results = await invoke<Array<OpenFileResult | null>>('admit_dropped_files', {
      candidates: files.map((file) => ({
        name: file.name,
        size: file.size,
        lastModified: file.lastModified,
      })),
      uriList: uris,
      token,
    });
  } catch (error) {
    console.error('[droppedFiles] Could not place the dropped files:', error);
  }
  for (const [index, file] of files.entries()) {
    const result = Array.isArray(results) ? results[index] : null;
    if (result) await openFileResult(result, openForgeNote);
    else await openDroppedReadOnly(file);
  }
}

/** Copy a read-only dropped file's text into the open Forge. Returns the new note's `notes/` path. */
export async function addDroppedToForge(note: Note): Promise<string> {
  const text = droppedTexts.get(note.id);
  if (text === undefined) throw new Error('This file is no longer open');
  const filename = await invoke<string>('add_dropped_to_forge', {
    name: note.loose?.name ?? note.title,
    text,
  });
  return `notes/${filename}`;
}

useNoteStore.subscribe((state, previous) => {
  if (state.openTabs === previous.openTabs) return;
  for (const tab of previous.openTabs) {
    if (isDroppedId(tab.id) && !state.openTabs.some((open) => open.id === tab.id)) {
      droppedTexts.delete(tab.id);
    }
  }
});

/** Cold-start and running-instance delivery for validated app deep links. */

import { useEffect } from 'react';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { safeInvoke } from '@/lib/ipc';
import { useGraphStore } from '@/stores/graphStore';
import { usePluginInstallStore } from '@/stores/pluginInstallStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { useTimelineStore } from '@/stores/timelineStore';
import { useNoteStore } from '@/stores/noteStore';
import { useToastStore } from '@/stores/toastStore';
import { useNotes } from './useNotes';
import type { Note, NoteFile } from '@/types';

export const DEEP_LINK_EVENT = 'deep-link-requested';
const PLUGIN_ID_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;
const DRIVE_PREFIX_RE = /^[a-z]:/i;

interface PluginDeepLinkRequest {
  kind: 'plugin';
  id: string;
}

interface NoteDeepLinkRequest {
  kind: 'note';
  path: string;
}

type DeepLinkRequest = PluginDeepLinkRequest | NoteDeepLinkRequest;
type LoadNote = (note: NoteFile, inNewTab?: boolean) => Promise<void>;
type RefreshNotes = () => Promise<void>;

/** Build a path-stable note URL, preserving folders and note type. */
export function noteDeepLink(
  note: Pick<Note, 'id' | 'isDaily' | 'isWeekly' | 'date' | 'week'>
): string {
  let reference: string;
  if (note.isDaily && note.date) {
    reference = `daily/${note.date}.md`;
  } else if (note.isWeekly && note.week) {
    reference = `weekly/${note.week}.md`;
  } else {
    reference = note.id.startsWith('notes/') ? note.id.slice('notes/'.length) : note.id;
  }
  return `moldavite://note/${encodeURIComponent(reference)}`;
}

/** Route only backend-validated plugin ids into Settings; fail closed otherwise. */
export function routePluginInstallRequest(value: unknown): boolean {
  if (typeof value !== 'string' || !PLUGIN_ID_RE.test(value)) {
    return false;
  }

  useTimelineStore.getState().close();
  useGraphStore.getState().close();
  const settings = useSettingsStore.getState();
  settings.setActiveSettingsTab('plugins');
  settings.setIsSettingsOpen(true);
  usePluginInstallStore.getState().request(value);
  return true;
}

function isSafeNoteReference(value: unknown): value is string {
  if (
    typeof value !== 'string' ||
    !value.endsWith('.md') ||
    value.includes('\0') ||
    value.includes('\\') ||
    value.startsWith('/') ||
    DRIVE_PREFIX_RE.test(value)
  ) {
    return false;
  }
  return value.split('/').every((part) => part.length > 0 && !part.startsWith('.'));
}

function notePathForReference(reference: string): string {
  if (
    reference.startsWith('notes/') ||
    reference.startsWith('daily/') ||
    reference.startsWith('weekly/')
  ) {
    return reference;
  }
  return `notes/${reference}`;
}

async function findLinkedNote(
  reference: string,
  refreshNotes: RefreshNotes
): Promise<NoteFile | null> {
  const targetPath = notePathForReference(reference);
  // Cold-start delivery can beat initialization, while a live request can see
  // a stale list after an external deletion. Refresh before resolving either.
  await refreshNotes();
  const note = useNoteStore.getState().notes.find((candidate) => candidate.path === targetPath);
  return note ?? null;
}

/** Resolve a validated note reference and use the normal editor navigation path. */
export async function routeNoteRequest(
  value: unknown,
  loadNote: LoadNote,
  refreshNotes: RefreshNotes
): Promise<boolean> {
  if (!isSafeNoteReference(value)) return false;

  const note = await findLinkedNote(value, refreshNotes);
  if (!note) {
    useToastStore.getState().addToast('error', 'The linked note was not found in this Forge.');
    return false;
  }
  if (note.isLocked) {
    useToastStore
      .getState()
      .addToast('error', 'The linked note is locked. Unlock it from the sidebar first.');
    return false;
  }

  useSettingsStore.getState().setIsSettingsOpen(false);
  await loadNote(note);
  return true;
}

function isDeepLinkRequest(value: unknown): value is DeepLinkRequest {
  if (!value || typeof value !== 'object') return false;
  const request = value as Record<string, unknown>;
  if (request.kind === 'plugin') {
    return typeof request.id === 'string' && PLUGIN_ID_RE.test(request.id);
  }
  return request.kind === 'note' && isSafeNoteReference(request.path);
}

/**
 * Subscribe before draining so a URL arriving during startup cannot be lost.
 * The Rust queue is also the payload source for live events, avoiding separate
 * cold/running routing paths.
 */
export function usePluginDeepLinks() {
  const { loadNote, refresh } = useNotes();

  useEffect(() => {
    let disposed = false;
    let unlisten: UnlistenFn | undefined;

    const drain = async () => {
      try {
        const pending = await safeInvoke<unknown>('take_pending_deep_links');
        if (!Array.isArray(pending)) return;
        for (const request of pending) {
          if (!isDeepLinkRequest(request)) continue;
          if (request.kind === 'plugin') {
            routePluginInstallRequest(request.id);
          } else {
            await routeNoteRequest(request.path, loadNote, refresh);
          }
        }
      } catch (error) {
        console.error('[deep-link] could not read pending requests:', error);
      }
    };

    const initialize = async () => {
      const stop = await listen(DEEP_LINK_EVENT, () => {
        void drain();
      });
      if (disposed) {
        stop();
        return;
      }
      unlisten = stop;
      await drain();
    };

    void initialize();
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [loadNote, refresh]);
}

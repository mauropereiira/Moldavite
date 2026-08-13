/**
 * Frontend reconciliation for external Forge filesystem events.
 * Event bursts coalesce into a note-list refresh. Open note bodies reconcile
 * independently: clean buffers reload, while dirty buffers remain untouched
 * and surface an explicit external-change decision.
 */

import { useEffect, useRef } from 'react';
import { listen } from '@tauri-apps/api/event';
import {
  getLastPersistedMarkdown,
  htmlToMarkdown,
  isHtmlContent,
  listNotes,
  markdownToHtml,
  readNoteWithMeta,
} from '@/lib';
import { getPendingAutosaveNoteId, resetAutosaveBaseline } from '@/lib/autosaveFlush';
import { useForgeStore, useNoteStore } from '@/stores';
import type { Note } from '@/types';

/**
 * Payload emitted by the backend `forge:changed` event.
 *
 * `kind` is "modified" for any add/change/remove (the debouncer collapses
 * them); the frontend should treat any event as "something changed under
 * the Forge — refresh the list."
 */
interface ForgeChangePayload {
  kind: 'modified';
  relPath: string;
}

interface NoteAddress {
  filename: string;
  isDaily: boolean;
  isWeekly: boolean;
  stem?: string;
}

function noteAddress(relPath: string): NoteAddress | null {
  const daily = relPath.match(/^daily\/([^/]+)\.md$/);
  if (daily) {
    return { filename: `${daily[1]}.md`, isDaily: true, isWeekly: false, stem: daily[1] };
  }
  const weekly = relPath.match(/^weekly\/([^/]+)\.md$/);
  if (weekly) {
    return { filename: `${weekly[1]}.md`, isDaily: false, isWeekly: true, stem: weekly[1] };
  }
  if (relPath.startsWith('notes/') && relPath.endsWith('.md')) {
    return {
      filename: relPath.slice('notes/'.length),
      isDaily: false,
      isWeekly: false,
    };
  }
  return null;
}

function matchingOpenTab(relPath: string, address: NoteAddress, tabs: Note[]): Note | undefined {
  if (address.isDaily) {
    return tabs.find((tab) => tab.isDaily && tab.date === address.stem);
  }
  if (address.isWeekly) {
    return tabs.find((tab) => tab.isWeekly && tab.week === address.stem);
  }
  return tabs.find((tab) => !tab.isDaily && !tab.isWeekly && tab.id === relPath);
}

export async function reconcileExternalNoteChange(relPath: string): Promise<void> {
  const address = noteAddress(relPath);
  if (!address) return;

  const state = useNoteStore.getState();
  const tab = matchingOpenTab(relPath, address, state.openTabs);
  if (!tab) return;

  const lastPersisted = getLastPersistedMarkdown(
    address.filename,
    address.isDaily,
    address.isWeekly
  );
  // The buffer holds `markdownToHtml(disk)` after TipTap normalised it, so
  // `htmlToMarkdown(buffer)` is a round-tripped string. Comparing that against
  // the raw disk Markdown reports every note whose Markdown does not survive
  // the round trip — different bullet markers, emphasis delimiters, escaping —
  // as dirty forever, and an untouched note then gets a conflict prompt on
  // every external write. Put both sides through the same lossy pipeline so
  // only real edits diverge.
  const persistedNormalized =
    lastPersisted === undefined ? undefined : htmlToMarkdown(markdownToHtml(lastPersisted));
  const dirty =
    getPendingAutosaveNoteId() === tab.id ||
    persistedNormalized === undefined ||
    htmlToMarkdown(tab.content) !== persistedNormalized;
  if (dirty) {
    state.markExternallyChanged(tab.id);
    return;
  }

  const result = await readNoteWithMeta(address.filename, address.isDaily, address.isWeekly);
  const html = isHtmlContent(result.content) ? result.content : markdownToHtml(result.content);
  useNoteStore.getState().applyExternalContent(tab.id, html);
  resetAutosaveBaseline(tab.id, html);
}

/**
 * Subscribes to backend `forge:changed` and `forges:changed` events. When
 * something on disk changes outside of Moldavite (Obsidian, an editor, a
 * script…), we reconcile the note list, Forge list, and any semantically
 * matching open tab.
 */
export function useForgeWatcher(): void {
  const setNotes = useNoteStore((s) => s.setNotes);
  const refreshTimer = useRef<number | null>(null);

  useEffect(() => {
    let unlistenForge: (() => void) | undefined;
    let unlistenForges: (() => void) | undefined;
    let cancelled = false;
    let notesRefreshPending = false;
    let forgesRefreshPending = false;

    const scheduleRefresh = () => {
      // Coalesce bursts: a folder rename can fan out to many events.
      if (refreshTimer.current !== null) {
        clearTimeout(refreshTimer.current);
      }
      refreshTimer.current = window.setTimeout(() => {
        refreshTimer.current = null;
        const shouldRefreshNotes = notesRefreshPending;
        const shouldRefreshForges = forgesRefreshPending;
        notesRefreshPending = false;
        forgesRefreshPending = false;

        if (shouldRefreshNotes) {
          listNotes()
            .then((notes) => {
              if (!cancelled) setNotes(notes);
            })
            .catch((err) => {
              console.error('[useForgeWatcher] refresh failed:', err);
            });
        }
        if (shouldRefreshForges) {
          void useForgeStore
            .getState()
            .loadForges()
            .catch((err) => {
              console.error('[useForgeWatcher] Forge-list refresh failed:', err);
            });
        }
      }, 200);
    };

    const subscribe = async () => {
      try {
        const off = await listen<ForgeChangePayload>('forge:changed', (event) => {
          void reconcileExternalNoteChange(event.payload.relPath).catch((err) => {
            console.error('[useForgeWatcher] note reconciliation failed:', err);
          });
          notesRefreshPending = true;
          scheduleRefresh();
        });
        if (cancelled) {
          off();
        } else {
          unlistenForge = off;
        }

        const offForges = await listen<ForgeChangePayload>('forges:changed', () => {
          forgesRefreshPending = true;
          scheduleRefresh();
        });
        if (cancelled) {
          offForges();
        } else {
          unlistenForges = offForges;
        }
      } catch (err) {
        console.error('[useForgeWatcher] subscribe failed:', err);
      }
    };

    void subscribe();

    return () => {
      cancelled = true;
      if (refreshTimer.current !== null) {
        clearTimeout(refreshTimer.current);
        refreshTimer.current = null;
      }
      if (unlistenForge) unlistenForge();
      if (unlistenForges) unlistenForges();
    };
  }, [setNotes]);
}

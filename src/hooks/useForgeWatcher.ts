import { useEffect, useRef } from 'react';
import { listen } from '@tauri-apps/api/event';
import { listNotes } from '@/lib';
import { useNoteStore } from '@/stores';

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

/**
 * Subscribes to backend `forge:changed` events. When something on disk
 * changes outside of Moldavite (Obsidian, an editor, a script…), we
 * reconcile by re-listing notes. We deliberately don't reload the active
 * note's body here — that would clobber unsaved edits — but the path is
 * available in the payload if a future enhancement wants to surface a
 * "this note changed externally" prompt.
 */
export function useForgeWatcher(): void {
  const setNotes = useNoteStore((s) => s.setNotes);
  const refreshTimer = useRef<number | null>(null);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let cancelled = false;

    const subscribe = async () => {
      try {
        const off = await listen<ForgeChangePayload>('forge:changed', () => {
          // Coalesce bursts: a folder rename can fan out to many events.
          if (refreshTimer.current !== null) {
            clearTimeout(refreshTimer.current);
          }
          refreshTimer.current = window.setTimeout(() => {
            refreshTimer.current = null;
            listNotes()
              .then((notes) => {
                if (!cancelled) setNotes(notes);
              })
              .catch((err) => {
                console.error('[useForgeWatcher] refresh failed:', err);
              });
          }, 200);
        });
        if (cancelled) {
          off();
        } else {
          unlisten = off;
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
      if (unlisten) unlisten();
    };
  }, [setNotes]);
}

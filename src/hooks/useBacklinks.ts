import { useEffect, useRef, useState } from 'react';
import { safeInvoke as invoke } from '@/lib/ipc';

/**
 * A single backlink returned by the backend `get_backlinks` command.
 * Matches the `BacklinkInfo` struct in `src-tauri/src/lib.rs` (camelCase).
 */
export interface Backlink {
  /** Filename of the source note, e.g. "projects.md" or "2026-04-23.md" */
  fromNote: string;
  /** First markdown heading in the source note, or filename fallback */
  fromTitle: string;
  /** A short snippet of text around the wiki-link occurrence */
  context: string;
}

const DEBOUNCE_MS = 500;

/**
 * Load backlinks for a given note filename via the backend `get_backlinks` command.
 *
 * The hook debounces refreshes triggered by `refreshKey` changes (e.g. each save)
 * so typing storms don't hammer the filesystem. When `filename` is null (no current
 * note), the result is an empty array.
 *
 * @param filename - The target note filename (e.g. "my-note.md") or null.
 * @param refreshKey - A value that changes whenever caller wants a re-scan (debounced).
 */
export function useBacklinks(filename: string | null, refreshKey: unknown = 0) {
  const [backlinks, setBacklinks] = useState<Backlink[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!filename) {
      setBacklinks([]);
      setLoading(false);
      return;
    }

    let cancelled = false;

    const run = async () => {
      setLoading(true);
      setError(null);
      try {
        const result = await invoke<Backlink[]>('get_backlinks', { filename });
        if (!cancelled) {
          setBacklinks(result);
        }
      } catch (err) {
        if (!cancelled) {
          const message = err instanceof Error ? err.message : String(err);
          setError(message);
          setBacklinks([]);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    // Debounce so rapid save bursts don't trigger back-to-back backend scans.
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }
    timeoutRef.current = setTimeout(run, DEBOUNCE_MS);

    return () => {
      cancelled = true;
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
    };
  }, [filename, refreshKey]);

  return { backlinks, loading, error };
}

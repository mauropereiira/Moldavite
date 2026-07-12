import { useEffect, useRef, useState } from 'react';
import { semanticRelated, SEMANTIC_RELATED_LIMIT, type SemanticHit } from '@/lib/semantic';

const DEBOUNCE_MS = 500;

/**
 * Semantically-related notes for a given note, via the local embeddings
 * index (`semantic_related`). Mirrors `useBacklinks`: refreshes are debounced
 * on `refreshKey` changes (e.g. saves) so typing storms don't hammer the
 * backend, and a null `path` (or `enabled: false`, i.e. the semantic index
 * isn't ready) yields an empty list without any backend call.
 *
 * @param path - Forge-relative path of the current note (e.g.
 *   "notes/Projects/foo.md" or "daily/2026-07-12.md"), or null.
 * @param enabled - Gate: only query while the semantic index is ready.
 * @param refreshKey - Changes whenever the caller wants a re-query (debounced).
 */
export function useRelatedNotes(
  path: string | null,
  enabled: boolean,
  refreshKey: unknown = 0,
) {
  const [related, setRelated] = useState<SemanticHit[]>([]);
  const [loading, setLoading] = useState(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!path || !enabled) {
      setRelated([]);
      setLoading(false);
      return;
    }

    let cancelled = false;

    const run = async () => {
      setLoading(true);
      try {
        const hits = await semanticRelated(path, SEMANTIC_RELATED_LIMIT);
        if (!cancelled) setRelated(hits);
      } catch (err) {
        // Non-fatal: the index may be mid-rebuild or the note not yet embedded.
        console.error('[useRelatedNotes] semantic_related failed:', err);
        if (!cancelled) setRelated([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

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
  }, [path, enabled, refreshKey]);

  return { related, loading };
}

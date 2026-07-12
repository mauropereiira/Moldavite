import { create } from 'zustand';
import { safeInvoke as invoke } from '@/lib/ipc';
import { SEMANTIC_SEARCH_LIMIT, type SemanticHit } from '@/lib/semantic';

/**
 * One hit returned by the backend `search_notes_content` command.
 * Shape mirrors the Rust `ContentMatch` struct (camelCase over the
 * tauri serde bridge).
 */
export interface ContentMatch {
  filename: string;
  path: string;
  snippet: string;
  lineNumber: number;
  matchCount: number;
  isDaily: boolean;
  isWeekly: boolean;
  folderPath: string | null;
}

/**
 * Which engine backs the sidebar search: classic full-text keyword matching
 * or the local semantic (embeddings) index. Semantic mode is only offered
 * by the UI when the semantic index is ready.
 */
export type SearchMode = 'keyword' | 'semantic';

interface SearchState {
  query: string;
  mode: SearchMode;
  results: ContentMatch[];
  semanticResults: SemanticHit[];
  loading: boolean;
  /** Index into the active result list for arrow-key navigation. */
  selectedIndex: number;
  setQuery: (query: string) => void;
  /** Switch engines; re-runs the current query under the new mode. */
  setMode: (mode: SearchMode) => void;
  clear: () => void;
  /** Runs the debounced search. Call from the input onChange path. */
  runSearch: (query: string) => void;
  setSelectedIndex: (index: number) => void;
  moveSelection: (delta: number) => void;
}

const DEBOUNCE_MS = 150;
const MAX_RESULTS = 50;

// Debounce timer lives outside of Zustand state so it isn't serialized.
let debounceTimer: ReturnType<typeof setTimeout> | null = null;
let inflightToken = 0;

export const useSearchStore = create<SearchState>((set, get) => ({
  query: '',
  mode: 'keyword',
  results: [],
  semanticResults: [],
  loading: false,
  selectedIndex: 0,

  setQuery: (query) => {
    set({ query });
    get().runSearch(query);
  },

  setMode: (mode) => {
    if (mode === get().mode) return;
    set({ mode, results: [], semanticResults: [], selectedIndex: 0 });
    get().runSearch(get().query);
  },

  clear: () => {
    if (debounceTimer) {
      clearTimeout(debounceTimer);
      debounceTimer = null;
    }
    // Invalidate any in-flight search so its result can't overwrite the
    // cleared state if it finishes after `clear()`.
    inflightToken += 1;
    set({ query: '', results: [], semanticResults: [], loading: false, selectedIndex: 0 });
  },

  runSearch: (query) => {
    if (debounceTimer) {
      clearTimeout(debounceTimer);
      debounceTimer = null;
    }

    const trimmed = query.trim();
    if (!trimmed) {
      inflightToken += 1;
      set({ results: [], semanticResults: [], loading: false, selectedIndex: 0 });
      return;
    }

    set({ loading: true });
    const token = ++inflightToken;

    debounceTimer = setTimeout(async () => {
      try {
        if (get().mode === 'semantic') {
          const semanticResults = await invoke<SemanticHit[]>('semantic_search', {
            query: trimmed,
            limit: SEMANTIC_SEARCH_LIMIT,
          });
          if (token !== inflightToken) return;
          set({ semanticResults, loading: false, selectedIndex: 0 });
        } else {
          const results = await invoke<ContentMatch[]>('search_notes_content', {
            query: trimmed,
            maxResults: MAX_RESULTS,
          });
          if (token !== inflightToken) return;
          set({ results, loading: false, selectedIndex: 0 });
        }
      } catch (error) {
        if (token !== inflightToken) return;
        console.error('[searchStore] search failed:', error);
        set({ results: [], semanticResults: [], loading: false, selectedIndex: 0 });
      }
    }, DEBOUNCE_MS);
  },

  setSelectedIndex: (index) => set({ selectedIndex: index }),

  moveSelection: (delta) => {
    const { results, semanticResults, mode, selectedIndex } = get();
    const count = mode === 'semantic' ? semanticResults.length : results.length;
    if (count === 0) return;
    const next = Math.max(0, Math.min(count - 1, selectedIndex + delta));
    set({ selectedIndex: next });
  },
}));

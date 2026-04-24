import { create } from 'zustand';
import { safeInvoke as invoke } from '@/lib/ipc';

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

interface SearchState {
  query: string;
  results: ContentMatch[];
  loading: boolean;
  /** Index into `results` for arrow-key navigation. */
  selectedIndex: number;
  setQuery: (query: string) => void;
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
  results: [],
  loading: false,
  selectedIndex: 0,

  setQuery: (query) => {
    set({ query });
    get().runSearch(query);
  },

  clear: () => {
    if (debounceTimer) {
      clearTimeout(debounceTimer);
      debounceTimer = null;
    }
    // Invalidate any in-flight search so its result can't overwrite the
    // cleared state if it finishes after `clear()`.
    inflightToken += 1;
    set({ query: '', results: [], loading: false, selectedIndex: 0 });
  },

  runSearch: (query) => {
    if (debounceTimer) {
      clearTimeout(debounceTimer);
      debounceTimer = null;
    }

    const trimmed = query.trim();
    if (!trimmed) {
      inflightToken += 1;
      set({ results: [], loading: false, selectedIndex: 0 });
      return;
    }

    set({ loading: true });
    const token = ++inflightToken;

    debounceTimer = setTimeout(async () => {
      try {
        const results = await invoke<ContentMatch[]>('search_notes_content', {
          query: trimmed,
          maxResults: MAX_RESULTS,
        });
        if (token !== inflightToken) return;
        set({ results, loading: false, selectedIndex: 0 });
      } catch (error) {
        if (token !== inflightToken) return;
        console.error('[searchStore] search_notes_content failed:', error);
        set({ results: [], loading: false, selectedIndex: 0 });
      }
    }, DEBOUNCE_MS);
  },

  setSelectedIndex: (index) => set({ selectedIndex: index }),

  moveSelection: (delta) => {
    const { results, selectedIndex } = get();
    if (results.length === 0) return;
    const next = Math.max(0, Math.min(results.length - 1, selectedIndex + delta));
    set({ selectedIndex: next });
  },
}));

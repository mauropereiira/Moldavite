import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useNoteStore } from '@/stores';
import { readNote } from '@/lib';
import type { NoteFile } from '@/types';

interface SearchResult {
  note: NoteFile;
  matchType: 'title' | 'content' | 'both';
  contentPreview?: string;
}

const SEARCH_DEBOUNCE_MS = 300;

/**
 * Provides full-text search across standalone notes with title and content matching.
 * Searches are debounced and results include content previews showing match context.
 * @returns Search state and control functions
 */
export function useSearch() {
  const { notes } = useNoteStore();
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const contentCacheRef = useRef<Map<string, string>>(new Map());

  // Get only standalone notes (not daily notes) - memoize to prevent infinite loop
  const standaloneNotes = useMemo(() => notes.filter(n => !n.isDaily), [notes]);

  // Debounce the search query
  useEffect(() => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }

    debounceRef.current = setTimeout(() => {
      setDebouncedQuery(query);
    }, SEARCH_DEBOUNCE_MS);

    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
    };
  }, [query]);

  // Perform search when debounced query changes
  useEffect(() => {
    const performSearch = async () => {
      if (!debouncedQuery.trim()) {
        setResults([]);
        setIsSearching(false);
        return;
      }

      setIsSearching(true);
      const searchTerm = debouncedQuery.toLowerCase().trim();
      const searchResults: SearchResult[] = [];

      for (const note of standaloneNotes) {
        const titleMatch = note.name.toLowerCase().includes(searchTerm);
        let contentMatch = false;
        let contentPreview = '';

        // Check content cache first, then load if needed
        let content = contentCacheRef.current.get(note.path);
        if (content === undefined) {
          try {
            content = await readNote(note.name, note.isDaily || false);
            contentCacheRef.current.set(note.path, content);
          } catch (error) {
            console.error('[useSearch] Failed to load note content:', note.name, error);
            content = '';
          }
        }

        // Search in content (strip HTML tags for better matching)
        const plainContent = content
          .replace(/<[^>]*>/g, ' ')
          .replace(/&nbsp;/g, ' ')
          .toLowerCase();

        if (plainContent.includes(searchTerm)) {
          contentMatch = true;
          // Extract preview around the match
          const matchIndex = plainContent.indexOf(searchTerm);
          const start = Math.max(0, matchIndex - 30);
          const end = Math.min(plainContent.length, matchIndex + searchTerm.length + 30);
          contentPreview = '...' + plainContent.slice(start, end).trim() + '...';
        }

        if (titleMatch || contentMatch) {
          searchResults.push({
            note,
            matchType: titleMatch && contentMatch ? 'both' : titleMatch ? 'title' : 'content',
            contentPreview: contentMatch ? contentPreview : undefined,
          });
        }
      }

      // Sort results: title matches first, then content matches
      searchResults.sort((a, b) => {
        if (a.matchType === 'title' && b.matchType !== 'title') return -1;
        if (a.matchType !== 'title' && b.matchType === 'title') return 1;
        return a.note.name.localeCompare(b.note.name);
      });

      setResults(searchResults);
      setIsSearching(false);
    };

    performSearch();
  }, [debouncedQuery, standaloneNotes]);

  /**
   * Clears the current search query and results.
   */
  const clearSearch = useCallback(() => {
    setQuery('');
    setDebouncedQuery('');
    setResults([]);
  }, []);

  /**
   * Clears the note content cache to force reload on next search.
   */
  const clearCache = useCallback(() => {
    contentCacheRef.current.clear();
  }, []);

  return {
    query,
    setQuery,
    results,
    isSearching,
    clearSearch,
    clearCache,
    hasResults: results.length > 0,
    resultCount: results.length,
    isActive: query.trim().length > 0,
  };
}

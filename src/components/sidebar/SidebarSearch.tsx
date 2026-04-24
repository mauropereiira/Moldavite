import { forwardRef } from 'react';

interface SidebarSearchProps {
  query: string;
  onChange: (value: string) => void;
  onKeyDown?: (e: React.KeyboardEvent<HTMLInputElement>) => void;
  onClear: () => void;
  isSearching?: boolean;
  placeholder?: string;
}

/**
 * Search input shown at the top of the sidebar. Stateless; the caller
 * owns the query string and whichever search engine (sidebar-local
 * title/content matcher or the full-text `searchStore`) backs it.
 */
export const SidebarSearch = forwardRef<HTMLInputElement, SidebarSearchProps>(
  function SidebarSearch(
    { query, onChange, onKeyDown, onClear, isSearching, placeholder },
    ref
  ) {
    return (
      <div className="px-3 py-3">
        <div className="relative">
          <svg
            className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4"
            style={{ color: 'var(--text-muted)' }}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
            />
          </svg>
          <input
            ref={ref}
            type="text"
            value={query}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder={placeholder ?? 'Search notes...'}
            className="search-input search-input-polished w-full pl-9 pr-8 py-2 focus:outline-none"
            style={{ borderRadius: 'var(--radius-sm)' }}
          />
          {query && (
            <button
              onClick={onClear}
              className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 search-clear-btn transition-colors"
              style={{ color: 'var(--text-muted)' }}
              aria-label="Clear search"
            >
              <svg
                className="w-4 h-4 transition-transform"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
            </button>
          )}
        </div>
        {isSearching && (
          <p className="text-xs mt-1 px-1" style={{ color: 'var(--text-muted)' }}>
            Searching...
          </p>
        )}
      </div>
    );
  }
);

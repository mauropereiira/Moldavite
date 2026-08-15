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
  function SidebarSearch({ query, onChange, onKeyDown, onClear, isSearching, placeholder }, ref) {
    return (
      <div className="px-3 pt-5 pb-1">
        <div className="relative">
          <input
            ref={ref}
            type="text"
            value={query}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder={placeholder ?? 'Search notes...'}
            className="search-input search-input-polished w-full py-2 pr-12 focus:outline-none"
          />
          {query && (
            <button
              onClick={onClear}
              className="absolute right-0 top-1/2 -translate-y-1/2 text-[10px] transition-colors"
              style={{ color: 'var(--text-muted)' }}
              aria-label="Clear search"
            >
              Clear
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

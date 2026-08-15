import React from 'react';
import type { ContentMatch } from '@/stores';
import { SignatureEmptyState } from '@/components/ui/SignatureMark';

function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function renderHighlighted(text: string, term: string): React.ReactNode {
  if (!term) return text;
  const regex = new RegExp(`(${escapeRegExp(term)})`, 'gi');
  const parts = text.split(regex);
  return parts.map((part, i) =>
    i % 2 === 1 ? <mark key={i}>{part}</mark> : <React.Fragment key={i}>{part}</React.Fragment>
  );
}

function folderDisplayName(folderPath: string | null): string | null {
  if (!folderPath) return null;
  // folder_path is the folder part of the relative path within notes/
  // e.g. "work/projects" — show the leaf for compactness.
  const parts = folderPath.split('/').filter(Boolean);
  return parts.length > 0 ? parts[parts.length - 1] : null;
}

interface SidebarSearchResultsProps {
  query: string;
  results: ContentMatch[];
  loading: boolean;
  selectedIndex: number;
  onSelect: (index: number) => void;
  onOpen: (match: ContentMatch) => void;
  onClear: () => void;
}

export function SidebarSearchResults({
  query,
  results,
  loading,
  selectedIndex,
  onSelect,
  onOpen,
  onClear,
}: SidebarSearchResultsProps) {
  return (
    <div className="px-3 py-2">
      <div className="section-header">
        <h2>
          {loading
            ? 'Searching...'
            : `${results.length} ${results.length === 1 ? 'result' : 'results'}`}
        </h2>
      </div>
      <div className="pt-2" role="listbox" aria-label="Search results">
        {results.map((match, index) => {
          const folder = folderDisplayName(match.folderPath);
          const isActive = index === selectedIndex;
          return (
            <button
              key={match.path}
              role="option"
              aria-selected={isActive}
              onClick={() => onOpen(match)}
              onMouseEnter={() => onSelect(index)}
              className={`note-card sidebar-item-animated w-full text-left focus-ring${
                isActive ? ' note-card-active' : ''
              } list-item-stagger`}
              style={{ '--index': Math.min(index, 10) } as React.CSSProperties}
            >
              <span className="flex items-baseline gap-2 text-sm">
                <span className="note-card-title truncate">
                  {match.filename.replace(/\.md$/, '')}
                </span>
                {folder && (
                  <span className="text-[11px] truncate" style={{ color: 'var(--text-muted)' }}>
                    in {folder}
                  </span>
                )}
              </span>
              <p className="text-xs mt-0.5 truncate" style={{ color: 'var(--text-muted)' }}>
                {renderHighlighted(match.snippet, query)}
              </p>
            </button>
          );
        })}
        {!loading && results.length === 0 && (
          <SignatureEmptyState className="px-3 py-2 text-xs">
            <div>
              <span>No results for “{query}”.</span>{' '}
              <button onClick={onClear} style={{ color: 'var(--text-secondary)' }}>
                Clear search
              </button>
            </div>
          </SignatureEmptyState>
        )}
      </div>
    </div>
  );
}

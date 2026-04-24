import React from 'react';
import { FileText, Calendar } from 'lucide-react';
import { NoSearchResultsEmptyState } from '@/components/ui';
import type { ContentMatch } from '@/stores';

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
      <div className="flex items-center justify-between mb-2">
        <h2 className="section-header">
          {loading
            ? 'Searching...'
            : `${results.length} ${results.length === 1 ? 'result' : 'results'}`}
        </h2>
      </div>
      <div className="space-y-1" role="listbox" aria-label="Search results">
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
              className="w-full text-left px-2 py-1.5 rounded focus-ring sidebar-item-animated transition-colors"
              style={{
                backgroundColor: isActive ? 'var(--hover-overlay)' : 'transparent',
                color: 'var(--text-primary)',
              }}
            >
              <span className="flex items-center gap-2 text-sm">
                {match.isDaily ? (
                  <Calendar
                    className="w-3.5 h-3.5 flex-shrink-0"
                    style={{ color: 'var(--accent-primary)' }}
                  />
                ) : (
                  <FileText
                    className="w-3.5 h-3.5 flex-shrink-0"
                    style={{ color: 'var(--text-muted)' }}
                  />
                )}
                <span className="truncate font-medium">
                  {match.filename.replace(/\.md$/, '')}
                </span>
                {folder && (
                  <span
                    className="text-[11px] truncate"
                    style={{ color: 'var(--text-muted)' }}
                  >
                    in {folder}
                  </span>
                )}
              </span>
              <p
                className="text-xs mt-0.5 truncate"
                style={{ color: 'var(--text-muted)' }}
              >
                {renderHighlighted(match.snippet, query)}
              </p>
            </button>
          );
        })}
        {!loading && results.length === 0 && (
          <NoSearchResultsEmptyState query={query} onClear={onClear} />
        )}
      </div>
    </div>
  );
}

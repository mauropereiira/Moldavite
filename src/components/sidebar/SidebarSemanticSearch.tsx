import type { ReactNode } from 'react';
import { Calendar, FileText, Sparkles } from 'lucide-react';
import { NoSearchResultsEmptyState } from '@/components/ui';
import type { SearchMode } from '@/stores';
import type { SemanticHit } from '@/lib/semantic';

/**
 * Keyword / Semantic mode chips shown under the sidebar search input.
 * Only rendered when the semantic index is ready (the caller gates this).
 */
export function SearchModeChips({
  mode,
  onModeChange,
}: {
  mode: SearchMode;
  onModeChange: (mode: SearchMode) => void;
}) {
  const chip = (target: SearchMode, label: ReactNode) => {
    const isActive = mode === target;
    return (
      <button
        type="button"
        onClick={() => onModeChange(target)}
        aria-pressed={isActive}
        className="flex items-center gap-1 px-2 py-0.5 text-[11px] font-medium transition-colors focus-ring"
        style={{
          borderRadius: '999px',
          border: `1px solid ${isActive ? 'var(--accent-primary)' : 'var(--border-default)'}`,
          backgroundColor: isActive ? 'var(--accent-subtle)' : 'transparent',
          color: isActive ? 'var(--accent-primary)' : 'var(--text-tertiary)',
        }}
      >
        {label}
      </button>
    );
  };

  return (
    <div className="flex items-center gap-1.5 px-3 pb-1" role="group" aria-label="Search mode">
      {chip('keyword', 'Keyword')}
      {chip(
        'semantic',
        <>
          <Sparkles aria-hidden="true" className="w-3 h-3" />
          Semantic
        </>,
      )}
    </div>
  );
}

/** Subtle one-liner shown while the semantic index is still building. */
export function SemanticIndexingHint() {
  return (
    <p className="text-[11px] px-4 pb-1" style={{ color: 'var(--text-muted)' }}>
      Semantic search is indexing…
    </p>
  );
}

interface SidebarSemanticResultsProps {
  query: string;
  hits: SemanticHit[];
  loading: boolean;
  selectedIndex: number;
  onSelect: (index: number) => void;
  onOpen: (hit: SemanticHit) => void;
  onClear: () => void;
}

/**
 * Semantic-mode result list. Mirrors `SidebarSearchResults` styling but
 * renders `SemanticHit`s (title + forge-relative path + similarity score);
 * semantic matches have no text snippet to highlight.
 */
export function SidebarSemanticResults({
  query,
  hits,
  loading,
  selectedIndex,
  onSelect,
  onOpen,
  onClear,
}: SidebarSemanticResultsProps) {
  return (
    <div className="px-3 py-2">
      <div className="flex items-center justify-between mb-2">
        <h2 className="section-header">
          {loading
            ? 'Searching...'
            : `${hits.length} ${hits.length === 1 ? 'match' : 'matches'} by meaning`}
        </h2>
      </div>
      <div className="space-y-1" role="listbox" aria-label="Semantic search results">
        {hits.map((hit, index) => {
          const isActive = index === selectedIndex;
          const isDaily = hit.path.startsWith('daily/');
          const folder = semanticHitFolder(hit.path);
          return (
            <button
              key={hit.path}
              role="option"
              aria-selected={isActive}
              onClick={() => onOpen(hit)}
              onMouseEnter={() => onSelect(index)}
              className="w-full text-left px-2 py-1.5 rounded focus-ring sidebar-item-animated transition-colors"
              style={{
                backgroundColor: isActive ? 'var(--hover-overlay)' : 'transparent',
                color: 'var(--text-primary)',
              }}
            >
              <span className="flex items-center gap-2 text-sm">
                {isDaily ? (
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
                <span className="truncate font-medium flex-1 min-w-0">{hit.title}</span>
                <span
                  className="text-[11px] flex-shrink-0 tabular-nums"
                  style={{ color: 'var(--text-muted)' }}
                  title="Similarity"
                >
                  {Math.round(hit.score * 100)}%
                </span>
              </span>
              {folder && (
                <p className="text-xs mt-0.5 truncate" style={{ color: 'var(--text-muted)' }}>
                  in {folder}
                </p>
              )}
            </button>
          );
        })}
        {!loading && hits.length === 0 && (
          <NoSearchResultsEmptyState query={query} onClear={onClear} />
        )}
      </div>
    </div>
  );
}

/**
 * Human-readable location for a hit: the leaf folder for notes inside
 * `notes/<folders>/`, nothing for root-level or daily/weekly notes.
 */
function semanticHitFolder(path: string): string | null {
  if (!path.startsWith('notes/')) return null;
  const parts = path.split('/');
  // ["notes", ...folders, "file.md"]
  return parts.length > 2 ? parts[parts.length - 2] : null;
}

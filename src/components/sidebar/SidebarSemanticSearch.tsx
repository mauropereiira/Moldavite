import type { CSSProperties } from 'react';
import type { SearchMode } from '@/stores';
import type { SemanticHit } from '@/lib/semantic';
import { SignatureEmptyState } from '@/components/ui/SignatureMark';

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
  const chip = (target: SearchMode, label: string) => {
    const isActive = mode === target;
    return (
      <button
        type="button"
        onClick={() => onModeChange(target)}
        aria-pressed={isActive}
        className="text-[11px] transition-colors focus-ring"
        style={{
          color: isActive ? 'var(--text-primary)' : 'var(--text-muted)',
          fontWeight: isActive ? 500 : 400,
        }}
      >
        {label}
      </button>
    );
  };

  return (
    <div className="flex items-center gap-2 px-3 pt-2 pb-1" role="group" aria-label="Search mode">
      {chip('keyword', 'Keyword')}
      <span aria-hidden="true" style={{ color: 'var(--border-strong)' }}>
        ·
      </span>
      {chip('semantic', 'Semantic')}
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
      <div className="section-header">
        <h2>
          {loading
            ? 'Searching...'
            : `${hits.length} ${hits.length === 1 ? 'match' : 'matches'} by meaning`}
        </h2>
      </div>
      <div className="pt-2" role="listbox" aria-label="Semantic search results">
        {hits.map((hit, index) => {
          const isActive = index === selectedIndex;
          const folder = semanticHitFolder(hit.path);
          return (
            <button
              key={hit.path}
              role="option"
              aria-selected={isActive}
              onClick={() => onOpen(hit)}
              onMouseEnter={() => onSelect(index)}
              className={`note-card sidebar-item-animated w-full text-left focus-ring${
                isActive ? ' note-card-active' : ''
              } list-item-stagger`}
              style={{ '--index': Math.min(index, 10) } as CSSProperties}
            >
              <span className="flex items-baseline gap-2 text-sm">
                <span className="note-card-title truncate flex-1 min-w-0">{hit.title}</span>
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

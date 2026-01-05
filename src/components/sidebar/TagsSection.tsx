import { X, Hash } from 'lucide-react';
import { CollapsibleSection } from './CollapsibleSection';

interface TagsSectionProps {
  allTags: Map<string, number>;
  selectedTag: string | null;
  isCollapsed: boolean;
  onToggle: () => void;
  onSelectTag: (tag: string | null) => void;
}

/**
 * Sidebar section displaying all tags with counts.
 * Clicking a tag filters notes to show only those containing that tag.
 */
export function TagsSection({
  allTags,
  selectedTag,
  isCollapsed,
  onToggle,
  onSelectTag,
}: TagsSectionProps) {
  // Sort tags by count (descending) then alphabetically
  const sortedTags = Array.from(allTags.entries()).sort((a, b) => {
    if (b[1] !== a[1]) return b[1] - a[1];
    return a[0].localeCompare(b[0]);
  });

  if (sortedTags.length === 0) {
    return null; // Don't show section if no tags
  }

  return (
    <CollapsibleSection
      title="Tags"
      isCollapsed={isCollapsed}
      onToggle={onToggle}
      count={sortedTags.length}
      rightAction={
        selectedTag ? (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onSelectTag(null);
            }}
            className="p-1 transition-colors"
            style={{ color: 'var(--text-muted)' }}
            onMouseEnter={(e) => e.currentTarget.style.color = 'var(--text-primary)'}
            onMouseLeave={(e) => e.currentTarget.style.color = 'var(--text-muted)'}
            title="Clear filter"
          >
            <X className="w-4 h-4" />
          </button>
        ) : undefined
      }
    >
      <div className="px-3 space-y-0.5">
        {sortedTags.map(([tag, count]) => {
          const isSelected = selectedTag === tag;
          return (
            <button
              key={tag}
              onClick={() => onSelectTag(isSelected ? null : tag)}
              className="w-full flex items-center gap-2 px-2 py-1.5 text-sm transition-colors"
              style={{
                borderRadius: 'var(--radius-sm)',
                backgroundColor: isSelected ? 'var(--accent-subtle)' : 'transparent',
                color: isSelected ? 'var(--accent-primary)' : 'var(--text-secondary)',
              }}
              onMouseEnter={(e) => {
                if (!isSelected) {
                  e.currentTarget.style.backgroundColor = 'var(--hover-overlay)';
                  e.currentTarget.style.color = 'var(--text-primary)';
                }
              }}
              onMouseLeave={(e) => {
                if (!isSelected) {
                  e.currentTarget.style.backgroundColor = 'transparent';
                  e.currentTarget.style.color = 'var(--text-secondary)';
                }
              }}
            >
              <Hash className="w-3.5 h-3.5 flex-shrink-0" style={{ opacity: 0.7 }} />
              <span className="flex-1 text-left truncate">{tag}</span>
              <span
                className="text-xs px-1.5 py-0.5"
                style={{
                  color: isSelected ? 'var(--accent-primary)' : 'var(--text-muted)',
                  backgroundColor: isSelected ? 'rgba(var(--accent-primary-rgb), 0.15)' : 'var(--count-badge-bg)',
                  borderRadius: 'var(--radius-sm)',
                }}
              >
                {count}
              </span>
            </button>
          );
        })}
      </div>
    </CollapsibleSection>
  );
}

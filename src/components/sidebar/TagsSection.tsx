import { useState, useMemo } from 'react';
import { X, Hash, Pencil, Search, Check } from 'lucide-react';
import { CollapsibleSection } from './CollapsibleSection';
import { renameTagGlobally, isValidTag } from '@/lib';
import { useToast } from '@/hooks/useToast';

interface TagsSectionProps {
  allTags: Map<string, number>;
  selectedTag: string | null;
  selectedTags: string[];
  tagSearchQuery: string;
  isCollapsed: boolean;
  onToggle: () => void;
  onSelectTag: (tag: string | null) => void;
  onToggleTag: (tag: string) => void;
  onClearFilter: () => void;
  onSearchChange: (query: string) => void;
  onTagsChanged?: () => void; // Callback to refresh notes after tag rename
}

/**
 * Sidebar section displaying all tags with counts.
 * Supports multi-tag filtering and search.
 * Click to toggle tag selection, Cmd/Ctrl+Click for single selection.
 */
export function TagsSection({
  allTags,
  selectedTag,
  selectedTags,
  tagSearchQuery,
  isCollapsed,
  onToggle,
  onSelectTag,
  onToggleTag,
  onClearFilter,
  onSearchChange,
  onTagsChanged,
}: TagsSectionProps) {
  const toast = useToast();
  const [renamingTag, setRenamingTag] = useState<string | null>(null);
  const [newTagName, setNewTagName] = useState('');
  const [isRenaming, setIsRenaming] = useState(false);
  const [contextMenu, setContextMenu] = useState<{ tag: string; x: number; y: number } | null>(null);

  // Sort and filter tags
  const sortedTags = useMemo(() => {
    const filtered = Array.from(allTags.entries()).filter(([tag]) =>
      tag.toLowerCase().includes(tagSearchQuery.toLowerCase())
    );
    return filtered.sort((a, b) => {
      // Selected tags first
      const aSelected = selectedTags.includes(a[0]);
      const bSelected = selectedTags.includes(b[0]);
      if (aSelected !== bSelected) return aSelected ? -1 : 1;
      // Then by count
      if (b[1] !== a[1]) return b[1] - a[1];
      // Then alphabetically
      return a[0].localeCompare(b[0]);
    });
  }, [allTags, tagSearchQuery, selectedTags]);

  const hasActiveFilter = selectedTags.length > 0;

  const handleContextMenu = (e: React.MouseEvent, tag: string) => {
    e.preventDefault();
    setContextMenu({ tag, x: e.clientX, y: e.clientY });
  };

  const handleRenameStart = (tag: string) => {
    setRenamingTag(tag);
    setNewTagName(tag);
    setContextMenu(null);
  };

  const handleRenameSubmit = async () => {
    if (!renamingTag || !newTagName.trim()) return;

    const trimmedNew = newTagName.trim().toLowerCase();

    if (trimmedNew === renamingTag) {
      setRenamingTag(null);
      return;
    }

    if (!isValidTag(trimmedNew)) {
      toast.error('Invalid tag name. Use letters, numbers, and hyphens only.');
      return;
    }

    if (allTags.has(trimmedNew)) {
      toast.error(`Tag #${trimmedNew} already exists`);
      return;
    }

    setIsRenaming(true);
    try {
      const count = await renameTagGlobally(renamingTag, trimmedNew);
      toast.success(`Renamed #${renamingTag} to #${trimmedNew} in ${count} note${count !== 1 ? 's' : ''}`);
      setRenamingTag(null);
      // If the renamed tag was selected, update selection
      if (selectedTag === renamingTag) {
        onSelectTag(trimmedNew);
      }
      // Trigger refresh of notes
      onTagsChanged?.();
    } catch (err) {
      console.error('[TagsSection] Failed to rename tag:', err);
      toast.error('Failed to rename tag');
    } finally {
      setIsRenaming(false);
    }
  };

  const handleRenameCancel = () => {
    setRenamingTag(null);
    setNewTagName('');
  };

  // Don't render if no tags exist at all
  if (allTags.size === 0) {
    return null;
  }

  const handleTagClick = (e: React.MouseEvent, tag: string) => {
    // Cmd/Ctrl+Click: Single select (replace current selection)
    // Regular click: Toggle (add/remove from multi-selection)
    if (e.metaKey || e.ctrlKey) {
      const isOnlySelected = selectedTags.length === 1 && selectedTags[0] === tag;
      onSelectTag(isOnlySelected ? null : tag);
    } else {
      onToggleTag(tag);
    }
  };

  return (
    <>
      <CollapsibleSection
        title="Tags"
        isCollapsed={isCollapsed}
        onToggle={onToggle}
        count={allTags.size}
        rightAction={
          hasActiveFilter ? (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onClearFilter();
              }}
              className="flex items-center gap-1 px-2 py-0.5 text-xs font-medium transition-all"
              style={{
                color: 'var(--accent-primary)',
                backgroundColor: 'var(--accent-subtle)',
                borderRadius: 'var(--radius-sm)',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.backgroundColor = 'var(--accent-muted)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.backgroundColor = 'var(--accent-subtle)';
              }}
              title="Clear all filters"
            >
              <X className="w-3 h-3" />
              {selectedTags.length}
            </button>
          ) : undefined
        }
      >
        {/* Search Input */}
        <div className="px-3 pb-2">
          <div
            className="flex items-center gap-2 px-2 py-1.5 text-sm"
            style={{
              backgroundColor: 'var(--bg-inset)',
              borderRadius: 'var(--radius-sm)',
              border: '1px solid var(--border-default)',
            }}
          >
            <Search className="w-3.5 h-3.5 flex-shrink-0" style={{ color: 'var(--text-muted)' }} />
            <input
              type="text"
              value={tagSearchQuery}
              onChange={(e) => onSearchChange(e.target.value)}
              placeholder="Filter tags..."
              className="flex-1 bg-transparent text-sm outline-none"
              style={{ color: 'var(--text-primary)' }}
            />
            {tagSearchQuery && (
              <button
                onClick={() => onSearchChange('')}
                className="p-0.5 rounded transition-colors"
                style={{ color: 'var(--text-muted)' }}
                onMouseEnter={(e) => e.currentTarget.style.color = 'var(--text-primary)'}
                onMouseLeave={(e) => e.currentTarget.style.color = 'var(--text-muted)'}
              >
                <X className="w-3 h-3" />
              </button>
            )}
          </div>
        </div>

        {/* Tags List */}
        <div className="px-3 space-y-0.5 max-h-[240px] overflow-y-auto scrollbar-on-hover">
          {sortedTags.length === 0 ? (
            <div className="py-3 text-center text-xs" style={{ color: 'var(--text-muted)' }}>
              No tags match "{tagSearchQuery}"
            </div>
          ) : (
            sortedTags.map(([tag, count]) => {
              const isSelected = selectedTags.includes(tag);
              return (
                <button
                  key={tag}
                  onClick={(e) => handleTagClick(e, tag)}
                  onContextMenu={(e) => handleContextMenu(e, tag)}
                  className="tag-filter-item w-full flex items-center gap-2 px-2 py-1.5 text-sm transition-all"
                  style={{
                    borderRadius: 'var(--radius-sm)',
                    backgroundColor: isSelected ? 'var(--accent-subtle)' : 'transparent',
                    color: isSelected ? 'var(--accent-primary)' : 'var(--text-secondary)',
                  }}
                >
                  {/* Checkbox indicator */}
                  <div
                    className="w-4 h-4 flex items-center justify-center rounded flex-shrink-0 transition-all"
                    style={{
                      backgroundColor: isSelected ? 'var(--accent-primary)' : 'transparent',
                      border: isSelected ? 'none' : '1.5px solid var(--border-strong)',
                    }}
                  >
                    {isSelected && <Check className="w-3 h-3 text-white" />}
                  </div>
                  <Hash className="w-3.5 h-3.5 flex-shrink-0" style={{ opacity: 0.6 }} />
                  <span className="flex-1 text-left truncate">{tag}</span>
                  <span
                    className="text-xs px-1.5 py-0.5 font-medium"
                    style={{
                      color: isSelected ? 'var(--accent-primary)' : 'var(--text-muted)',
                      backgroundColor: isSelected ? 'rgba(90, 122, 168, 0.15)' : 'var(--count-badge-bg)',
                      borderRadius: 'var(--radius-sm)',
                    }}
                  >
                    {count}
                  </span>
                </button>
              );
            })
          )}
        </div>

        {/* Filter hint */}
        {hasActiveFilter && (
          <div
            className="px-3 pt-2 pb-1 text-xs"
            style={{ color: 'var(--text-muted)' }}
          >
            Showing notes with {selectedTags.length === 1 ? 'tag' : 'all tags'}:{' '}
            <span style={{ color: 'var(--accent-primary)' }}>
              {selectedTags.map(t => `#${t}`).join(', ')}
            </span>
          </div>
        )}
      </CollapsibleSection>

      {/* Context Menu */}
      {contextMenu && (
        <div
          className="fixed inset-0 z-50"
          onClick={() => setContextMenu(null)}
        >
          <div
            className="absolute py-1 min-w-[140px] modal-content-enter"
            style={{
              left: contextMenu.x,
              top: contextMenu.y,
              backgroundColor: 'var(--bg-elevated)',
              border: '1px solid var(--border-muted)',
              borderRadius: 'var(--radius-md)',
              boxShadow: 'var(--shadow-md)',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <button
              onClick={() => handleRenameStart(contextMenu.tag)}
              className="w-full px-3 py-2 text-sm text-left flex items-center gap-2 transition-colors"
              style={{ color: 'var(--text-primary)' }}
              onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'var(--hover-overlay)'}
              onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
            >
              <Pencil className="w-4 h-4" />
              Rename tag
            </button>
          </div>
        </div>
      )}

      {/* Rename Modal */}
      {renamingTag && (
        <div
          className="fixed inset-0 modal-backdrop-dark flex items-center justify-center z-50 modal-backdrop-enter"
          onClick={(e) => e.target === e.currentTarget && !isRenaming && handleRenameCancel()}
        >
          <div
            className="p-4 w-full max-w-sm mx-4 modal-elevated modal-content-enter"
            style={{
              backgroundColor: 'var(--bg-elevated)',
              borderRadius: 'var(--radius-lg)',
            }}
          >
            <h3 className="text-base font-semibold mb-3" style={{ color: 'var(--text-primary)' }}>
              Rename tag #{renamingTag}
            </h3>
            <p className="text-xs mb-3" style={{ color: 'var(--text-muted)' }}>
              This will update the tag in all notes that use it.
            </p>
            <input
              type="text"
              value={newTagName}
              onChange={(e) => setNewTagName(e.target.value.replace(/\s/g, '-'))}
              placeholder="New tag name"
              className="w-full px-3 py-2 text-sm rounded mb-3"
              style={{
                backgroundColor: 'var(--bg-inset)',
                border: '1px solid var(--border-default)',
                color: 'var(--text-primary)',
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleRenameSubmit();
                if (e.key === 'Escape') handleRenameCancel();
              }}
              autoFocus
              disabled={isRenaming}
            />
            <div className="flex justify-end gap-2">
              <button
                onClick={handleRenameCancel}
                disabled={isRenaming}
                className="px-3 py-1.5 text-sm rounded transition-colors"
                style={{
                  color: 'var(--text-secondary)',
                  backgroundColor: 'var(--bg-inset)',
                }}
              >
                Cancel
              </button>
              <button
                onClick={handleRenameSubmit}
                disabled={isRenaming || !newTagName.trim() || newTagName.trim().toLowerCase() === renamingTag}
                className="px-3 py-1.5 text-sm rounded transition-colors btn-primary-gradient text-white disabled:opacity-50"
              >
                {isRenaming ? 'Renaming...' : 'Rename'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

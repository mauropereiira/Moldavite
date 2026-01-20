import { useState } from 'react';
import { X, Hash, Pencil } from 'lucide-react';
import { CollapsibleSection } from './CollapsibleSection';
import { renameTagGlobally, isValidTag } from '@/lib';
import { useToast } from '@/hooks/useToast';

interface TagsSectionProps {
  allTags: Map<string, number>;
  selectedTag: string | null;
  isCollapsed: boolean;
  onToggle: () => void;
  onSelectTag: (tag: string | null) => void;
  onTagsChanged?: () => void; // Callback to refresh notes after tag rename
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
  onTagsChanged,
}: TagsSectionProps) {
  const toast = useToast();
  const [renamingTag, setRenamingTag] = useState<string | null>(null);
  const [newTagName, setNewTagName] = useState('');
  const [isRenaming, setIsRenaming] = useState(false);
  const [contextMenu, setContextMenu] = useState<{ tag: string; x: number; y: number } | null>(null);

  // Sort tags by count (descending) then alphabetically
  const sortedTags = Array.from(allTags.entries()).sort((a, b) => {
    if (b[1] !== a[1]) return b[1] - a[1];
    return a[0].localeCompare(b[0]);
  });

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

  if (sortedTags.length === 0) {
    return null; // Don't show section if no tags
  }

  return (
    <>
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
                onContextMenu={(e) => handleContextMenu(e, tag)}
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

import { useState } from 'react';
import type { FolderInfo } from '@/types';

interface MoveToFolderModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelect: (folderPath: string | null) => void;
  folders: FolderInfo[];
  /** Single-note mode: filename shown in the body copy. */
  noteFilename?: string;
  /** Bulk mode: count of notes being moved; takes precedence over noteFilename. */
  bulkCount?: number;
}

function FolderOption({
  folder,
  level,
  selectedPath,
  onSelect,
  expandedPaths,
  onToggleExpand,
}: {
  folder: FolderInfo;
  level: number;
  selectedPath: string | null;
  onSelect: (path: string) => void;
  expandedPaths: Set<string>;
  onToggleExpand: (path: string) => void;
}) {
  const isExpanded = expandedPaths.has(folder.path);
  const isSelected = selectedPath === folder.path;
  const hasChildren = folder.children.length > 0;

  return (
    <div>
      <div
        className={`folder-row flex items-center gap-2 py-2 pr-3 cursor-pointer transition-colors${
          isSelected ? ' folder-row-expanded' : ''
        }`}
        style={{
          paddingLeft: `${14 + level * 16}px`,
        }}
        onClick={() => onSelect(folder.path)}
        role="button"
        tabIndex={0}
        aria-pressed={isSelected}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onSelect(folder.path);
          }
        }}
      >
        {hasChildren && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onToggleExpand(folder.path);
            }}
            className="p-1"
            aria-label={`${isExpanded ? 'Collapse' : 'Expand'} ${folder.name}`}
          >
            <span
              aria-hidden="true"
              className={`sidebar-caret ${isExpanded ? 'sidebar-caret-expanded' : ''}`}
            />
          </button>
        )}
        {!hasChildren && <span className="w-5" aria-hidden="true" />}
        <span className="text-sm truncate">{folder.name}</span>
      </div>

      {isExpanded &&
        folder.children.map((child) => (
          <FolderOption
            key={child.path}
            folder={child}
            level={level + 1}
            selectedPath={selectedPath}
            onSelect={onSelect}
            expandedPaths={expandedPaths}
            onToggleExpand={onToggleExpand}
          />
        ))}
    </div>
  );
}

export function MoveToFolderModal({
  isOpen,
  onClose,
  onSelect,
  folders,
  noteFilename,
  bulkCount,
}: MoveToFolderModalProps) {
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set());

  if (!isOpen) return null;

  const handleToggleExpand = (path: string) => {
    setExpandedPaths((prev) => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  };

  const handleConfirm = () => {
    onSelect(selectedPath);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div
        className="absolute inset-0 modal-backdrop-dark modal-backdrop-enter"
        onClick={onClose}
      />
      <div
        className="relative w-full max-w-md mx-4 modal-content-enter overflow-hidden"
        style={{
          backgroundColor: 'var(--bg-elevated)',
          border: '1px solid var(--border-default)',
        }}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between px-4 py-3 border-b"
          style={{ borderColor: 'var(--border-default)' }}
        >
          <h2 className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>
            {bulkCount && bulkCount > 1 ? `Move ${bulkCount} Notes` : 'Move Note'}
          </h2>
          <button
            onClick={onClose}
            className="text-xs transition-colors"
            style={{ color: 'var(--text-muted)' }}
          >
            Close
          </button>
        </div>

        {/* Content */}
        <div className="p-4">
          <p className="text-sm mb-4" style={{ color: 'var(--text-secondary)' }}>
            {bulkCount && bulkCount > 1
              ? `Select a destination for ${bulkCount} notes`
              : `Select a destination for "${(noteFilename ?? '').replace(/\.md$/, '')}"`}
          </p>

          <div
            className="border max-h-64 overflow-y-auto"
            style={{ borderColor: 'var(--border-default)' }}
          >
            {/* Root option */}
            <div
              className={`folder-row flex items-center px-3 py-2 cursor-pointer transition-colors${
                selectedPath === null ? ' folder-row-expanded' : ''
              }`}
              style={{
                color: selectedPath === null ? 'var(--text-primary)' : 'var(--text-secondary)',
              }}
              onClick={() => setSelectedPath(null)}
              role="button"
              tabIndex={0}
              aria-pressed={selectedPath === null}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  setSelectedPath(null);
                }
              }}
            >
              <span className="text-sm">Root (No folder)</span>
            </div>

            {/* Folder options */}
            {folders.map((folder) => (
              <FolderOption
                key={folder.path}
                folder={folder}
                level={0}
                selectedPath={selectedPath}
                onSelect={setSelectedPath}
                expandedPaths={expandedPaths}
                onToggleExpand={handleToggleExpand}
              />
            ))}

            {folders.length === 0 && (
              <p className="px-3 py-4 text-xs" style={{ color: 'var(--text-muted)' }}>
                No folders yet. Create one in the sidebar first.
              </p>
            )}
          </div>
        </div>

        {/* Footer */}
        <div
          className="flex justify-end gap-2 px-4 py-3 border-t"
          style={{ borderColor: 'var(--border-default)' }}
        >
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium transition-colors"
            style={{ color: 'var(--text-secondary)' }}
          >
            Cancel
          </button>
          <button
            onClick={handleConfirm}
            className="px-4 py-2 text-sm font-medium border transition-colors"
            style={{
              color: 'var(--text-primary)',
              backgroundColor: 'transparent',
              borderColor: 'var(--border-default)',
            }}
          >
            Move
          </button>
        </div>
      </div>
    </div>
  );
}

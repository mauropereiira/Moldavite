import { useState } from 'react';
import { X, Folder, FolderOpen, ChevronRight, Home } from 'lucide-react';
import type { FolderInfo } from '@/types';

interface MoveToFolderModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelect: (folderPath: string | null) => void;
  folders: FolderInfo[];
  noteFilename: string;
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
        className={`flex items-center gap-2 px-3 py-2 cursor-pointer rounded transition-colors ${
          isSelected
            ? 'bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300'
            : 'hover:bg-gray-100 dark:hover:bg-gray-800'
        }`}
        style={{ paddingLeft: `${12 + level * 16}px` }}
        onClick={() => onSelect(folder.path)}
      >
        {hasChildren && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onToggleExpand(folder.path);
            }}
            className="p-0.5 hover:bg-gray-200 dark:hover:bg-gray-700 rounded"
          >
            <ChevronRight
              className={`w-3.5 h-3.5 text-gray-400 transition-transform ${
                isExpanded ? 'rotate-90' : ''
              }`}
            />
          </button>
        )}
        {!hasChildren && <div className="w-4" />}
        {isExpanded ? (
          <FolderOpen className="w-4 h-4 text-yellow-500" />
        ) : (
          <Folder className="w-4 h-4 text-yellow-500" />
        )}
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
        className="absolute inset-0 bg-black/50 modal-backdrop-enter"
        onClick={onClose}
      />
      <div className="relative bg-white dark:bg-gray-900 rounded-xl shadow-xl w-full max-w-md mx-4 modal-content-enter overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 dark:border-gray-700">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
            Move Note
          </h2>
          <button
            onClick={onClose}
            className="p-1 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-full transition-colors"
          >
            <X className="w-5 h-5 text-gray-500" />
          </button>
        </div>

        {/* Content */}
        <div className="p-4">
          <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
            Select a destination for &quot;{noteFilename.replace(/\.md$/, '')}&quot;
          </p>

          <div className="border border-gray-200 dark:border-gray-700 rounded-lg max-h-64 overflow-y-auto">
            {/* Root option */}
            <div
              className={`flex items-center gap-2 px-3 py-2 cursor-pointer rounded-t transition-colors ${
                selectedPath === null
                  ? 'bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300'
                  : 'hover:bg-gray-100 dark:hover:bg-gray-800'
              }`}
              onClick={() => setSelectedPath(null)}
            >
              <Home className="w-4 h-4 text-gray-500" />
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
              <div className="px-3 py-4 text-sm text-gray-500 dark:text-gray-400 text-center">
                No folders yet. Create one first.
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-2 px-4 py-3 border-t border-gray-200 dark:border-gray-700">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleConfirm}
            className="px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors"
          >
            Move
          </button>
        </div>
      </div>
    </div>
  );
}

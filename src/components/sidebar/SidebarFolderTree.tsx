import React from 'react';
import { FolderPlus } from 'lucide-react';
import { SidebarSection } from './SidebarSection';
import { FolderTree } from './FolderTree';
import type { FolderInfo, NoteFile } from '@/types';

interface SidebarFolderTreeProps {
  folders: FolderInfo[];
  notes: NoteFile[];
  expandedFolders: string[];
  isCollapsed: boolean;
  onToggleSection: () => void;
  onToggleFolder: (path: string) => void;
  onFolderContextMenu: (e: React.MouseEvent, folder: FolderInfo) => void;
  onNewFolder: () => void;
  onNoteDrop: (notePath: string, toFolder: string) => void;
  onFolderDrop: (folderPath: string, toFolder: string) => void;
  isNoteActive: (note: NoteFile) => boolean;
  onNoteClick: (note: NoteFile, e: React.MouseEvent) => void;
  onNoteContextMenu: (note: NoteFile, e: React.MouseEvent) => void;
  getNoteTags?: (notePath: string) => string[];
  isDragOverFoldersRoot: boolean;
  onFoldersRootDragEnter: (e: React.DragEvent) => void;
  onFoldersRootDragOver: (e: React.DragEvent) => void;
  onFoldersRootDragLeave: (e: React.DragEvent) => void;
  onFoldersRootDrop: (e: React.DragEvent) => void;
}

/**
 * The "Folders" sidebar section. Renders the recursive folder tree with
 * drag-and-drop delegated to FolderTree / FolderItem (HTML5 drag API).
 *
 * Step 3 note: v1.1 scope calls for migrating the DnD layer to @dnd-kit
 * for keyboard-accessible reorder. That migration is deferred; this
 * wrapper exists so the migration happens in one file rather than
 * touching the 1400-line Sidebar.tsx.
 */
export function SidebarFolderTree({
  folders,
  notes,
  expandedFolders,
  isCollapsed,
  onToggleSection,
  onToggleFolder,
  onFolderContextMenu,
  onNewFolder,
  onNoteDrop,
  onFolderDrop,
  isNoteActive,
  onNoteClick,
  onNoteContextMenu,
  getNoteTags,
  isDragOverFoldersRoot,
  onFoldersRootDragEnter,
  onFoldersRootDragOver,
  onFoldersRootDragLeave,
  onFoldersRootDrop,
}: SidebarFolderTreeProps) {
  return (
    <SidebarSection
      title="Folders"
      isCollapsed={isCollapsed}
      onToggle={onToggleSection}
      count={folders.length}
      rightAction={
        <button
          onClick={onNewFolder}
          className="p-1 transition-colors"
          style={{ color: 'var(--text-muted)' }}
          onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--text-primary)')}
          onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--text-muted)')}
          title="New folder"
        >
          <FolderPlus className="w-4 h-4" />
        </button>
      }
    >
      <div
        className="px-1 min-h-[20px] transition-colors"
        style={{
          borderRadius: 'var(--radius-sm)',
          backgroundColor: isDragOverFoldersRoot ? 'var(--accent-subtle)' : 'transparent',
          boxShadow: isDragOverFoldersRoot ? '0 0 0 2px var(--accent-primary)' : 'none',
        }}
        onDragEnter={onFoldersRootDragEnter}
        onDragOver={onFoldersRootDragOver}
        onDragLeave={onFoldersRootDragLeave}
        onDrop={onFoldersRootDrop}
      >
        {folders.length > 0 ? (
          <FolderTree
            folders={folders}
            notes={notes}
            expandedFolders={expandedFolders}
            onToggleFolder={onToggleFolder}
            onFolderContextMenu={onFolderContextMenu}
            onNoteDrop={onNoteDrop}
            onFolderDrop={onFolderDrop}
            isNoteActive={isNoteActive}
            onNoteClick={onNoteClick}
            onNoteContextMenu={onNoteContextMenu}
            getNoteTags={getNoteTags}
          />
        ) : (
          <p className="px-3 py-2 text-sm" style={{ color: 'var(--text-muted)' }}>
            No folders yet
          </p>
        )}
      </div>
    </SidebarSection>
  );
}

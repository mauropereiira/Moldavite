import React from 'react';
import { SidebarSection } from './SidebarSection';
import { FolderTree } from './FolderTree';
import type { FolderInfo, NoteFile } from '@/types';
import { SignatureEmptyState } from '@/components/ui/SignatureMark';

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
  onNoteSelectionClick?: (note: NoteFile, e: React.MouseEvent) => void;
  onNoteContextMenu: (note: NoteFile, e: React.MouseEvent) => void;
  getNoteTags?: (notePath: string) => string[];
  isDragOverFoldersRoot: boolean;
  onFoldersRootDragEnter: (e: React.DragEvent) => void;
  onFoldersRootDragOver: (e: React.DragEvent) => void;
  onFoldersRootDragLeave: (e: React.DragEvent) => void;
  onFoldersRootDrop: (e: React.DragEvent) => void;
  showShapeMarks?: boolean;
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
  onNoteSelectionClick,
  onNoteContextMenu,
  getNoteTags,
  isDragOverFoldersRoot,
  onFoldersRootDragEnter,
  onFoldersRootDragOver,
  onFoldersRootDragLeave,
  onFoldersRootDrop,
  showShapeMarks = false,
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
          className="transition-colors"
          style={{ color: 'var(--text-muted)' }}
          onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--text-primary)')}
          onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--text-muted)')}
          title="New folder"
        >
          New
        </button>
      }
    >
      <div
        className="px-3 min-h-[20px] transition-colors"
        style={{
          borderBottom: `1px solid ${
            isDragOverFoldersRoot ? 'var(--border-strong)' : 'transparent'
          }`,
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
            onNoteSelectionClick={onNoteSelectionClick}
            onNoteContextMenu={onNoteContextMenu}
            getNoteTags={getNoteTags}
            showShapeMarks={showShapeMarks}
          />
        ) : (
          <SignatureEmptyState className="px-3 py-2 text-xs">
            <div>
              <span>No folders yet.</span>{' '}
              <button onClick={onNewFolder} style={{ color: 'var(--text-secondary)' }}>
                New folder
              </button>
            </div>
          </SignatureEmptyState>
        )}
      </div>
    </SidebarSection>
  );
}

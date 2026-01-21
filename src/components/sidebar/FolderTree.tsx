import React from 'react';
import type { FolderInfo, NoteFile } from '@/types';
import { FolderItem } from './FolderItem';

interface FolderTreeProps {
  folders: FolderInfo[];
  notes: NoteFile[];
  expandedFolders: string[];
  onToggleFolder: (path: string) => void;
  onFolderContextMenu: (e: React.MouseEvent, folder: FolderInfo) => void;
  onNoteDrop: (notePath: string, toFolder: string) => void;
  onFolderDrop: (folderPath: string, toFolder: string) => void;
  isNoteActive: (note: NoteFile) => boolean;
  onNoteClick: (note: NoteFile, e: React.MouseEvent) => void;
  onNoteContextMenu: (e: React.MouseEvent, note: NoteFile) => void;
  getNoteTags?: (notePath: string) => string[];
  level?: number;
}

export function FolderTree({
  folders,
  notes,
  expandedFolders,
  onToggleFolder,
  onFolderContextMenu,
  onNoteDrop,
  onFolderDrop,
  isNoteActive,
  onNoteClick,
  onNoteContextMenu,
  getNoteTags,
  level = 0,
}: FolderTreeProps) {
  if (folders.length === 0) {
    return null;
  }

  return (
    <div className="flex flex-col">
      {folders.map((folder) => (
        <FolderItem
          key={folder.path}
          folder={folder}
          level={level}
          isExpanded={expandedFolders.includes(folder.path)}
          onToggle={() => onToggleFolder(folder.path)}
          onContextMenu={(e) => onFolderContextMenu(e, folder)}
          onNoteDrop={(notePath) => onNoteDrop(notePath, folder.path)}
          onFolderDrop={(folderPath) => onFolderDrop(folderPath, folder.path)}
          notes={notes}
          isNoteActive={isNoteActive}
          onNoteClick={onNoteClick}
          onNoteContextMenu={onNoteContextMenu}
          getNoteTags={getNoteTags}
          renderChildren={
            folder.children.length > 0 && (
              <FolderTree
                folders={folder.children}
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
                level={level + 1}
              />
            )
          }
        />
      ))}
    </div>
  );
}

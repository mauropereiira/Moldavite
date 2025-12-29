export interface Note {
  id: string;
  title: string;
  content: string;
  createdAt: Date;
  updatedAt: Date;
  isDaily: boolean;
  isWeekly: boolean;
  date?: string; // YYYY-MM-DD format for daily notes
  week?: string; // YYYY-Www format for weekly notes (e.g., "2024-W52")
  isPinned?: boolean; // Whether the tab is pinned
}

export interface NoteFile {
  name: string;
  path: string;
  isDaily: boolean;
  isWeekly: boolean;
  date?: string;
  week?: string;
  isLocked: boolean;
  folderPath?: string;
}

export interface FolderInfo {
  name: string;
  path: string;
  children: FolderInfo[];
}

export interface TrashedNote {
  id: string;
  filename: string;
  originalPath: string;
  isDaily: boolean;
  isWeekly: boolean;
  isFolder: boolean;
  containedFiles: string[];
  trashedAt: number;
  daysRemaining: number;
}

export type NoteType = 'daily' | 'weekly' | 'standalone';

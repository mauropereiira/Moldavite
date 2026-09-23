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
  externalRev?: number; // Bumped when disk content replaces an open buffer
  readdressedFrom?: string; // Transient old path used to preserve editor state across a move/rename
  /**
   * The note's contents are still in iCloud. The tab's empty body is not the note's
   * text, so the tab is never edited, saved or deleted (see `lib/cloudNotes.ts`).
   */
  cloudPending?: boolean;
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
  /** Unix timestamp (seconds) of last filesystem modification, if known. */
  modifiedAt?: number;
  /** Listed by iCloud in the synced Forge, but its contents are not on this device. */
  notDownloaded?: boolean;
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

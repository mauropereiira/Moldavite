export interface Note {
  id: string;
  title: string;
  content: string;
  createdAt: Date;
  updatedAt: Date;
  isDaily: boolean;
  date?: string; // YYYY-MM-DD format for daily notes
}

export interface NoteFile {
  name: string;
  path: string;
  isDaily: boolean;
  date?: string;
  isLocked: boolean;
}

export type NoteType = 'daily' | 'standalone';

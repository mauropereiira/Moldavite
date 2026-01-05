import { invoke } from '@tauri-apps/api/core';
import type { Note, NoteFile, FolderInfo, TrashedNote } from '@/types';
import { format, parse, isValid, getISOWeek, getISOWeekYear, startOfISOWeek, endOfISOWeek } from 'date-fns';
import TurndownService from 'turndown';
import MarkdownIt from 'markdown-it';
import markdownItTaskLists from 'markdown-it-task-lists';
import DOMPurify from 'dompurify';

// Initialize conversion libraries
const turndownService = new TurndownService({
  headingStyle: 'atx',
  hr: '---',
  bulletListMarker: '-',
  codeBlockStyle: 'fenced',
  emDelimiter: '*',
  strongDelimiter: '**',
});

// Configure turndown for TipTap compatibility
turndownService.addRule('underline', {
  filter: ['u'],
  replacement: function (content) {
    return `<u>${content}</u>`;
  }
});

turndownService.addRule('highlight', {
  filter: ['mark'],
  replacement: function (content) {
    return `<mark>${content}</mark>`;
  }
});

turndownService.addRule('textAlign', {
  filter: function (node) {
    const element = node as HTMLElement;
    return node.nodeName === 'P' && element.style && element.style.textAlign !== '';
  },
  replacement: function (content, node) {
    const element = node as HTMLElement;
    const align = element.style.textAlign;
    if (align && align !== 'left') {
      return `<p style="text-align: ${align}">${content}</p>\n\n`;
    }
    return content + '\n\n';
  }
});

// Add rule for wiki links (must be before we use turndownService)
turndownService.addRule('wikiLink', {
  filter: (node) => {
    return (
      node.nodeName === 'WIKI-LINK' ||
      (node.getAttribute && node.getAttribute('data-wiki-link') === 'true')
    );
  },
  replacement: (content, node) => {
    const element = node as HTMLElement;
    // Use data-label attribute if available, otherwise use text content
    const label = element.getAttribute('data-label') || content || '';

    // Simple syntax - just use the label
    return `[[${label}]]`;
  },
});

// Add rule for TipTap task list items - converts to GFM checkbox syntax
turndownService.addRule('taskItem', {
  filter: function (node) {
    return node.nodeName === 'LI' &&
           node.getAttribute &&
           node.getAttribute('data-type') === 'taskItem';
  },
  replacement: function (content, node) {
    const element = node as HTMLElement;
    const isChecked = element.getAttribute('data-checked') === 'true';
    const checkbox = isChecked ? '[x]' : '[ ]';
    // Clean up the content - remove any label/checkbox artifacts and trim
    const cleanContent = content
      .replace(/^\s*\n/, '') // Remove leading newline
      .replace(/\n\s*$/, '') // Remove trailing newline
      .trim();
    return `- ${checkbox} ${cleanContent}\n`;
  }
});

// Add rule for TipTap task list container
turndownService.addRule('taskList', {
  filter: function (node) {
    return node.nodeName === 'UL' &&
           node.getAttribute &&
           node.getAttribute('data-type') === 'taskList';
  },
  replacement: function (content) {
    // Content is already processed by taskItem rule
    return '\n' + content + '\n';
  }
});

const md = new MarkdownIt({
  html: true, // Allow HTML tags for unsupported features
  breaks: false,
  linkify: true,
  typographer: false,
});

// Add task list plugin for GFM checkbox syntax (- [ ] and - [x])
md.use(markdownItTaskLists, {
  enabled: true,
  label: true,
  labelAfter: true,
});

// Configure DOMPurify for safe HTML rendering
// Allow only tags and attributes needed for note content
const DOMPURIFY_CONFIG = {
  ALLOWED_TAGS: [
    // Text formatting
    'p', 'br', 'strong', 'b', 'em', 'i', 'u', 's', 'del', 'mark', 'code', 'pre',
    // Headings
    'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
    // Lists
    'ul', 'ol', 'li',
    // Blocks
    'blockquote', 'hr', 'div', 'span',
    // Links and media
    'a', 'img',
    // Tables
    'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td',
    // Form elements for task lists
    'input', 'label',
    // Custom elements
    'wiki-link',
  ],
  ALLOWED_ATTR: [
    // Global
    'class', 'id', 'style',
    // Links
    'href', 'target', 'rel',
    // Images
    'src', 'alt', 'title', 'width', 'height',
    // Data attributes (for TipTap)
    'data-type', 'data-checked', 'data-target', 'data-label', 'data-wiki-link',
    // Form elements
    'type', 'checked', 'disabled',
  ],
  ALLOW_DATA_ATTR: true,
  // Forbid potentially dangerous attributes
  FORBID_ATTR: ['onerror', 'onload', 'onclick', 'onmouseover', 'onfocus', 'onblur'],
  // Don't allow javascript: URLs
  ALLOW_UNKNOWN_PROTOCOLS: false,
};

/**
 * Checks if text contains wiki link syntax [[Note Name]].
 * @param text - The text to check
 * @returns True if wiki links are present
 */
export function hasWikiLinks(text: string): boolean {
  return /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/.test(text);
}

/**
 * Extracts all wiki links from Markdown text.
 * @param markdown - The Markdown content to parse
 * @returns Array of wiki links with text and target
 */
export function parseWikiLinks(markdown: string): Array<{text: string, target: string}> {
  const regex = /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g;
  const links: Array<{text: string, target: string}> = [];
  let match;

  while ((match = regex.exec(markdown)) !== null) {
    const text = match[1];
    const target = match[2] || match[1];
    links.push({ text, target });
  }

  return links;
}

/**
 * Converts a note name to a valid filename with lowercase and hyphens.
 * @param noteName - The human-readable note name
 * @returns Sanitized filename with .md extension
 */
export function noteNameToFilename(noteName: string): string {
  return noteName
    .toLowerCase()
    .trim()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '') + '.md';
}

/**
 * Converts HTML content to Markdown format for storage.
 * Preserves TipTap-specific features like underline, highlight, and text alignment.
 * @param html - The HTML content to convert
 * @returns Markdown representation
 */
export function htmlToMarkdown(html: string): string {
  if (!html || html.trim() === '') return '';
  return turndownService.turndown(html);
}

/**
 * Converts Markdown content to HTML for display in the editor.
 * Processes wiki links and task lists, converting them to TipTap-compatible HTML.
 * Sanitizes output with DOMPurify to prevent XSS attacks.
 * @param markdown - The Markdown content to convert
 * @returns Sanitized HTML representation with wiki links and task lists processed
 */
export function markdownToHtml(markdown: string): string {
  if (!markdown || markdown.trim() === '') return '';

  // Pre-process wiki links BEFORE markdown-it
  let processed = markdown;

  // Convert [[Note Name]] or [[Display Text|Note Name]] to wiki-link HTML
  processed = processed.replace(
    /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g,
    (_match, text, target) => {
      const displayText = text.trim();
      const targetNote = (target || text).trim();
      // Convert to filename format
      const filename = noteNameToFilename(targetNote);

      return `<wiki-link data-target="${filename}">${displayText}</wiki-link>`;
    }
  );

  // Render markdown to HTML
  let html = md.render(processed);

  // Post-process: Convert markdown-it-task-lists output to TipTap format
  // markdown-it generates: <ul class="contains-task-list"><li class="task-list-item"><input type="checkbox" ...>text</li></ul>
  // TipTap expects: <ul data-type="taskList"><li data-type="taskItem" data-checked="true/false"><label><input.../></label><div><p>text</p></div></li></ul>

  // Replace task list containers
  html = html.replace(
    /<ul class="contains-task-list">/g,
    '<ul data-type="taskList">'
  );

  // Replace task list items - handle both checked and unchecked
  // Match: <li class="task-list-item"><input class="task-list-item-checkbox" type="checkbox" checked disabled> text</li>
  // or: <li class="task-list-item"><input class="task-list-item-checkbox" type="checkbox" disabled> text</li>
  html = html.replace(
    /<li class="task-list-item">\s*<input[^>]*class="task-list-item-checkbox"[^>]*checked[^>]*>\s*([\s\S]*?)<\/li>/g,
    '<li data-type="taskItem" data-checked="true"><label><input type="checkbox" checked="checked"></label><div><p>$1</p></div></li>'
  );

  html = html.replace(
    /<li class="task-list-item">\s*<input[^>]*class="task-list-item-checkbox"[^>]*>\s*([\s\S]*?)<\/li>/g,
    '<li data-type="taskItem" data-checked="false"><label><input type="checkbox"></label><div><p>$1</p></div></li>'
  );

  // Sanitize HTML to prevent XSS attacks
  // This removes any potentially dangerous scripts, event handlers, and malicious content
  return DOMPurify.sanitize(html, DOMPURIFY_CONFIG);
}

/**
 * Detects if content is already HTML format for backwards compatibility.
 * Checks for common HTML tag patterns at the start of content.
 * @param content - The content to check
 * @returns True if content appears to be HTML
 */
export function isHtmlContent(content: string): boolean {
  if (!content) return false;
  // Check if content starts with HTML tags or contains typical HTML patterns
  const trimmed = content.trim();
  return trimmed.startsWith('<') && (
    trimmed.startsWith('<p>') ||
    trimmed.startsWith('<h1>') ||
    trimmed.startsWith('<h2>') ||
    trimmed.startsWith('<h3>') ||
    trimmed.startsWith('<ul>') ||
    trimmed.startsWith('<ol>') ||
    trimmed.startsWith('<blockquote>') ||
    trimmed.startsWith('<pre>') ||
    trimmed.startsWith('<div>')
  );
}

/**
 * Ensures required note directories exist in the file system.
 * @throws {Error} If directory creation fails
 */
export async function ensureDirectories(): Promise<void> {
  await invoke('ensure_directories');
}

/**
 * Lists all notes (both daily and standalone) from the file system.
 * @returns Array of note file metadata
 */
export async function listNotes(): Promise<NoteFile[]> {
  return await invoke('list_notes');
}

/**
 * Reads the content of a specific note file.
 * @param filename - The note filename (e.g., "2025-01-01.md")
 * @param isDaily - Whether this is a daily note
 * @param isWeekly - Whether this is a weekly note
 * @returns The raw Markdown content
 */
export async function readNote(filename: string, isDaily: boolean, isWeekly: boolean = false): Promise<string> {
  return await invoke('read_note', { filename, isDaily, isWeekly });
}

/**
 * Writes content to a note file, creating it if it doesn't exist.
 * @param filename - The note filename
 * @param content - The Markdown content to write
 * @param isDaily - Whether this is a daily note
 * @param isWeekly - Whether this is a weekly note
 */
export async function writeNote(filename: string, content: string, isDaily: boolean, isWeekly: boolean = false): Promise<void> {
  await invoke('write_note', { filename, content, isDaily, isWeekly });
}

/**
 * Deletes a note file from the file system.
 * @param filename - The note filename to delete
 * @param isDaily - Whether this is a daily note
 * @param isWeekly - Whether this is a weekly note
 */
export async function deleteNote(filename: string, isDaily: boolean, isWeekly: boolean = false): Promise<void> {
  await invoke('delete_note', { filename, isDaily, isWeekly });
}

/**
 * Creates a new standalone note file.
 * @param title - The note title
 * @param folderPath - Optional folder path to create the note in
 * @returns The generated filename (with folder path if applicable)
 */
export async function createNote(title: string, folderPath?: string): Promise<string> {
  return await invoke('create_note', { title, folderPath });
}

/**
 * Renames a note file.
 * @param oldFilename - Current filename
 * @param newFilename - New filename
 * @param isDaily - Whether this is a daily note
 * @param isWeekly - Whether this is a weekly note
 */
export async function renameNote(oldFilename: string, newFilename: string, isDaily: boolean, isWeekly: boolean = false): Promise<void> {
  await invoke('rename_note', { oldFilename, newFilename, isDaily, isWeekly });
}

/**
 * Deletes all notes from the file system.
 * @throws {Error} If deletion fails
 */
export async function clearAllNotes(): Promise<void> {
  await invoke('clear_all_notes');
}

/**
 * Fixes permissions on all existing note files to be owner-only (600).
 * This is a privacy improvement to ensure notes are not readable by other users.
 * @returns The number of files that had their permissions fixed
 */
export async function fixNotePermissions(): Promise<number> {
  return await invoke('fix_note_permissions');
}

/**
 * Generates a filename for a daily note based on the date.
 * @param date - The date for the daily note
 * @returns Filename in format "YYYY-MM-DD.md"
 */
export function getDailyNoteFilename(date: Date): string {
  return `${format(date, 'yyyy-MM-dd')}.md`;
}

/**
 * Parses a daily note filename to extract the date.
 * @param filename - The filename to parse (e.g., "2025-01-01.md")
 * @returns The parsed date, or null if invalid format
 */
export function parseDailyNoteFilename(filename: string): Date | null {
  const match = filename.match(/^(\d{4}-\d{2}-\d{2})\.md$/);
  if (!match) return null;

  const date = parse(match[1], 'yyyy-MM-dd', new Date());
  return isValid(date) ? date : null;
}

/**
 * Generates a filename for a weekly note based on the date.
 * Uses ISO week numbering (Monday start, week 1 contains Jan 4).
 * @param date - Any date within the target week
 * @returns Filename in format "YYYY-Www.md" (e.g., "2024-W52.md")
 */
export function getWeeklyNoteFilename(date: Date): string {
  const weekYear = getISOWeekYear(date);
  const weekNum = getISOWeek(date);
  return `${weekYear}-W${weekNum.toString().padStart(2, '0')}.md`;
}

/**
 * Parses a weekly note filename to extract the week info.
 * @param filename - The filename to parse (e.g., "2024-W52.md")
 * @returns Object with year, week number, and start/end dates, or null if invalid
 */
export function parseWeeklyNoteFilename(filename: string): { year: number; week: number; start: Date; end: Date } | null {
  const match = filename.match(/^(\d{4})-W(\d{2})\.md$/);
  if (!match) return null;

  const year = parseInt(match[1], 10);
  const week = parseInt(match[2], 10);

  if (week < 1 || week > 53) return null;

  // Create a date in the target week (use January 4 + weeks as it's always in week 1)
  const jan4 = new Date(year, 0, 4);
  const targetDate = new Date(jan4.getTime() + (week - 1) * 7 * 24 * 60 * 60 * 1000);

  return {
    year,
    week,
    start: startOfISOWeek(targetDate),
    end: endOfISOWeek(targetDate),
  };
}

/**
 * Gets a human-readable title for a weekly note.
 * @param week - The week string in YYYY-Www format (e.g., "2024-W52")
 * @returns Formatted title (e.g., "Week 52, 2024")
 */
export function getWeeklyNoteTitle(week: string): string {
  const match = week.match(/^(\d{4})-W(\d{2})$/);
  if (!match) return week;
  return `Week ${parseInt(match[2], 10)}, ${match[1]}`;
}

/**
 * Extracts the note title from a filename by removing the .md extension.
 * @param filename - The filename (e.g., "my-note.md")
 * @returns The title without extension
 */
export function getNoteTitleFromFilename(filename: string): string {
  return filename.replace(/\.md$/, '');
}

/**
 * Converts a note file metadata object into a full Note object.
 * Formats daily note titles as readable dates and weekly notes as "Week X, YYYY".
 * @param file - The note file metadata
 * @param content - The note's HTML content
 * @returns Complete Note object with formatted title
 */
export function filenameToNote(file: NoteFile, content: string): Note {
  let title: string;

  if (file.isDaily && file.date) {
    title = format(parse(file.date, 'yyyy-MM-dd', new Date()), 'MMMM d, yyyy');
  } else if (file.isWeekly && file.week) {
    title = getWeeklyNoteTitle(file.week);
  } else {
    title = getNoteTitleFromFilename(file.name);
  }

  return {
    id: file.path,
    title,
    content,
    createdAt: new Date(), // Would need file metadata for actual values
    updatedAt: new Date(),
    isDaily: file.isDaily,
    isWeekly: file.isWeekly,
    date: file.date,
    week: file.week,
  };
}

/**
 * Checks if a note with the given name exists in the file system.
 * @param noteName - The note name to check
 * @returns True if the note exists
 */
export async function checkNoteExists(noteName: string): Promise<boolean> {
  try {
    const result = await invoke<[boolean, string]>('note_exists', { noteName });
    return result[0];
  } catch {
    return false;
  }
}

// Note Locking Functions

/**
 * Locks a note by encrypting it with a password.
 * The note will be stored as filename.md.locked with AES-256 encryption.
 * @param filename - The note filename (e.g., "my-note.md")
 * @param password - The password to encrypt the note with
 * @param isDaily - Whether this is a daily note
 * @param isWeekly - Whether this is a weekly note
 */
export async function lockNote(filename: string, password: string, isDaily: boolean, isWeekly: boolean = false): Promise<void> {
  await invoke('lock_note', { filename, password, isDaily, isWeekly });
}

/**
 * Temporarily unlocks a note to view its content.
 * The note remains encrypted on disk; only returns decrypted content.
 * @param filename - The note filename (e.g., "my-note.md")
 * @param password - The password to decrypt the note
 * @param isDaily - Whether this is a daily note
 * @param isWeekly - Whether this is a weekly note
 * @returns The decrypted content
 */
export async function unlockNote(filename: string, password: string, isDaily: boolean, isWeekly: boolean = false): Promise<string> {
  return await invoke('unlock_note', { filename, password, isDaily, isWeekly });
}

/**
 * Permanently unlocks a note, decrypting it and saving as a regular .md file.
 * @param filename - The note filename (e.g., "my-note.md")
 * @param password - The password to decrypt the note
 * @param isDaily - Whether this is a daily note
 * @param isWeekly - Whether this is a weekly note
 */
export async function permanentlyUnlockNote(filename: string, password: string, isDaily: boolean, isWeekly: boolean = false): Promise<void> {
  await invoke('permanently_unlock_note', { filename, password, isDaily, isWeekly });
}

/**
 * Checks if a note is currently locked.
 * @param filename - The note filename (e.g., "my-note.md")
 * @param isDaily - Whether this is a daily note
 * @param isWeekly - Whether this is a weekly note
 * @returns True if the note is locked
 */
export async function isNoteLocked(filename: string, isDaily: boolean, isWeekly: boolean = false): Promise<boolean> {
  return await invoke('is_note_locked', { filename, isDaily, isWeekly });
}

// Directory Management Functions

/**
 * Gets the current notes directory path.
 * @returns The absolute path to the notes directory
 */
export async function getNotesDirectory(): Promise<string> {
  return await invoke('get_notes_directory');
}

/**
 * Sets a new notes directory and moves all existing notes.
 * @param newPath - The new directory path
 */
export async function setNotesDirectory(newPath: string): Promise<void> {
  await invoke('set_notes_directory', { newPath });
}

// Export/Import Functions

export interface ImportResult {
  dailyNotes: number;
  standaloneNotes: number;
  templates: number;
}

/**
 * Exports all notes and templates to a ZIP file.
 * @param destination - The path where the ZIP file will be created
 * @returns The path to the created ZIP file
 */
export async function exportNotes(destination: string): Promise<string> {
  return await invoke('export_notes', { destination });
}

/**
 * Imports notes and templates from a ZIP file.
 * @param zipPath - The path to the ZIP file to import
 * @param merge - If true, merge with existing notes; if false, replace all notes
 * @returns Import statistics (counts of imported items)
 */
export async function importNotes(zipPath: string, merge: boolean): Promise<ImportResult> {
  return await invoke('import_notes', { zipPath, merge });
}

/**
 * Exports all notes and templates to an encrypted backup file.
 * @param destination - The path where the backup file will be created
 * @param password - The password to encrypt the backup with
 * @returns The path to the created backup file
 */
export async function exportEncryptedBackup(destination: string, password: string): Promise<string> {
  return await invoke('export_encrypted_backup', { destination, password });
}

/**
 * Imports notes and templates from an encrypted backup file.
 * @param backupPath - The path to the encrypted backup file
 * @param password - The password to decrypt the backup
 * @param merge - If true, merge with existing notes; if false, replace all notes
 * @returns Import statistics (counts of imported items)
 */
export async function importEncryptedBackup(backupPath: string, password: string, merge: boolean): Promise<ImportResult> {
  return await invoke('import_encrypted_backup', { backupPath, password, merge });
}

/**
 * Exports a single note to a specified destination as Markdown.
 * @param filename - The note filename (e.g., "my-note.md")
 * @param destination - The full path where the file will be exported
 * @param isDaily - Whether this is a daily note
 * @param isWeekly - Whether this is a weekly note
 * @returns The path to the exported file
 */
export async function exportSingleNote(
  filename: string,
  destination: string,
  isDaily: boolean,
  isWeekly: boolean = false
): Promise<string> {
  return await invoke('export_single_note', { filename, destination, isDaily, isWeekly });
}

// Note Color/Metadata Functions

/**
 * Gets the color ID for a specific note.
 * @param notePath - The path identifier for the note (e.g., "daily/2024-12-11.md")
 * @returns The color ID or null if no color is set
 */
export async function getNoteColor(notePath: string): Promise<string | null> {
  return await invoke('get_note_color', { notePath });
}

/**
 * Sets the color ID for a specific note.
 * @param notePath - The path identifier for the note
 * @param colorId - The color ID to set, or null/undefined to remove color
 */
export async function setNoteColor(notePath: string, colorId: string | null): Promise<void> {
  return await invoke('set_note_color', { notePath, colorId });
}

/**
 * Gets all note colors at once (for initial load).
 * @returns A map of note paths to color IDs
 */
export async function getAllNoteColors(): Promise<Record<string, string>> {
  return await invoke('get_all_note_colors');
}

// Folder System Functions

/**
 * Lists all folders in the notes directory recursively.
 * @returns Array of folder info with nested children
 */
export async function listFolders(): Promise<FolderInfo[]> {
  return await invoke('list_folders');
}

/**
 * Creates a new folder in the notes directory.
 * @param path - The folder path to create (e.g., "projects/2025")
 */
export async function createFolder(path: string): Promise<void> {
  await invoke('create_folder', { path });
}

/**
 * Renames a folder.
 * @param oldPath - Current folder path
 * @param newName - New name for the folder (not full path, just the name)
 * @returns The new folder path
 */
export async function renameFolder(oldPath: string, newName: string): Promise<string> {
  return await invoke('rename_folder', { oldPath, newName });
}

/**
 * Deletes a folder.
 * @param path - The folder path to delete
 * @param force - If true, delete folder even if not empty
 */
export async function deleteFolder(path: string, force?: boolean): Promise<void> {
  await invoke('delete_folder', { path, force: force ?? false });
}

/**
 * Moves a note to a different folder.
 * @param notePath - The current note path (relative path within notes/, e.g., "folder/note.md")
 * @param toFolder - Destination folder path, or undefined for root
 * @returns The new note path
 */
export async function moveNote(notePath: string, toFolder?: string): Promise<string> {
  return await invoke('move_note', { notePath, toFolder });
}

/**
 * Moves a folder (and all its contents) to a different folder or to root.
 * Handles naming conflicts by appending (2), (3), etc.
 * @param folderPath - The current folder path
 * @param toFolder - Destination parent folder path, or undefined for root
 * @returns The new folder path
 */
export async function moveFolder(folderPath: string, toFolder?: string): Promise<string> {
  return await invoke('move_folder', { folderPath, toFolder });
}

// Trash System Functions

/**
 * Moves a note to the trash instead of permanently deleting it.
 * @param filename - The note filename (relative path within notes/ or daily/ or weekly/)
 * @param isDaily - Whether this is a daily note
 * @param isWeekly - Whether this is a weekly note
 */
export async function trashNote(filename: string, isDaily: boolean, isWeekly: boolean = false): Promise<void> {
  await invoke('trash_note', { filename, isDaily, isWeekly });
}

/**
 * Lists all notes currently in the trash.
 * @returns Array of trashed notes with metadata
 */
export async function listTrash(): Promise<TrashedNote[]> {
  return await invoke('list_trash');
}

/**
 * Restores a note from the trash to its original location.
 * @param trashId - The unique ID of the trashed note
 */
export async function restoreNote(trashId: string): Promise<void> {
  await invoke('restore_note', { trashId });
}

/**
 * Permanently deletes a single note from the trash.
 * @param trashId - The unique ID of the trashed note
 */
export async function permanentlyDeleteTrash(trashId: string): Promise<void> {
  await invoke('permanently_delete_trash', { trashId });
}

/**
 * Empties the entire trash, permanently deleting all notes.
 */
export async function emptyTrash(): Promise<void> {
  await invoke('empty_trash');
}

/**
 * Cleans up old trash items (older than 7 days).
 * Should be called on app startup.
 * @returns The number of items deleted
 */
export async function cleanupOldTrash(): Promise<number> {
  return await invoke('cleanup_old_trash');
}

/**
 * Moves a folder (and all its contents) to the trash.
 * @param path - The folder path to trash (relative to notes directory)
 */
export async function trashFolder(path: string): Promise<void> {
  await invoke('trash_folder', { path });
}

/**
 * Restores a single note from a trashed folder to the root notes directory.
 * @param trashId - The unique ID of the trashed folder
 * @param noteFilename - The filename of the note within the folder
 */
export async function restoreNoteFromFolder(trashId: string, noteFilename: string): Promise<void> {
  await invoke('restore_note_from_folder', { trashId, noteFilename });
}

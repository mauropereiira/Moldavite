import { invoke } from '@tauri-apps/api/core';
import type { Note, NoteFile } from '@/types';
import { format, parse, isValid } from 'date-fns';
import TurndownService from 'turndown';
import MarkdownIt from 'markdown-it';

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

const md = new MarkdownIt({
  html: true, // Allow HTML tags for unsupported features
  breaks: false,
  linkify: true,
  typographer: false,
});

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
 * Processes wiki links and converts them to custom HTML elements.
 * @param markdown - The Markdown content to convert
 * @returns HTML representation with wiki links processed
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

  return md.render(processed);
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
 * @returns The raw Markdown content
 */
export async function readNote(filename: string, isDaily: boolean): Promise<string> {
  return await invoke('read_note', { filename, isDaily });
}

/**
 * Writes content to a note file, creating it if it doesn't exist.
 * @param filename - The note filename
 * @param content - The Markdown content to write
 * @param isDaily - Whether this is a daily note
 */
export async function writeNote(filename: string, content: string, isDaily: boolean): Promise<void> {
  await invoke('write_note', { filename, content, isDaily });
}

/**
 * Deletes a note file from the file system.
 * @param filename - The note filename to delete
 * @param isDaily - Whether this is a daily note
 */
export async function deleteNote(filename: string, isDaily: boolean): Promise<void> {
  await invoke('delete_note', { filename, isDaily });
}

/**
 * Creates a new standalone note file.
 * @param title - The note title
 * @returns The generated filename
 */
export async function createNote(title: string): Promise<string> {
  return await invoke('create_note', { title });
}

/**
 * Renames a note file.
 * @param oldFilename - Current filename
 * @param newFilename - New filename
 * @param isDaily - Whether this is a daily note
 */
export async function renameNote(oldFilename: string, newFilename: string, isDaily: boolean): Promise<void> {
  await invoke('rename_note', { oldFilename, newFilename, isDaily });
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
 * Extracts the note title from a filename by removing the .md extension.
 * @param filename - The filename (e.g., "my-note.md")
 * @returns The title without extension
 */
export function getNoteTitleFromFilename(filename: string): string {
  return filename.replace(/\.md$/, '');
}

/**
 * Converts a note file metadata object into a full Note object.
 * Formats daily note titles as readable dates.
 * @param file - The note file metadata
 * @param content - The note's HTML content
 * @returns Complete Note object with formatted title
 */
export function filenameToNote(file: NoteFile, content: string): Note {
  const title = file.isDaily && file.date
    ? format(parse(file.date, 'yyyy-MM-dd', new Date()), 'MMMM d, yyyy')
    : getNoteTitleFromFilename(file.name);

  return {
    id: file.path,
    title,
    content,
    createdAt: new Date(), // Would need file metadata for actual values
    updatedAt: new Date(),
    isDaily: file.isDaily,
    date: file.date,
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
 */
export async function lockNote(filename: string, password: string, isDaily: boolean): Promise<void> {
  await invoke('lock_note', { filename, password, isDaily });
}

/**
 * Temporarily unlocks a note to view its content.
 * The note remains encrypted on disk; only returns decrypted content.
 * @param filename - The note filename (e.g., "my-note.md")
 * @param password - The password to decrypt the note
 * @param isDaily - Whether this is a daily note
 * @returns The decrypted content
 */
export async function unlockNote(filename: string, password: string, isDaily: boolean): Promise<string> {
  return await invoke('unlock_note', { filename, password, isDaily });
}

/**
 * Permanently unlocks a note, decrypting it and saving as a regular .md file.
 * @param filename - The note filename (e.g., "my-note.md")
 * @param password - The password to decrypt the note
 * @param isDaily - Whether this is a daily note
 */
export async function permanentlyUnlockNote(filename: string, password: string, isDaily: boolean): Promise<void> {
  await invoke('permanently_unlock_note', { filename, password, isDaily });
}

/**
 * Checks if a note is currently locked.
 * @param filename - The note filename (e.g., "my-note.md")
 * @param isDaily - Whether this is a daily note
 * @returns True if the note is locked
 */
export async function isNoteLocked(filename: string, isDaily: boolean): Promise<boolean> {
  return await invoke('is_note_locked', { filename, isDaily });
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

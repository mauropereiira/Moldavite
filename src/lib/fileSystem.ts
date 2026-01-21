import { invoke } from '@tauri-apps/api/core';
import type { Note, NoteFile, FolderInfo, TrashedNote } from '@/types';
import { format, parse, isValid, getISOWeek, getISOWeekYear, startOfISOWeek, endOfISOWeek } from 'date-fns';
import { hasTag, renameTagInContent } from './tags';
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

// Add rule to ignore checkbox inputs inside task items (we handle them via data-checked attribute)
turndownService.addRule('taskItemCheckbox', {
  filter: function (node) {
    return node.nodeName === 'INPUT' &&
           node.getAttribute &&
           node.getAttribute('type') === 'checkbox';
  },
  replacement: function () {
    return ''; // Don't output anything for checkboxes
  }
});

// Add rule to ignore labels inside task items (they just wrap the checkbox)
turndownService.addRule('taskItemLabel', {
  filter: function (node) {
    // Only match labels that are direct children of task items
    const parent = node.parentNode as HTMLElement | null;
    return !!(node.nodeName === 'LABEL' &&
           parent &&
           parent.getAttribute &&
           parent.getAttribute('data-type') === 'taskItem');
  },
  replacement: function () {
    return ''; // Don't output anything for task item labels
  }
});

// Add rule for divs inside task items - strip block formatting
// TipTap wraps task text in <div><p>text</p></div>, and Turndown treats <div>
// as a block element, adding newlines. This rule prevents that.
turndownService.addRule('taskItemDiv', {
  filter: function (node) {
    const parent = node.parentNode as HTMLElement | null;
    return !!(node.nodeName === 'DIV' &&
           parent &&
           parent.getAttribute &&
           parent.getAttribute('data-type') === 'taskItem');
  },
  replacement: function (content) {
    return content.replace(/^\n+/, '').replace(/\n+$/, '');
  }
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
    // Clean up the content - remove any whitespace artifacts
    const cleanContent = content
      .replace(/^\s+/, '')              // Strip ALL leading whitespace
      .replace(/\s+$/, '')              // Strip ALL trailing whitespace
      .replace(/\\\[[\sx]?\\\]/g, '')   // Remove any escaped checkbox remnants
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

// Add rule to preserve images as HTML with all attributes (width, alignment)
turndownService.addRule('image', {
  filter: 'img',
  replacement: function (_content, node) {
    const element = node as HTMLElement;
    const src = element.getAttribute('src') || '';
    const alt = element.getAttribute('alt') || '';
    const width = element.getAttribute('width');
    const alignment = element.getAttribute('data-alignment');

    // Build attribute string
    let attrs = `src="${src}" alt="${alt}"`;
    if (width) attrs += ` width="${width}"`;
    if (alignment) attrs += ` data-alignment="${alignment}"`;

    return `<img ${attrs}>`;
  }
});

const md = new MarkdownIt({
  html: true, // Allow HTML tags for unsupported features
  breaks: false,
  linkify: true,
  typographer: false,
});

// Add task list plugin for GFM checkbox syntax (- [ ] and - [x])
// Note: label: false produces simpler HTML that's easier to convert to TipTap format
md.use(markdownItTaskLists, {
  enabled: true,
  label: false,
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
    // Data attributes (only specific ones needed for TipTap - no wildcards)
    'data-type', 'data-checked', 'data-target', 'data-label', 'data-wiki-link',
    'data-text-align', 'data-indent', 'data-node-type', 'data-alignment',
    // Form elements
    'type', 'checked', 'disabled',
  ],
  // Only allow explicitly listed data-* attributes above (not all data-* attributes)
  ALLOW_DATA_ATTR: false,
  // Forbid potentially dangerous attributes
  FORBID_ATTR: ['onerror', 'onload', 'onclick', 'onmouseover', 'onfocus', 'onblur'],
  // Don't allow javascript: URLs
  ALLOW_UNKNOWN_PROTOCOLS: false,
  // Allow asset.localhost URLs (Tauri's asset protocol)
  ADD_URI_SAFE_ATTR: ['src'],
};

// Add DOMPurify hook to allow asset.localhost URLs
DOMPurify.addHook('uponSanitizeAttribute', (_node, data) => {
  if (data.attrName === 'src' && data.attrValue) {
    // Allow asset.localhost URLs (Tauri's convertFileSrc output)
    if (data.attrValue.startsWith('http://asset.localhost/') ||
        data.attrValue.startsWith('https://asset.localhost/') ||
        data.attrValue.startsWith('asset://')) {
      data.forceKeepAttr = true;
    }
  }
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
 * Splits mixed task lists (containing both task items and regular items) into separate lists.
 * This is needed because markdown-it merges adjacent task and regular list items into
 * a single <ul class="contains-task-list">, but TipTap expects task lists to only contain
 * task items. Without this, regular bullets inside a task list container get treated as
 * broken/empty task items.
 * @param html - The HTML from markdown-it
 * @returns HTML with mixed lists split into separate task and regular lists
 */
function splitMixedTaskLists(html: string): string {
  // Parse HTML using DOMParser
  const parser = new DOMParser();
  const doc = parser.parseFromString(`<div>${html}</div>`, 'text/html');

  // Find all contains-task-list ULs
  const taskLists = doc.querySelectorAll('ul.contains-task-list');

  taskLists.forEach(ul => {
    const items = Array.from(ul.children);
    const taskItems: Element[] = [];
    const regularItems: Element[] = [];

    // Separate task items from regular items
    items.forEach(li => {
      if (li.classList.contains('task-list-item')) {
        taskItems.push(li);
      } else {
        regularItems.push(li);
      }
    });

    // If mixed, split into two lists
    if (taskItems.length > 0 && regularItems.length > 0) {
      // Create new regular <ul> for non-task items
      const regularUl = doc.createElement('ul');
      regularItems.forEach(item => {
        regularUl.appendChild(item);
      });

      // Insert regular list after the task list
      ul.parentNode?.insertBefore(regularUl, ul.nextSibling);
    }
  });

  // Return the inner HTML of the wrapper div
  const wrapper = doc.body.querySelector('div');
  return wrapper?.innerHTML || html;
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

  // Split mixed task lists (task items + regular items) into separate lists
  // This must happen BEFORE we convert task list containers to TipTap format
  html = splitMixedTaskLists(html);

  // Post-process: Convert markdown-it-task-lists output to TipTap format
  // markdown-it generates: <ul class="contains-task-list"><li class="task-list-item"><input type="checkbox" ...>text</li></ul>
  // TipTap expects: <ul data-type="taskList"><li data-type="taskItem" data-checked="true/false"><label><input.../></label><div><p>text</p></div></li></ul>

  // Replace task list containers
  html = html.replace(
    /<ul class="contains-task-list">/g,
    '<ul data-type="taskList">'
  );

  // Replace task list items - handle both checked and unchecked
  // markdown-it-task-lists produces: <li class="task-list-item enabled"><input class="task-list-item-checkbox" type="checkbox">text</li>
  // Note: class may be "task-list-item" or "task-list-item enabled", and input attributes can be in any order

  // Checked items - look for 'checked' attribute anywhere in the input tag
  // markdown-it-task-lists wraps the input and text in a <p> tag: <li class="..."><p><input ...> text</p></li>
  html = html.replace(
    /<li class="task-list-item[^"]*">\s*(?:<p>\s*)?<input[^>]*checked[^>]*>\s*([\s\S]*?)(?:\s*<\/p>)?\s*<\/li>/gi,
    '<li data-type="taskItem" data-checked="true"><label><input type="checkbox" checked="checked"></label><div><p>$1</p></div></li>'
  );

  // Unchecked items - use negative lookahead to exclude items with 'checked' attribute
  // markdown-it-task-lists wraps the input and text in a <p> tag: <li class="..."><p><input ...> text</p></li>
  html = html.replace(
    /<li class="task-list-item[^"]*">\s*(?:<p>\s*)?<input(?![^>]*checked)[^>]*>\s*([\s\S]*?)(?:\s*<\/p>)?\s*<\/li>/gi,
    '<li data-type="taskItem" data-checked="false"><label><input type="checkbox"></label><div><p>$1</p></div></li>'
  );

  // Sanitize HTML to prevent XSS attacks
  // This removes any potentially dangerous scripts, event handlers, and malicious content
  return DOMPurify.sanitize(html, DOMPURIFY_CONFIG);
}

/**
 * Parses HTML content to count task items and their completion status.
 * Used for calendar indicators to show days with incomplete tasks.
 * @param html - The HTML content to parse
 * @returns Object with totalTasks and completedTasks counts
 */
export function parseTaskStatus(html: string): { totalTasks: number; completedTasks: number } {
  if (!html) return { totalTasks: 0, completedTasks: 0 };

  // Count total task items (TipTap format)
  const taskItemRegex = /data-type="taskItem"/g;
  const totalMatches = html.match(taskItemRegex);
  const totalTasks = totalMatches ? totalMatches.length : 0;

  // Count completed task items - handle both attribute orders
  // Pattern 1: data-checked="true" comes before data-type="taskItem"
  // Pattern 2: data-type="taskItem" comes before data-checked="true"
  const checkedRegex1 = /data-checked="true"[^>]*data-type="taskItem"/g;
  const checkedRegex2 = /data-type="taskItem"[^>]*data-checked="true"/g;
  const checkedMatches1 = html.match(checkedRegex1) || [];
  const checkedMatches2 = html.match(checkedRegex2) || [];
  const completedTasks = checkedMatches1.length + checkedMatches2.length;

  return { totalTasks, completedTasks };
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
    trimmed.startsWith('<div>') ||
    trimmed.startsWith('<img')
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
  images: number;
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

// Tag Management Functions

/**
 * Renames a tag across all notes in the system.
 * @param oldTag - The tag to rename (without #)
 * @param newTag - The new tag name (without #)
 * @returns Number of notes that were updated
 */
export async function renameTagGlobally(oldTag: string, newTag: string): Promise<number> {
  const notes = await listNotes();
  let updatedCount = 0;

  for (const note of notes) {
    try {
      // Read the note content (returns markdown)
      const content = await readNote(note.name, note.isDaily, note.isWeekly);

      // Check if this note has the tag
      if (!hasTag(content, oldTag)) {
        continue;
      }

      // Rename the tag in content
      const updatedContent = renameTagInContent(content, oldTag, newTag);

      // Only write if content actually changed
      if (updatedContent !== content) {
        await writeNote(note.name, updatedContent, note.isDaily, note.isWeekly);
        updatedCount++;
      }
    } catch (err) {
      console.error(`[renameTagGlobally] Failed to process note ${note.name}:`, err);
      // Continue with other notes even if one fails
    }
  }

  return updatedCount;
}

// PDF Export Functions

/**
 * Exports a note to PDF format.
 * @param title - The note title (for filename and header)
 * @param htmlContent - The HTML content to export
 * @param destination - The path where the PDF will be saved
 * @returns The path to the created PDF file
 */
export async function exportNoteToPdf(
  title: string,
  htmlContent: string,
  destination: string
): Promise<string> {
  // Dynamically import html2pdf.js (it's a CJS module)
  const html2pdf = (await import('html2pdf.js')).default;

  // Create a container element with proper styling
  const container = document.createElement('div');
  container.innerHTML = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; padding: 40px; max-width: 700px; margin: 0 auto;">
      <h1 style="font-size: 24px; font-weight: 600; margin-bottom: 24px; color: #1a1a1a;">${title}</h1>
      <div style="font-size: 14px; line-height: 1.6; color: #333;">
        ${htmlContent}
      </div>
    </div>
  `;

  // Apply some styling fixes for PDF
  container.querySelectorAll('a').forEach(link => {
    link.style.color = '#2563eb';
    link.style.textDecoration = 'underline';
  });

  container.querySelectorAll('code').forEach(code => {
    code.style.backgroundColor = '#f3f4f6';
    code.style.padding = '2px 4px';
    code.style.borderRadius = '4px';
    code.style.fontFamily = 'ui-monospace, SFMono-Regular, Menlo, Monaco, monospace';
    code.style.fontSize = '13px';
  });

  container.querySelectorAll('pre').forEach(pre => {
    pre.style.backgroundColor = '#f3f4f6';
    pre.style.padding = '12px';
    pre.style.borderRadius = '8px';
    pre.style.overflow = 'auto';
  });

  container.querySelectorAll('blockquote').forEach(bq => {
    bq.style.borderLeft = '3px solid #d1d5db';
    bq.style.paddingLeft = '16px';
    bq.style.marginLeft = '0';
    bq.style.color = '#6b7280';
  });

  // Generate PDF
  const options = {
    margin: 10,
    filename: destination,
    image: { type: 'jpeg' as const, quality: 0.98 },
    html2canvas: { scale: 2, useCORS: true },
    jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' as const },
  };

  // Generate and save PDF
  const pdfBlob = await html2pdf().set(options).from(container).outputPdf('blob');

  // Convert blob to array buffer for Tauri
  const arrayBuffer = await pdfBlob.arrayBuffer();
  const uint8Array = new Uint8Array(arrayBuffer);

  // Write the PDF file using Tauri
  await invoke('write_binary_file', {
    path: destination,
    contents: Array.from(uint8Array),
  });

  return destination;
}

// Image handling

/**
 * Saves an image to the local images directory.
 * @param data - Base64 encoded image data (can include data URL prefix)
 * @param filename - Original filename (extension determines format)
 * @returns The absolute path to the saved image
 */
export async function saveImage(data: string, filename: string): Promise<string> {
  return await invoke('save_image', { data, filename });
}

/**
 * Converts a File object to a base64 data URL.
 * @param file - The file to convert
 * @returns A promise resolving to the base64 data URL
 */
export function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

/**
 * Image resize options
 */
interface ResizeOptions {
  /** Maximum width in pixels (default: 1200) */
  maxWidth?: number;
  /** Maximum height in pixels (default: 1200) */
  maxHeight?: number;
  /** JPEG quality 0-1 (default: 0.85) */
  quality?: number;
  /** Force output format: 'jpeg' | 'png' | 'webp' | 'auto' (default: 'auto') */
  format?: 'jpeg' | 'png' | 'webp' | 'auto';
}

/**
 * Resizes an image to fit within max dimensions while maintaining aspect ratio.
 * Compresses to JPEG for photos, keeps PNG for images with transparency.
 *
 * @param file - The image file to resize
 * @param options - Resize options
 * @returns Promise resolving to { dataUrl, filename } with resized image
 */
export async function resizeImage(
  file: File,
  options: ResizeOptions = {}
): Promise<{ dataUrl: string; filename: string }> {
  const {
    maxWidth = 1200,
    maxHeight = 1200,
    quality = 0.85,
    format = 'auto',
  } = options;

  return new Promise((resolve, reject) => {
    const img = new Image();
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');

    if (!ctx) {
      reject(new Error('Failed to get canvas context'));
      return;
    }

    img.onload = () => {
      let { width, height } = img;

      // Calculate new dimensions maintaining aspect ratio
      if (width > maxWidth || height > maxHeight) {
        const ratio = Math.min(maxWidth / width, maxHeight / height);
        width = Math.round(width * ratio);
        height = Math.round(height * ratio);
      }

      canvas.width = width;
      canvas.height = height;

      // Draw resized image
      ctx.drawImage(img, 0, 0, width, height);

      // Determine output format
      let outputFormat: string;
      let outputExt: string;
      const originalExt = file.name.split('.').pop()?.toLowerCase() || '';

      if (format === 'auto') {
        // Keep PNG for images that might have transparency, otherwise use JPEG
        if (['png', 'gif', 'svg'].includes(originalExt)) {
          // Check if image actually has transparency by sampling alpha channel
          const imageData = ctx.getImageData(0, 0, width, height);
          let hasTransparency = false;
          for (let i = 3; i < imageData.data.length; i += 4) {
            if (imageData.data[i] < 255) {
              hasTransparency = true;
              break;
            }
          }
          outputFormat = hasTransparency ? 'image/png' : 'image/jpeg';
          outputExt = hasTransparency ? 'png' : 'jpg';
        } else {
          outputFormat = 'image/jpeg';
          outputExt = 'jpg';
        }
      } else {
        outputFormat = `image/${format}`;
        outputExt = format === 'jpeg' ? 'jpg' : format;
      }

      // Generate resized data URL
      const dataUrl = canvas.toDataURL(outputFormat, quality);

      // Generate new filename
      const baseName = file.name.replace(/\.[^/.]+$/, '');
      const filename = `${baseName}.${outputExt}`;

      resolve({ dataUrl, filename });
    };

    img.onerror = () => {
      reject(new Error('Failed to load image'));
    };

    // Load image from file
    const reader = new FileReader();
    reader.onload = () => {
      img.src = reader.result as string;
    };
    reader.onerror = () => {
      reject(new Error('Failed to read file'));
    };
    reader.readAsDataURL(file);
  });
}

/**
 * Processes an image file: resizes if needed and saves to storage.
 * This is the main function to use when adding images to notes.
 *
 * @param file - The image file to process
 * @param options - Resize options
 * @returns The saved file path
 */
export async function processAndSaveImage(
  file: File,
  options: ResizeOptions = {}
): Promise<string> {
  // SVG files don't need resizing
  if (file.type === 'image/svg+xml') {
    const dataUrl = await fileToBase64(file);
    return await saveImage(dataUrl, file.name);
  }

  // Resize the image
  const { dataUrl, filename } = await resizeImage(file, options);

  // Save the resized image
  return await saveImage(dataUrl, filename);
}

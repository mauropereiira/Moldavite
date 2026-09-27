/**
 * Pure frontend backlink helpers for editor HTML and raw wiki-link syntax.
 * Wiki links use `[[Note Name]]` or `[[Display|target-note]]`; normalization is
 * comparison-only and does not replace the canonical filename slug contract in
 * `fileSystem.ts` and `src-tauri/src/wiki.rs`.
 */

import { slugifyNoteName } from './fileSystem';

/**
 * Extracts all wiki link targets from HTML content.
 * @param content - The HTML content to parse
 * @returns Array of target note identifiers (normalized to lowercase)
 */
export function extractWikiLinks(content: string): string[] {
  if (!content) return [];

  const links = new Set<string>();

  const elementRegex = /<wiki-link[^>]*data-target="([^"]+)"[^>]*>/gi;
  let match;

  while ((match = elementRegex.exec(content)) !== null) {
    const target = match[1].trim().toLowerCase();
    if (target) {
      links.add(target);
    }
  }

  // Also match raw [[link]] syntax in case content hasn't been processed
  // Format: [[Note Name]] or [[Display|target]]
  const rawRegex = /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g;

  while ((match = rawRegex.exec(content)) !== null) {
    // If there's a pipe, the target is after the pipe; otherwise it's the whole match
    const target = (match[2] || match[1]).trim().toLowerCase();
    if (target) {
      links.add(target);
    }
  }

  return Array.from(links).sort();
}

/**
 * Normalizes a note name to a consistent format for comparison.
 * Removes .md extension, converts to lowercase, handles path separators.
 * @param noteName - The note name or path
 * @returns Normalized identifier
 */
export function normalizeNoteName(noteName: string): string {
  return noteName.replace(/\.md$/i, '').toLowerCase().trim();
}

/**
 * Checks if a wiki link target matches a note.
 * @param linkTarget - The wiki link target (from [[target]])
 * @param noteName - The note name to compare against
 * @returns True if they match
 */
export function linkMatchesNote(linkTarget: string, noteName: string): boolean {
  const normalizedTarget = normalizeNoteName(linkTarget);
  const normalizedNote = normalizeNoteName(noteName);

  if (normalizedTarget === normalizedNote) return true;

  // Match if target is just the filename without path
  const noteFileName = normalizedNote.split('/').pop() || '';
  if (normalizedTarget === noteFileName) return true;

  return slugifyNoteName(normalizedTarget) === slugifyNoteName(noteFileName);
}

export interface BacklinkInfo {
  /** Path to the note that contains the link */
  sourcePath: string;
  /** Display name of the source note */
  sourceName: string;
  /** Whether the source is a daily note */
  isDaily: boolean;
}

/**
 * Finds all notes that link to a given target note.
 * @param targetNoteName - The note name to find backlinks for
 * @param noteContents - Map of note path -> content
 * @param noteInfo - Map of note path -> { name, isDaily }
 * @returns Array of backlink information
 */
export function findBacklinks(
  targetNoteName: string,
  noteContents: Map<string, string>,
  noteInfo: Map<string, { name: string; isDaily: boolean }>
): BacklinkInfo[] {
  const backlinks: BacklinkInfo[] = [];
  const normalizedTarget = normalizeNoteName(targetNoteName);

  for (const [path, content] of noteContents) {
    const info = noteInfo.get(path);
    if (!info) continue;

    const normalizedSource = normalizeNoteName(info.name);
    if (normalizedSource === normalizedTarget) continue;

    const links = extractWikiLinks(content);

    const hasLink = links.some((link) => linkMatchesNote(link, targetNoteName));

    if (hasLink) {
      backlinks.push({
        sourcePath: path,
        sourceName: info.name.replace(/\.md$/i, ''),
        isDaily: info.isDaily,
      });
    }
  }

  // Sort: daily notes first (by date descending), then regular notes alphabetically
  return backlinks.sort((a, b) => {
    if (a.isDaily && !b.isDaily) return -1;
    if (!a.isDaily && b.isDaily) return 1;
    if (a.isDaily && b.isDaily) {
      return b.sourceName.localeCompare(a.sourceName);
    }
    return a.sourceName.localeCompare(b.sourceName);
  });
}

export interface SnippetPart {
  text: string;
  /** A wiki link, shown as its display text. */
  link: boolean;
}

const HTML_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  '#39': "'",
  nbsp: ' ',
};

function readableMarkdown(markdown: string): string {
  return markdown
    .replace(/<\/?[a-zA-Z][^>]*>/g, '')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/^\s*#{1,6}\s+/gm, '')
    .replace(/\*\*|__|~~|==/g, '')
    .replace(/\\([\\`*_{}[\]()#+\-.!|<>~=])/g, '$1')
    .replace(/&(amp|lt|gt|quot|#39|nbsp);/g, (_entity, name: string) => HTML_ENTITIES[name])
    .replace(/\s+/g, ' ');
}

/**
 * A backlink's raw Markdown context as one line of readable parts. The backend
 * cuts the window by length and marks a cut with `...`, so a tag can be split.
 */
export function snippetParts(context: string): SnippetPart[] {
  const lead = context.startsWith('...') ? '...' : '';
  const tail = context.length > lead.length && context.endsWith('...') ? '...' : '';
  let body = context.slice(lead.length, context.length - tail.length);
  if (lead)
    body = body.replace(/^[^<>]*"\s*\/?>/, '').replace(/^([^[\]]*?)(?:\\?\|[^[\]]*)?\]\]/, '$1');
  if (tail)
    body = body.replace(/<[a-zA-Z/][^>]*$/, '').replace(/\[\[([^\]|]*)(?:\\?\|[^\]]*)?$/, '$1');

  const parts: SnippetPart[] = [];
  const linkRegex = /\[\[([^\]|]+)(?:\\?\|[^\]]*)?\]\]/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = linkRegex.exec(body)) !== null) {
    parts.push({ text: readableMarkdown(body.slice(lastIndex, match.index)), link: false });
    parts.push({ text: match[1].trim(), link: true });
    lastIndex = match.index + match[0].length;
  }
  parts.push({ text: readableMarkdown(body.slice(lastIndex)), link: false });

  const first = parts[0];
  const last = parts[parts.length - 1];
  first.text = lead + first.text.trimStart();
  last.text = last.text.trimEnd() + tail;
  return parts.filter((part) => part.text !== '');
}

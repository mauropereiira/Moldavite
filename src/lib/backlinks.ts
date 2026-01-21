/**
 * Backlinks utilities for extracting and managing wiki link references.
 * Wiki links use the format [[Note Name]] or [[Display|target-note]].
 */

/**
 * Extracts all wiki link targets from HTML content.
 * @param content - The HTML content to parse
 * @returns Array of target note identifiers (normalized to lowercase)
 */
export function extractWikiLinks(content: string): string[] {
  if (!content) return [];

  const links = new Set<string>();

  // Match wiki-link elements with data-target attribute
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
  return noteName
    .replace(/\.md$/i, '')
    .toLowerCase()
    .trim();
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

  // Direct match
  if (normalizedTarget === normalizedNote) return true;

  // Match if target is just the filename without path
  const noteFileName = normalizedNote.split('/').pop() || '';
  if (normalizedTarget === noteFileName) return true;

  return false;
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
    // Don't include self-references
    const info = noteInfo.get(path);
    if (!info) continue;

    const normalizedSource = normalizeNoteName(info.name);
    if (normalizedSource === normalizedTarget) continue;

    // Extract wiki links from this note
    const links = extractWikiLinks(content);

    // Check if any link points to our target
    const hasLink = links.some(link => linkMatchesNote(link, targetNoteName));

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
      // Sort dates descending (most recent first)
      return b.sourceName.localeCompare(a.sourceName);
    }
    // Regular notes alphabetically
    return a.sourceName.localeCompare(b.sourceName);
  });
}

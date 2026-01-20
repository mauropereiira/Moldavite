/**
 * Tag parsing and management utilities.
 * Tags use the format #tagname (alphanumeric + hyphens).
 */

// Regex to match hashtags: must start with letter, can contain letters, numbers, hyphens
const TAG_REGEX = /#([a-zA-Z][a-zA-Z0-9-]*)/g;

/**
 * Extracts all tags from content (HTML or plain text).
 * Tags are normalized to lowercase.
 * Ignores hashtags inside URLs (fragment identifiers).
 * @param content - The content to extract tags from
 * @returns Array of unique tags (without the # prefix)
 */
export function extractTags(content: string): string[] {
  if (!content) return [];

  // Strip HTML tags to get plain text
  let plainText = content.replace(/<[^>]*>/g, ' ');

  // Remove URLs to avoid matching fragment identifiers as tags
  // Matches http://, https://, and www. URLs
  plainText = plainText.replace(/https?:\/\/[^\s<>"']+/gi, ' ');
  plainText = plainText.replace(/www\.[^\s<>"']+/gi, ' ');

  const tags = new Set<string>();
  let match;

  while ((match = TAG_REGEX.exec(plainText)) !== null) {
    tags.add(match[1].toLowerCase());
  }

  // Reset regex lastIndex for next use
  TAG_REGEX.lastIndex = 0;

  return Array.from(tags).sort();
}

/**
 * Extracts tags from markdown content.
 * Ignores hashtags inside URLs (fragment identifiers).
 * @param markdown - The markdown content
 * @returns Array of unique tags (without the # prefix)
 */
export function extractTagsFromMarkdown(markdown: string): string[] {
  if (!markdown) return [];

  // Remove URLs to avoid matching fragment identifiers as tags
  let text = markdown.replace(/https?:\/\/[^\s<>"']+/gi, ' ');
  text = text.replace(/www\.[^\s<>"']+/gi, ' ');

  const tags = new Set<string>();
  let match;

  while ((match = TAG_REGEX.exec(text)) !== null) {
    tags.add(match[1].toLowerCase());
  }

  TAG_REGEX.lastIndex = 0;

  return Array.from(tags).sort();
}

/**
 * Checks if a string is a valid tag name.
 * @param tag - The tag name to validate (without #)
 * @returns True if valid
 */
export function isValidTag(tag: string): boolean {
  return /^[a-zA-Z][a-zA-Z0-9-]*$/.test(tag);
}

/**
 * Normalizes a tag to lowercase.
 * @param tag - The tag to normalize
 * @returns Normalized tag
 */
export function normalizeTag(tag: string): string {
  return tag.toLowerCase().trim();
}

/**
 * Checks if content contains a specific tag.
 * @param content - The content to search
 * @param tag - The tag to find (without #)
 * @returns True if tag is found
 */
export function hasTag(content: string, tag: string): boolean {
  const tags = extractTags(content);
  return tags.includes(normalizeTag(tag));
}

/**
 * Aggregates tags from multiple note contents.
 * @param noteContents - Array of note content strings
 * @returns Map of tag -> count
 */
export function aggregateTags(noteContents: string[]): Map<string, number> {
  const tagCounts = new Map<string, number>();

  for (const content of noteContents) {
    const tags = extractTags(content);
    for (const tag of tags) {
      tagCounts.set(tag, (tagCounts.get(tag) || 0) + 1);
    }
  }

  return tagCounts;
}

/**
 * Sorts tags by count (descending) then alphabetically.
 * @param tagCounts - Map of tag -> count
 * @returns Sorted array of [tag, count] pairs
 */
export function sortTagsByCount(tagCounts: Map<string, number>): [string, number][] {
  return Array.from(tagCounts.entries()).sort((a, b) => {
    // Sort by count descending
    if (b[1] !== a[1]) return b[1] - a[1];
    // Then alphabetically
    return a[0].localeCompare(b[0]);
  });
}

/**
 * Renames a tag in content by replacing all occurrences.
 * Preserves the original case of the # symbol position.
 * @param content - The content to modify
 * @param oldTag - The tag to replace (without #)
 * @param newTag - The new tag name (without #)
 * @returns Updated content with tag renamed
 */
export function renameTagInContent(content: string, oldTag: string, newTag: string): string {
  if (!content || !oldTag || !newTag) return content;

  // Create a regex that matches the tag case-insensitively
  // but only when followed by word boundary (space, punctuation, end of line)
  const escapedOldTag = oldTag.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');
  const tagRegex = new RegExp(`#${escapedOldTag}(?=[\\s.,!?;:\\]\\)}"'<>]|$)`, 'gi');

  return content.replace(tagRegex, `#${newTag}`);
}

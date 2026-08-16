/**
 * Pure tag parsing, normalization, aggregation, and content-rewrite helpers.
 * Tags use `#tagname`, begin with an ASCII letter, and contain only letters,
 * numbers, or hyphens. Public extractors return lowercase, de-duplicated names.
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
  const urlRegex = /(?:https?:\/\/|www\.)[^\s<>"']+/gi;
  const excludedElements = new Set(['a', 'code', 'pre', 'script', 'style']);
  let excludedDepth = 0;
  let cursor = 0;
  let result = '';

  const replacePlainText = (text: string) => {
    let urlEnd = 0;
    let rewritten = '';
    for (const match of text.matchAll(urlRegex)) {
      const start = match.index ?? 0;
      rewritten += text.slice(urlEnd, start).replace(tagRegex, `#${newTag}`);
      rewritten += match[0];
      urlEnd = start + match[0].length;
    }
    return rewritten + text.slice(urlEnd).replace(tagRegex, `#${newTag}`);
  };

  const findBalancedEnd = (text: string, start: number, open: string, close: string) => {
    let depth = 0;
    for (let index = start; index < text.length; index++) {
      if (text[index] === '\\') {
        index += 1;
      } else if (text[index] === open) {
        depth += 1;
      } else if (text[index] === close) {
        depth -= 1;
        if (depth === 0) return index;
      }
    }
    return -1;
  };

  const replaceText = (text: string) => {
    if (excludedDepth > 0) return text;

    let plainStart = 0;
    let index = 0;
    let rewritten = '';
    const preserveThrough = (end: number) => {
      rewritten += replacePlainText(text.slice(plainStart, index));
      rewritten += text.slice(index, end);
      index = end;
      plainStart = end;
    };

    while (index < text.length) {
      const character = text[index];
      const atLineStart = index === 0 || text[index - 1] === '\n';

      // Inline and fenced code use matching backtick runs. Tilde runs are
      // fences only, and an unclosed fence owns the rest of the document.
      if (character === '`' || (character === '~' && atLineStart)) {
        let runEnd = index + 1;
        while (text[runEnd] === character) runEnd += 1;
        const runLength = runEnd - index;
        if (character === '`' || runLength >= 3) {
          const marker = character.repeat(runLength);
          const closing = text.indexOf(marker, runEnd);
          if (closing !== -1) {
            preserveThrough(closing + runLength);
            continue;
          }
          if (runLength >= 3 && atLineStart) {
            preserveThrough(text.length);
            continue;
          }
        }
      }

      // Four-space and tab-indented Markdown blocks are code/pre content too.
      if (atLineStart && (text.startsWith('    ', index) || character === '\t')) {
        let blockEnd = text.indexOf('\n', index);
        if (blockEnd === -1) blockEnd = text.length;
        while (blockEnd < text.length) {
          const nextLine = blockEnd + 1;
          if (
            text.startsWith('    ', nextLine) ||
            text[nextLine] === '\t' ||
            text[nextLine] === '\n'
          ) {
            blockEnd = text.indexOf('\n', nextLine);
            if (blockEnd === -1) {
              blockEnd = text.length;
              break;
            }
          } else {
            break;
          }
        }
        preserveThrough(blockEnd);
        continue;
      }

      // Preserve both the label and destination of inline/reference links and
      // images. A tag shown as link text is not an editable tag text node.
      const bracketStart = character === '[' ? index : character === '!' ? index + 1 : -1;
      if (bracketStart !== -1 && text[bracketStart] === '[') {
        const labelEnd = findBalancedEnd(text, bracketStart, '[', ']');
        if (labelEnd !== -1) {
          let destinationStart = labelEnd + 1;
          while (/\s/.test(text[destinationStart] ?? '')) destinationStart += 1;

          let linkEnd = -1;
          if (text[destinationStart] === '(') {
            linkEnd = findBalancedEnd(text, destinationStart, '(', ')');
          } else if (text[destinationStart] === '[') {
            linkEnd = findBalancedEnd(text, destinationStart, '[', ']');
          } else if (text[destinationStart] === ':') {
            const newline = text.indexOf('\n', destinationStart);
            linkEnd = newline === -1 ? text.length - 1 : newline - 1;
          }

          if (linkEnd !== -1) {
            preserveThrough(linkEnd + 1);
            continue;
          }
        }
      }

      index += 1;
    }

    return rewritten + replacePlainText(text.slice(plainStart));
  };

  while (cursor < content.length) {
    let tagStart = content.indexOf('<', cursor);
    while (tagStart !== -1) {
      const candidate = content.slice(tagStart);
      const isMarkup =
        candidate.startsWith('<!--') ||
        /^<\/?[a-zA-Z][\w:-]*(?=[\s/>])/.test(candidate) ||
        /^<(?:https?:\/\/|mailto:)[^<>\n]+>/.test(candidate);
      if (isMarkup) break;
      tagStart = content.indexOf('<', tagStart + 1);
    }
    if (tagStart === -1) {
      result += replaceText(content.slice(cursor));
      break;
    }

    result += replaceText(content.slice(cursor, tagStart));

    if (content.startsWith('<!--', tagStart)) {
      const commentEnd = content.indexOf('-->', tagStart + 4);
      const end = commentEnd === -1 ? content.length : commentEnd + 3;
      result += content.slice(tagStart, end);
      cursor = end;
      continue;
    }

    let quote: '"' | "'" | null = null;
    let tagEnd = tagStart + 1;
    for (; tagEnd < content.length; tagEnd++) {
      const character = content[tagEnd];
      if (quote) {
        if (character === quote) quote = null;
      } else if (character === '"' || character === "'") {
        quote = character;
      } else if (character === '>') {
        tagEnd += 1;
        break;
      }
    }

    const tag = content.slice(tagStart, tagEnd);
    const tagName = tag.match(/^<\s*\/?\s*([a-zA-Z][\w:-]*)/)?.[1].toLowerCase();
    const isClosing = /^<\s*\//.test(tag);
    const isSelfClosing = /\/\s*>$/.test(tag);
    if (tagName && excludedElements.has(tagName)) {
      if (isClosing) {
        excludedDepth = Math.max(0, excludedDepth - 1);
      } else if (!isSelfClosing) {
        excludedDepth += 1;
      }
    }

    result += tag;
    cursor = tagEnd;
  }

  return result;
}

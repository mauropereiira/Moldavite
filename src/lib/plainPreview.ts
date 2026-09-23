/**
 * One line of plain text from a note's Markdown, for list previews. Syntax
 * that would print as punctuation (table pipes and rules, list and task
 * markers, emphasis, link and image syntax, backslash escapes) is removed;
 * the words stay.
 *
 * Escaped characters are swapped for placeholders first and put back last, so
 * a literal `\[` or `\|` is never read as syntax. No lookbehind: macOS 10.15's
 * WebKit, which the desktop app still supports, rejects it when parsing.
 */
const ESCAPED = /\\([\\`*_{}[\]()#+\-.!|>~=])/g;
const PLACEHOLDER = /([0-9a-f]+)/g;

export function markdownToPlainPreview(markdown: string, maxChars: number): string {
  if (!markdown) return '';
  const text = markdown
    .replace(ESCAPED, (_, char: string) => `${char.charCodeAt(0).toString(16)}`)
    .replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '')
    .split(/\r?\n/)
    .filter((line) => !/^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/.test(line))
    .map((line) =>
      line
        .replace(/^\s*#{1,6}\s+/, '')
        .replace(/^\s*>\s?/, '')
        .replace(/^\s*(?:[-*+]|\d+[.)])\s+(?:\[[ xX]\]\s+)?/, '')
        // Before the table pipes, which a piped [[label|target]] also holds.
        .replace(/\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g, '$1')
        .replace(/^\s*\||\|\s*$/g, '')
        .replace(/\|/g, ' ')
    )
    .join(' ')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/<[^>]+>/g, '')
    .replace(/\*\*|__|==|~~|[*_`~]/g, '')
    .replace(PLACEHOLDER, (_, hex: string) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/\s+/g, ' ')
    .trim();
  return text.length > maxChars ? `${text.slice(0, maxChars).trimEnd()}…` : text;
}

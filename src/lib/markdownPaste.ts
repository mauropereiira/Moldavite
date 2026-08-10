/**
 * Conservative detection for raw Markdown pasted into the rich-text editor.
 * A positive result opts the clipboard text into Moldavite's Markdown-to-HTML
 * pipeline, so patterns here must be stronger than ordinary punctuation.
 */

const SUPPORTED_ATX_HEADING = /^[ \t]{0,3}#{1,3}[ \t]+\S/m;
const UNORDERED_LIST_ITEM = /^[ \t]{0,3}[-+*][ \t]+\S/m;
const ORDERED_LIST_ITEM = /^[ \t]{0,3}\d+\.[ \t]+\S/m;
const BLOCKQUOTE = /^[ \t]{0,3}>[ \t]+\S/m;
const FENCED_CODE_BLOCK = /^[ \t]{0,3}(?:`{3,}|~{3,})[^\n]*$/m;
const HORIZONTAL_RULE = /^[ \t]{0,3}(?:(?:\*[ \t]*){3,}|(?:-[ \t]*){3,}|(?:_[ \t]*){3,})$/m;

const STRONG = /(\*\*|__)(?=\S)(?:[^\n]*?\S)?\1/;
const EMPHASIS_ASTERISK = /(^|[\s([{"'])\*(?=\S)(?:[^*\n]*\S)?\*(?=$|[\s)\]}.,!?;:'"])/m;
const EMPHASIS_UNDERSCORE = /(^|[\s([{"'])_(?=\S)(?:[^_\n]*\S)?_(?=$|[\s)\]}.,!?;:'"])/m;
const STRIKETHROUGH = /~~(?=\S)(?:[^\n]*?\S)?~~/;
const INLINE_CODE = /(^|[^`])`(?=\S)(?:[^`\n]*\S)?`(?!`)/m;
const MARKDOWN_LINK = /\[[^\]\n]+\]\((?![ \t]*\))[^\s)\n]+(?:[ \t]+["'][^"'\n]*["'])?[ \t]*\)/;
const WIKI_LINK = /\[\[[^\]|\n]*\S[^\]|\n]*(?:\|[^\]\n]*\S[^\]\n]*)?\]\]/;

const MARKDOWN_PATTERNS = [
  SUPPORTED_ATX_HEADING,
  UNORDERED_LIST_ITEM,
  ORDERED_LIST_ITEM,
  BLOCKQUOTE,
  FENCED_CODE_BLOCK,
  HORIZONTAL_RULE,
  STRONG,
  EMPHASIS_ASTERISK,
  EMPHASIS_UNDERSCORE,
  STRIKETHROUGH,
  INLINE_CODE,
  MARKDOWN_LINK,
  WIKI_LINK,
];

/**
 * Returns true when clipboard text contains a strong Markdown signal that the
 * current TipTap schema can faithfully represent.
 */
export function looksLikeMarkdown(text: string): boolean {
  if (!text.trim()) return false;

  const normalized = text.replace(/\r\n?/g, '\n');
  return MARKDOWN_PATTERNS.some((pattern) => pattern.test(normalized));
}

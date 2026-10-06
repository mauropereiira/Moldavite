/**
 * Frontend filesystem boundary: note conversion, addressing, conflict tracking,
 * and typed Tauri IPC wrappers.
 *
 * Editor state is trusted HTML, disk state is Markdown, and every Markdown-to-HTML
 * conversion is sanitized before it reaches TipTap. Daily and weekly commands use
 * bare filenames; standalone commands use paths relative to `notes/` and must never
 * derive those paths from display titles. The module-level hash registry records the
 * last observed body for optimistic external-edit conflict safety; reads and successful
 * writes advance a note's base hash, while moves preserve it under the new address.
 */

import { safeInvoke as invoke } from './ipc';
import type { Note, NoteFile, FolderInfo, TrashedNote } from '@/types';
import { format, parse, getISOWeek, getISOWeekYear } from 'date-fns';
import { hasTag, renameTagInContent } from './tags';
import TurndownService from 'turndown';
import MarkdownIt from 'markdown-it';
import markdownItTaskLists from 'markdown-it-task-lists';
import { isBlank, markdownSourcePlugin, type SourceMapEnv } from './markdownSource';
import { replayCharacters, replayLines } from './markdownMerge';
import DOMPurify from 'dompurify';
import {
  getForgeRoot,
  loadForgeRoot,
  refreshForgeRoot,
  resolveForgeImageSrc,
  toForgeImageSrc,
} from './forgeImages';

/**
 * Off while converting a loose note, a file outside the Forge: its `images/x`
 * would otherwise be read and rewritten as the open Forge's image. Conversion
 * is synchronous, so a module flag set around one call cannot leak into another.
 */
let forgeImagesEnabled = true;

export interface ConversionOptions {
  forgeImages?: boolean;
  /** False writes every block as the editor would, ignoring the Markdown it was loaded from. */
  sources?: boolean;
}

function convertWith<T>(options: ConversionOptions | undefined, convert: () => T): T {
  if (options?.forgeImages !== false) return convert();
  const previous = forgeImagesEnabled;
  forgeImagesEnabled = false;
  try {
    return convert();
  } finally {
    forgeImagesEnabled = previous;
  }
}

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
  },
});

turndownService.addRule('strikethrough', {
  filter: (node) => node.nodeName === 'S' || node.nodeName === 'DEL' || node.nodeName === 'STRIKE',
  replacement: (content) => (content.trim() ? `~~${content}~~` : content),
});

turndownService.addRule('highlight', {
  filter: ['mark'],
  replacement: function (content) {
    return `<mark>${content}</mark>`;
  },
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
  },
});

turndownService.addRule('wikiLink', {
  filter: (node) => {
    return (
      node.nodeName === 'WIKI-LINK' ||
      (node.getAttribute && node.getAttribute('data-wiki-link') === 'true')
    );
  },
  replacement: (content, node) => {
    const element = node as HTMLElement;
    const label = element.getAttribute('data-label') || content || '';
    const rawTarget = element.getAttribute('data-raw-target');

    return rawTarget ? `[[${label}|${rawTarget}]]` : `[[${label}]]`;
  },
});

// Add rule to ignore checkbox inputs inside task items (we handle them via data-checked attribute)
turndownService.addRule('taskItemCheckbox', {
  filter: function (node) {
    return (
      node.nodeName === 'INPUT' && node.getAttribute && node.getAttribute('type') === 'checkbox'
    );
  },
  replacement: function () {
    return '';
  },
});

// Add rule to ignore labels inside task items (they just wrap the checkbox)
turndownService.addRule('taskItemLabel', {
  filter: function (node) {
    const parent = node.parentNode as HTMLElement | null;
    return !!(
      node.nodeName === 'LABEL' &&
      parent &&
      parent.getAttribute &&
      parent.getAttribute('data-type') === 'taskItem'
    );
  },
  replacement: function () {
    return '';
  },
});

// TipTap wraps task text in <div><p>text</p></div>, and Turndown treats <div>
// as a block element, adding newlines. This rule prevents that.
turndownService.addRule('taskItemDiv', {
  filter: function (node) {
    const parent = node.parentNode as HTMLElement | null;
    return !!(
      node.nodeName === 'DIV' &&
      parent &&
      parent.getAttribute &&
      parent.getAttribute('data-type') === 'taskItem'
    );
  },
  replacement: function (content) {
    return content.replace(/^\n+/, '').replace(/\n+$/, '');
  },
});

/**
 * The marker for an item of `item`'s list, spelled as the note spelled the
 * list's first item (`*   `, `1)`), so an edited or added item matches the
 * items around it. A list made in the editor uses `fallback` and one space.
 */
function listItemMarker(item: Element, fallback: string): string {
  const list = item.parentElement;
  const ordered = list?.nodeName === 'OL';
  const written = /^([-*+.)])([1-4])$/.exec(list?.getAttribute('data-md-marker') ?? '');
  const fits = written !== null && ordered === /[.)]/.test(written[1]);
  const marker = fits ? written[1] : null;
  const spaces = ' '.repeat(fits ? Number(written[2]) : 1);
  if (!ordered) return `${marker ?? fallback}${spaces}`;
  const start = Number(list.getAttribute('start') ?? 1);
  const index = Array.prototype.indexOf.call(list.children, item);
  return `${start + index}${marker ?? '.'}${spaces}`;
}

turndownService.addRule('taskItem', {
  filter: function (node) {
    return (
      node.nodeName === 'LI' && node.getAttribute && node.getAttribute('data-type') === 'taskItem'
    );
  },
  replacement: function (content, node) {
    const element = node as HTMLElement;
    const isChecked = element.getAttribute('data-checked') === 'true';
    const checkbox = isChecked ? '[x]' : '[ ]';
    const marker = listItemMarker(element, '-');
    const cleanContent = content
      .replace(/^\s+/, '')
      .replace(/\s+$/, '')
      // Only a remnant at the start: the same brackets later are the user's text.
      .replace(ESCAPED_CHECKBOX, '')
      .trim()
      // A blank line would close the list, so a nested task list has to stay
      // attached to its parent item and indented under the `- [ ] ` marker.
      .replace(/\n{2,}/g, '\n')
      .replace(/\n/g, `\n${' '.repeat(marker.length)}`);
    const gap = node.nextSibling && element.getAttribute('data-gap-after') === 'true' ? '\n' : '';
    return `${marker}${checkbox} ${cleanContent}\n${gap}`;
  },
});

/**
 * The editor splits a list where bullets meet tasks, but in Markdown the two
 * runs are one list, so they meet with a blank line only if the note had one.
 */
function joinsPreviousList(list: Element | null): boolean {
  const previous = list?.previousElementSibling;
  return (
    list?.nodeName === 'UL' &&
    previous?.nodeName === 'UL' &&
    previous.lastElementChild?.getAttribute('data-gap-after') !== 'true'
  );
}

function listMarkdown(list: Element, content: string): string {
  const before = joinsPreviousList(list) ? '\n' : '\n\n';
  const after = joinsPreviousList(list.nextElementSibling) ? '\n' : '\n\n';
  return before + content.replace(/^\n+|\n+$/g, '') + after;
}

turndownService.addRule('taskList', {
  filter: function (node) {
    return (
      node.nodeName === 'UL' && node.getAttribute && node.getAttribute('data-type') === 'taskList'
    );
  },
  replacement: function (content, node) {
    const parent = node.parentNode as Element | null;
    return parent?.nodeName === 'LI' ? '\n' + content + '\n' : listMarkdown(node, content);
  },
});

turndownService.addRule('list', {
  filter: (node) =>
    (node.nodeName === 'UL' || node.nodeName === 'OL') &&
    node.getAttribute('data-type') !== 'taskList',
  replacement: (content, node) => {
    const parent = node.parentNode as Element | null;
    if (parent?.nodeName === 'LI' && parent.lastElementChild === node) return '\n' + content;
    return listMarkdown(node, content);
  },
});

/** Whether `node` sits directly in a list item with no blank line between its blocks. */
function inTightListItem(node: Node): boolean {
  const item = node.parentNode as Element | null;
  return item?.nodeName === 'LI' && item.getAttribute('data-gap-inside') !== 'true';
}

/**
 * A block inside a tight list item follows the line above it directly: a blank
 * line between the blocks of an item would make the whole list loose.
 */
function blockMarkdown(node: Node, markdown: string): string {
  const element = node as Element;
  const tight = inTightListItem(node);
  const before = tight && node.previousSibling ? '\n' : '\n\n';
  const after = tight && /^[UO]L$/.test(element.nextElementSibling?.nodeName ?? '') ? '\n' : '\n\n';
  return before + markdown + after;
}

// TipTap wraps every list item's text in a paragraph, so without this rule a
// tight list saved with a blank line between its items and before each
// nested list. Two paragraphs in one item still need the blank line.
turndownService.addRule('tightListParagraph', {
  filter: (node) => node.nodeName === 'P' && !node.style.textAlign && inTightListItem(node),
  replacement: (content, node) => {
    const element = node as Element;
    const before = element.previousElementSibling?.nodeName === 'P' ? '\n\n' : '\n';
    const after = element.nextElementSibling?.nodeName === 'P' ? '\n\n' : '\n';
    return before + content + after;
  },
});

// Turndown's default writes "-   item" and "1.  item"; other editors and
// CommonMark examples use one space after the marker, so outside files keep
// their lists when saved. Blank lines stay empty rather than indented.
turndownService.addRule('listItem', {
  filter: (node) => node.nodeName === 'LI' && node.getAttribute('data-type') !== 'taskItem',
  replacement: function (content, node, options) {
    const prefix = listItemMarker(node, options.bulletListMarker ?? '-');
    const indent = ' '.repeat(prefix.length);
    const body = content
      .replace(/^\n+/, '')
      .replace(/\n+$/, '')
      .replace(/\n(?=[^\n])/g, `\n${indent}`);
    const gap = node.getAttribute('data-gap-after') === 'true';
    const trailer = node.nextSibling ? (gap ? '\n\n' : '\n') : '';
    return prefix + body + trailer;
  },
});

turndownService.addRule('blockquote', {
  filter: 'blockquote',
  replacement: (content, node) =>
    blockMarkdown(
      node,
      content
        .replace(/^\n+|\n+$/g, '')
        .replace(/^/gm, '> ')
        .replace(/^> $/gm, '>')
    ),
});

const fencedCodeBlock = (turndownService.options as { rules: Record<string, TurndownService.Rule> })
  .rules.fencedCodeBlock;

turndownService.addRule('fencedCodeBlock', {
  filter: fencedCodeBlock.filter,
  replacement: (content, node, options) =>
    blockMarkdown(
      node,
      (fencedCodeBlock.replacement?.(content, node, options) ?? '').replace(/^\n+|\n+$/g, '')
    ),
});

turndownService.addRule('rawMarkdown', {
  filter: (node) => node.nodeName === 'PRE' && node.getAttribute('data-type') === 'raw-markdown',
  replacement: (_content, node) => blockMarkdown(node, node.textContent ?? ''),
});

turndownService.addRule('rawInline', {
  filter: (node) => node.nodeName === 'SPAN' && node.getAttribute('data-type') === 'raw-inline',
  replacement: (_content, node) => node.textContent ?? '',
});

turndownService.addRule('footnoteRef', {
  filter: (node) => node.nodeName === 'SPAN' && node.getAttribute('data-type') === 'footnote-ref',
  replacement: (_content, node) => `[^${(node as Element).getAttribute('data-label') ?? ''}]`,
});

const INLINE_TAG = /^(?:STRONG|B|EM|I|U|S|DEL|STRIKE|MARK|CODE|SPAN)$/;

/** The text beside `node` in its block, reached through the marks around it. */
function adjacentText(node: Node, forward: boolean): string {
  for (let at: Node | null = node; at; at = at.parentNode) {
    const sibling = forward ? at.nextSibling : at.previousSibling;
    if (sibling) return sibling.textContent ?? '';
    if (!INLINE_TAG.test(at.parentNode?.nodeName ?? '')) break;
  }
  return '';
}

/** Whether markdown-it reads `source` as exactly `before`, one link to `href` showing `text`, then `after`. */
function readsAsLink(source: string, before: string, after: string, link: Element): boolean {
  const shape = (md.parseInline(source, {})[0]?.children ?? []).map((token) =>
    token.type === 'link_open' ? `link ${token.attrGet('href')}` : `${token.type} ${token.content}`
  );
  const expected = [
    ...(before ? [`text ${before}`] : []),
    `link ${link.getAttribute('href')}`,
    `text ${link.textContent}`,
    'link_close ',
    ...(after ? [`text ${after}`] : []),
  ];
  return shape.join('\n') === expected.join('\n');
}

/**
 * A URL the note wrote bare stays bare, and `<url>` keeps its brackets. The
 * URL is written as the note spelled it, else as its text or href, and only
 * if markdown-it would read it back as the same link beside the text now
 * around it. Text typed against a bare URL would extend or break it, so that
 * falls back to `<url>`, and a link whose text or target changed to `[text](url)`.
 */
function sourceLink(link: Element): string | null {
  const bare = link.classList.contains('md-linkify');
  if (!bare && !link.classList.contains('md-autolink')) return null;
  let inner: Node = link;
  while (inner.childNodes.length === 1 && INLINE_TAG.test(inner.firstChild?.nodeName ?? '')) {
    inner = inner.childNodes[0];
  }
  if (inner.childNodes.length !== 1 || inner.firstChild?.nodeType !== Node.TEXT_NODE) return null;
  const candidates = [
    ...new Set(
      [link.getAttribute('data-source'), link.textContent, link.getAttribute('href')].filter(
        (url): url is string => !!url
      )
    ),
  ];
  if (bare) {
    const before = adjacentText(link, false).slice(-1);
    const after = /^\S*/.exec(adjacentText(link, true))?.[0] ?? '';
    const found = candidates.find((url) => readsAsLink(before + url + after, before, after, link));
    if (found) return found;
  }
  const angled = candidates.find((url) => readsAsLink(`<${url}>`, '', '', link));
  return angled ? `<${angled}>` : null;
}

const sourceLinks = new WeakMap<Node, string | null>();

turndownService.addRule('sourceLink', {
  filter: (node) => {
    if (node.nodeName !== 'A') return false;
    if (!sourceLinks.has(node)) sourceLinks.set(node, sourceLink(node));
    return sourceLinks.get(node) !== null;
  },
  // A mark inside the link, such as bold, keeps its delimiters around the URL.
  replacement: (content, node) =>
    content.replace(
      turndownService.escape(node.textContent ?? ''),
      () => sourceLinks.get(node) ?? ''
    ),
});

/**
 * Attribute values are written into a raw `<img>` tag, so an unescaped quote in
 * an alt text closes the attribute early. markdown-it then fails to recognise
 * the tag and escapes the whole thing, turning the image into literal text.
 */
function escapeHtmlAttribute(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// Add rule to preserve images as HTML with all attributes (width, alignment)
turndownService.addRule('image', {
  filter: 'img',
  replacement: function (_content, node) {
    const element = node as HTMLElement;
    const rawSrc = element.getAttribute('src') || '';
    const src = (forgeImagesEnabled ? toForgeImageSrc(rawSrc) : null) ?? rawSrc;
    const alt = element.getAttribute('alt') || '';
    const width = element.getAttribute('width');
    const alignment = element.getAttribute('data-alignment');

    let attrs = `src="${escapeHtmlAttribute(src)}" alt="${escapeHtmlAttribute(alt)}"`;
    if (width) attrs += ` width="${escapeHtmlAttribute(width)}"`;
    if (alignment) attrs += ` data-alignment="${escapeHtmlAttribute(alignment)}"`;

    return `<img ${attrs}>`;
  },
});

/**
 * GFM has no syntax for a line break inside a cell, so paragraphs and hard
 * breaks become `<br>`, which markdown-it passes through as inline HTML.
 * Unescaped pipes would end the cell early, including the one in an aliased
 * wiki link, which markdownToHtml accepts escaped.
 */
function tableCellMarkdown(cell: Element): string {
  return turndownService
    .turndown(cell as HTMLElement)
    .trim()
    .replace(/\s*\n+\s*/g, '<br>')
    .replace(/\|/g, '\\|');
}

function tableDelimiter(cell: Element | undefined): string {
  const align = (cell as HTMLElement | undefined)?.style?.textAlign || cell?.getAttribute('align');
  if (align === 'center') return ':---:';
  if (align === 'right') return '---:';
  if (align === 'left') return ':---';
  return '---';
}

/** A hostile colspan of a billion would otherwise allocate a billion cells. */
const MAX_TABLE_SPAN = 1000;

function tableSpan(cell: Element, attribute: string): number {
  const span = parseInt(cell.getAttribute(attribute) ?? '', 10);
  return Number.isFinite(span) && span > 0 ? Math.min(span, MAX_TABLE_SPAN) : 1;
}

/**
 * GFM has no merged cells, so a colspan or rowspan is written out as the
 * grid it covers: the content in its first cell and empty cells for the rest.
 * Writing one Markdown cell per HTML cell shifted every column after a span.
 * The first row is always the header, because GFM requires one and TipTap
 * keeps its header row inside `<tbody>`.
 */
function tableMarkdown(table: HTMLElement): string {
  const rows = Array.from(table.querySelectorAll('tr')).filter(
    (row) => row.closest('table') === table
  );
  const grid: string[][] = rows.map(() => []);
  const firstRowCells: Element[] = [];
  rows.forEach((row, r) => {
    let column = 0;
    for (const cell of Array.from(row.children)) {
      if (!/^T[HD]$/.test(cell.nodeName)) continue;
      while (grid[r][column] !== undefined) column++;
      const colspan = tableSpan(cell, 'colspan');
      const rowspan = Math.min(tableSpan(cell, 'rowspan'), rows.length - r);
      const text = tableCellMarkdown(cell);
      for (let dr = 0; dr < rowspan; dr++) {
        for (let dc = 0; dc < colspan; dc++) {
          grid[r + dr][column + dc] = dr === 0 && dc === 0 ? text : '';
        }
      }
      if (r === 0) for (let dc = 0; dc < colspan; dc++) firstRowCells[column + dc] = cell;
      column += colspan;
    }
  });
  const width = Math.max(1, ...grid.map((row) => row.length));
  const line = (cells: string[]) => `| ${cells.join(' | ')} |`;
  const lines = grid.map((row) => line(Array.from({ length: width }, (_, c) => row[c] ?? '')));
  const delimiter = line(Array.from({ length: width }, (_, c) => tableDelimiter(firstRowCells[c])));
  if (lines.length === 0) return '';
  return [lines[0], delimiter, ...lines.slice(1)].join('\n');
}

turndownService.addRule('table', {
  filter: 'table',
  replacement: (_content, node) => `\n\n${tableMarkdown(node as HTMLElement)}\n\n`,
});

/**
 * Turndown escapes every character that could be Markdown anywhere it appears,
 * so `[note]` was saved as `\[note\]` and `snake_case` as `snake\_case`. The
 * text is escaped the same way here, but each escape is written as this mark,
 * and `resolveEscapes` keeps only those without which the block would read
 * back differently. A note that contains the mark itself is escaped in full.
 */
const OPTIONAL_ESCAPE = '\uFDD0';

// Turndown's own escapes, plus three it misses: `~~` that would strike text
// through, `&name;` that would become a character, and a `1)` list marker.
// markdown-it renders with `html: true`, so a literal `<` that opens a tag-like
// token is re-parsed as HTML on the way back in and DOMPurify drops the unknown
// element: text such as `<Name>` vanished from the note on its next load.
function escapeRules(mark: string): Array<[RegExp, string]> {
  return [
    [/\\/g, `${mark}\\`],
    [/\*/g, `${mark}*`],
    [/^-/, `${mark}-`],
    [/^\+ /, `${mark}+ `],
    [/^=/, `${mark}=`],
    [/^(#{1,6}) /, `${mark}$1 `],
    [/`/g, `${mark}\``],
    [/~/g, `${mark}~`],
    [/\[/g, `${mark}[`],
    [/\]/g, `${mark}]`],
    [/^>/, `${mark}>`],
    [/_/g, `${mark}_`],
    [/^(\d+)([.)]) /, `$1${mark}$2 `],
    [/&(?=#?[A-Za-z0-9]+;)/g, `${mark}&`],
    [/<(?=[A-Za-z!/?])/g, `${mark}<`],
  ];
}

const OPTIONAL_ESCAPES = escapeRules(OPTIONAL_ESCAPE);
const FULL_ESCAPES = escapeRules('\\');
let escapes = OPTIONAL_ESCAPES;
turndownService.escape = (text: string) =>
  escapes.reduce((escaped, [pattern, replacement]) => escaped.replace(pattern, replacement), text);

/** A task marker left at the start of an item's text, escaped as plain text. */
const ESCAPED_CHECKBOX = new RegExp(
  `^[\\\\${OPTIONAL_ESCAPE}]\\[[\\sx]?[\\\\${OPTIONAL_ESCAPE}]\\]`
);

const md = new MarkdownIt({
  html: true, // Allow HTML tags for unsupported features
  breaks: false,
  linkify: true,
  typographer: false,
});

// Note: label: false produces simpler HTML that's easier to convert to TipTap format
md.use(markdownItTaskLists, {
  enabled: true,
  label: false,
});
md.use(markdownSourcePlugin);

// TipTap drops a text node that is only a line break, taking it for the
// indentation between tags, so a soft break between two marks or links (as in
// `**a**\n*b*`) joined their words. A space before it keeps the node.
md.renderer.rules.softbreak = () => ' \n';

/** How Markdown renders, which tells apart two spellings that differ only in escapes or spacing. */
function rendered(markdown: string): string {
  return md.render(wikiLinksToHtml(markdown));
}

/**
 * A bounded memo. Autosave converts every block of a note on each save while
 * the user changes one, and parsing each block again was most of a save.
 */
function memo(limit: number): (key: string, compute: () => string) => string {
  const values = new Map<string, string>();
  return (key, compute) => {
    let value = values.get(key);
    if (value === undefined) {
      value = compute();
      values.set(key, value);
      const oldest = values.keys().next().value;
      if (values.size > limit && oldest !== undefined) values.delete(oldest);
    }
    return value;
  };
}

const resolvedEscapes = memo(2000);

function resolveEscapes(markdown: string): string {
  if (!markdown.includes(OPTIONAL_ESCAPE)) return markdown;
  return resolvedEscapes(markdown, () => resolveEscapesNow(markdown));
}

/**
 * `markdown` with each optional escape kept only where dropping it would
 * change how the block reads back. Halving the escapes tried at a time finds
 * the few that matter without parsing the block once per escape.
 */
function resolveEscapesNow(markdown: string): string {
  const parts = markdown.split(OPTIONAL_ESCAPE);
  const keep = parts.slice(1).map(() => true);
  const write = () => parts.reduce((out, part, i) => out + (keep[i - 1] ? '\\' : '') + part);
  const target = rendered(write());
  const settle = (from: number, to: number) => {
    keep.fill(false, from, to);
    if (rendered(write()) === target) return;
    keep.fill(true, from, to);
    if (to - from === 1) return;
    const middle = (from + to) >> 1;
    settle(from, middle);
    settle(middle, to);
  };
  settle(0, keep.length);
  return write();
}

/** Compare Markdown structure while preserving code and joining soft-wrapped prose. */
export function markdownForComparison(markdown: string): string {
  const source = markdown.replace(/\r\n/g, '\n');
  const tokens = md.parse(source, {});
  return JSON.stringify(
    tokens.map((token) => {
      const children: unknown[] = [];
      for (const child of token.children ?? []) {
        if (child.type === 'text' || child.type === 'softbreak') {
          const text = child.type === 'softbreak' ? ' ' : child.content.replace(/[ \t]+/g, ' ');
          const previous = children[children.length - 1];
          if (typeof previous === 'string') children[children.length - 1] = previous + text;
          else children.push(text);
        } else {
          children.push([
            child.type,
            child.content,
            child.attrs,
            child.type === 'code_inline' ? child.markup : null,
          ]);
        }
      }
      if (token.type === 'table_open' && token.map) {
        return source
          .split('\n')
          .slice(...token.map)
          .map((line) => line.trimEnd());
      }
      return [
        token.type,
        token.nesting,
        token.attrs,
        token.info,
        token.type === 'fence' ? token.markup : null,
        token.type === 'inline' ? children : token.content,
      ];
    })
  );
}

// Allow only tags and attributes needed for note content
const DOMPURIFY_CONFIG = {
  ALLOWED_TAGS: [
    // Text formatting
    'p',
    'br',
    'strong',
    'b',
    'em',
    'i',
    'u',
    's',
    'del',
    'mark',
    'code',
    'pre',
    // Headings
    'h1',
    'h2',
    'h3',
    'h4',
    'h5',
    'h6',
    // Lists
    'ul',
    'ol',
    'li',
    // Blocks
    'blockquote',
    'hr',
    'div',
    'span',
    // Links and media
    'a',
    'img',
    // Tables
    'table',
    'thead',
    'tbody',
    'tfoot',
    'tr',
    'th',
    'td',
    // Form elements for task lists
    'input',
    'label',
    // Custom elements
    'wiki-link',
  ],
  ALLOWED_ATTR: [
    // Global
    'class',
    'id',
    'style',
    // Links
    'href',
    'target',
    'rel',
    // Images
    'src',
    'alt',
    'title',
    'width',
    'height',
    // Tables
    'colspan',
    'rowspan',
    // Data attributes (only specific ones needed for TipTap - no wildcards)
    'data-type',
    'data-checked',
    'data-target',
    'data-label',
    'data-raw-target',
    'data-gap-after',
    'data-gap-inside',
    'data-source',
    'data-md-id',
    'data-md-source',
    'data-md-fresh',
    'data-md-gap',
    'data-md-marker',
    'start',
    'data-wiki-link',
    'data-text-align',
    'data-indent',
    'data-node-type',
    'data-alignment',
    // Form elements
    'type',
    'checked',
    'disabled',
  ],
  // Only allow explicitly listed data-* attributes above (not all data-* attributes)
  ALLOW_DATA_ATTR: false,
  FORBID_ATTR: ['onerror', 'onload', 'onclick', 'onmouseover', 'onfocus', 'onblur'],
  // Don't allow javascript: URLs. `src` is deliberately NOT marked URI-safe:
  // that would skip the scheme check entirely and let `javascript:` through.
  // Tauri's asset URLs are re-admitted by the hook below instead.
  ALLOW_UNKNOWN_PROTOCOLS: false,
};

DOMPurify.addHook('uponSanitizeAttribute', (node, data) => {
  if (data.attrName === 'src' && data.attrValue) {
    const forgeImage =
      forgeImagesEnabled && node.nodeName === 'IMG' ? toForgeImageSrc(data.attrValue) : null;
    if (forgeImage) {
      // Not force-kept: DOMPurify skips writing a rewritten value back when it is.
      data.attrValue = forgeImage;
    } else if (
      data.attrValue.startsWith('http://asset.localhost/') ||
      data.attrValue.startsWith('https://asset.localhost/') ||
      data.attrValue.startsWith('asset://')
    ) {
      // Allow asset.localhost URLs (Tauri's convertFileSrc output)
      data.forceKeepAttr = true;
    }
  }
});

// A `target="_blank"` link hands the opened page a live `window.opener`, which
// it can use to navigate this one. Note bodies are untrusted: they arrive from
// clipped pages, imported vaults, MCP writes and plugins. `noreferrer` is there
// for older WebKit, which honours it but not `noopener`.
DOMPurify.addHook('afterSanitizeAttributes', (node) => {
  if (!(node instanceof Element) || node.tagName !== 'A') return;
  if (node.getAttribute('target') !== '_blank') return;

  const rel = new Set((node.getAttribute('rel') ?? '').split(/\s+/).filter(Boolean));
  rel.add('noopener');
  rel.add('noreferrer');
  node.setAttribute('rel', [...rel].join(' '));
});

/**
 * Slugifies a note name (or filename) for wiki-link resolution. Unicode-aware
 * and NFC-normalized so "Café" keeps its accent — this MUST stay in sync with
 * `note_name_to_filename` in `src-tauri/src/wiki.rs`, which applies the same rule.
 * The mirrored cases are `src/lib/slugify.test.ts` and the tests in `wiki.rs`;
 * update both implementations and both test suites together.
 * @param name - The human-readable note name, with or without .md extension
 * @returns The slug without extension (e.g. "meeting-notes")
 */
export function slugifyNoteName(name: string): string {
  const slug = name
    .normalize('NFC')
    .replace(/\.md$/, '')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, '-')
    .replace(/[^\p{Alphabetic}\p{N}-]/gu, '');
  return slug === '' ? 'untitled' : slug;
}

/**
 * Converts a note name to a valid filename with lowercase and hyphens.
 * @param noteName - The human-readable note name
 * @returns Sanitized filename with .md extension
 */
export function noteNameToFilename(noteName: string): string {
  return slugifyNoteName(noteName) + '.md';
}

/**
 * Converts HTML content to Markdown format for storage.
 * Preserves TipTap-specific features like underline, highlight, and text alignment.
 * @param html - The HTML content to convert
 * @returns Markdown representation
 */
export function htmlToMarkdown(html: string, options?: ConversionOptions): string {
  if (!html || html.trim() === '') return '';
  return convertWith(options, () =>
    withEscapes(html, () => {
      const doc = new DOMParser().parseFromString(
        `<x-turndown id="turndown-root">${html}</x-turndown>`,
        'text/html'
      );
      const root = doc.getElementById('turndown-root');
      if (root && options?.sources === false) {
        for (const element of Array.from(root.querySelectorAll('[data-md-source]'))) {
          element.removeAttribute('data-md-source');
        }
      }
      return root ? blocksToMarkdown(root) : '';
    })
  );
}

/**
 * `html` without the Markdown sources the editor keeps on its blocks, for HTML
 * that leaves the note: pasted into another, or published.
 */
export function withoutMarkdownSources(html: string): string {
  if (!html.includes('data-md-')) return html;
  const doc = new DOMParser().parseFromString(html, 'text/html');
  for (const element of Array.from(doc.body.querySelectorAll('*'))) {
    for (const name of element.getAttributeNames()) {
      if (name.startsWith('data-md-')) element.removeAttribute(name);
    }
  }
  return doc.body.innerHTML;
}

function withEscapes<T>(text: string, convert: () => T): T {
  const previous = escapes;
  escapes = text.includes(OPTIONAL_ESCAPE) ? FULL_ESCAPES : OPTIONAL_ESCAPES;
  try {
    return convert();
  } finally {
    escapes = previous;
  }
}

/**
 * One top-level block of the document: the elements one block of the note's
 * Markdown became (a list the editor split where bullets meet tasks is
 * several), or a run of loose inline content.
 */
interface SourceUnit {
  nodes: Node[];
  first: Element | null;
  id: string | null;
}

const BLOCK_ELEMENT =
  /^(?:ADDRESS|ARTICLE|ASIDE|BLOCKQUOTE|CENTER|DETAILS|DIV|DL|FIELDSET|FIGURE|FOOTER|FORM|H[1-6]|HEADER|HR|LI|MAIN|NAV|OL|P|PRE|SECTION|TABLE|UL)$/;

function sourceUnits(root: Element): SourceUnit[] {
  const units: SourceUnit[] = [];
  let inline: SourceUnit | null = null;
  for (const node of Array.from(root.childNodes)) {
    const element = node.nodeType === Node.ELEMENT_NODE ? (node as Element) : null;
    const id = element?.getAttribute('data-md-id') ?? null;
    if (id) {
      inline = null;
      const last = units[units.length - 1];
      if (last?.id === id) last.nodes.push(node);
      else units.push({ nodes: [node], first: element, id });
    } else if (element && BLOCK_ELEMENT.test(element.nodeName)) {
      inline = null;
      units.push({ nodes: [node], first: element, id: null });
    } else if (inline) {
      inline.nodes.push(node);
    } else if (element || node.textContent?.trim()) {
      inline = { nodes: [node], first: element, id: null };
      units.push(inline);
    }
  }
  return units;
}

const MARK_ELEMENT = /^(?:A|B|CODE|DEL|EM|I|MARK|S|STRIKE|STRONG|U)$/;
const MARK_SELECTOR = 'a, b, code, del, em, i, mark, s, strike, strong, u';
const MARK_ORDER = ['A', 'STRONG', 'B', 'EM', 'I', 'S', 'DEL', 'STRIKE', 'U', 'MARK', 'CODE'];

interface InlineRun {
  node: Node;
  marks: Element[];
}

function markKey(mark: Element): string {
  const attributes = Array.from(mark.attributes, (a) => `${a.name}=${a.value}`).sort();
  return `${mark.nodeName}|${attributes.join('|')}`;
}

/** The text and atoms of an inline run, each with the marks around it; null if a mark holds a block. */
function inlineRuns(nodes: Node[], marks: Element[], runs: InlineRun[]): InlineRun[] | null {
  for (const node of nodes) {
    if (node.nodeType === Node.ELEMENT_NODE && MARK_ELEMENT.test(node.nodeName)) {
      const mark = (node as Element).cloneNode(false) as Element;
      if (!inlineRuns(Array.from(node.childNodes), [...marks, mark], runs)) return null;
    } else if (node.nodeType === Node.ELEMENT_NODE && BLOCK_ELEMENT.test(node.nodeName)) {
      return null;
    } else {
      // The editor's code mark excludes every other mark, so a link or bold
      // around code never reaches it.
      const code = marks.find((mark) => mark.nodeName === 'CODE');
      runs.push({ node: node.cloneNode(true), marks: code ? [code] : marks });
    }
  }
  return runs;
}

/**
 * Rebuilds inline content with its marks nested one way: the mark that runs
 * longest outermost, code innermost. The editor nests a link outside bold
 * whatever the note did, which wrote `**[a](u) b**` back as `[**a**](u) **b**`,
 * and an untouched block has to write the same Markdown before and after it
 * passed through the editor.
 */
function nestMarks(container: Element, nodes: Node[]): void {
  const runs = inlineRuns(nodes, [], []);
  if (!runs) return;
  const keys = runs.map((run) => run.marks.map(markKey));
  const reach = (key: string, from: number) => {
    let end = from;
    while (end < runs.length && keys[end].includes(key)) end++;
    return end;
  };
  const anchor = nodes[nodes.length - 1].nextSibling;
  for (const node of nodes) node.parentNode?.removeChild(node);
  const fragment = container.ownerDocument.createDocumentFragment();
  const open: Array<{ key: string; element: Element }> = [];
  runs.forEach((run, i) => {
    let kept = 0;
    while (kept < open.length && keys[i].includes(open[kept].key)) kept++;
    open.length = kept;
    const opening = run.marks
      .map((mark, m) => ({ mark, key: keys[i][m] }))
      .filter(({ key }) => !open.some((o) => o.key === key))
      .sort(
        (a, b) =>
          Number(a.mark.nodeName === 'CODE') - Number(b.mark.nodeName === 'CODE') ||
          reach(b.key, i) - reach(a.key, i) ||
          MARK_ORDER.indexOf(a.mark.nodeName) - MARK_ORDER.indexOf(b.mark.nodeName)
      );
    for (const { mark, key } of opening) {
      const element = mark.cloneNode(false) as Element;
      (open[open.length - 1]?.element ?? fragment).appendChild(element);
      open.push({ key, element });
    }
    (open[open.length - 1]?.element ?? fragment).appendChild(run.node);
  });
  container.insertBefore(fragment, anchor);
}

function nestAllMarks(root: Element): void {
  for (const element of [root, ...Array.from(root.querySelectorAll('*'))]) {
    if (!root.contains(element) || MARK_ELEMENT.test(element.nodeName)) continue;
    if (element.closest('pre') || element.parentElement?.closest(MARK_SELECTOR)) continue;
    let run: Node[] = [];
    const flush = () => {
      if (run.some((node) => node.nodeType === Node.ELEMENT_NODE)) nestMarks(element, run);
      run = [];
    };
    for (const child of Array.from(element.childNodes)) {
      if (child.nodeType === Node.ELEMENT_NODE && BLOCK_ELEMENT.test(child.nodeName)) flush();
      else run.push(child);
    }
    flush();
  }
}

function freshMarkdown(nodes: Node[]): string {
  const box = (nodes[0].ownerDocument ?? document).createElement('div');
  for (const node of nodes) box.appendChild(node.cloneNode(true));
  nestAllMarks(box);
  return resolveEscapes(turndownService.turndown(box));
}

const savedUnits = memo(2000);

function unitMarkdown(unit: SourceUnit): string {
  const html = unit.nodes.map((node) =>
    node.nodeType === Node.ELEMENT_NODE ? (node as Element).outerHTML : `#${node.textContent}`
  );
  const mode = `${forgeImagesEnabled}${escapes === FULL_ESCAPES}`;
  return savedUnits(`${mode}\0${html.join('\0')}`, () => unitMarkdownNow(unit));
}

/**
 * A block as the note spelled it when the editor would still write it as it
 * did on load. Else the edit replayed onto that spelling, kept only if opening
 * it would have the editor write exactly what it writes now, which keeps what
 * the editor cannot show (a link on code, bold around it) wherever the edit
 * did not reach. Else the editor's own Markdown.
 */
function unitMarkdownNow(unit: SourceUnit): string {
  const fresh = freshMarkdown(unit.nodes);
  const source = unit.first?.getAttribute('data-md-source');
  if (source === null || source === undefined) return fresh;
  const loaded = unit.first?.getAttribute('data-md-fresh') ?? source;
  if (fresh === loaded) return source;
  for (const replay of [replayCharacters, replayLines]) {
    const merged = replay(source, loaded, fresh);
    if (merged !== null && blocksToMarkdown(renderToBody(merged)) === fresh) return merged;
  }
  return fresh;
}

/** The lines between two blocks as the note had them, if they were neighbours there. */
function sourceGap(previous: SourceUnit, current: SourceUnit): string | null {
  const [load, index] = (current.id ?? '').split('.');
  const [previousLoad, previousIndex] = (previous.id ?? '').split('.');
  if (!load || load !== previousLoad || Number(index) !== Number(previousIndex) + 1) return null;
  return current.first?.getAttribute('data-md-gap') ?? '\n\n';
}

function blocksToMarkdown(root: Element): string {
  let out = '';
  let previous: { unit: SourceUnit; markdown: string } | null = null;
  for (const unit of sourceUnits(root)) {
    const markdown = unitMarkdown(unit);
    if (!markdown.trim()) continue;
    if (previous) {
      const fallback = joinsPreviousList(unit.first) ? '\n' : '\n\n';
      const gap = sourceGap(previous.unit, unit);
      const unchanged = (block: { unit: SourceUnit; markdown: string }) =>
        block.markdown === block.unit.first?.getAttribute('data-md-source');
      const keepsGap =
        gap !== null &&
        (/\n[ \t]*\n/.test(gap) ||
          (unchanged(previous) && unchanged({ unit, markdown })) ||
          rendered(previous.markdown + gap + markdown) ===
            rendered(previous.markdown + fallback + markdown));
      out += keepsGap ? gap : fallback;
    }
    out += markdown;
    previous = { unit, markdown };
  }
  return out.replace(/^[\t\r\n]+/, '').replace(/[ \t\r\n]+$/, '');
}

/**
 * Splits mixed task lists (containing both task items and regular items) into separate lists.
 * This is needed because markdown-it merges adjacent task and regular list items into
 * a single <ul class="contains-task-list">, but TipTap expects task lists to only contain
 * task items. Without this, regular bullets inside a task list container get treated as
 * broken/empty task items.
 * @param root - The wrapper element holding the rendered Markdown
 */
function splitMixedTaskLists(root: Element): void {
  const taskLists = root.querySelectorAll('ul.contains-task-list');

  taskLists.forEach((ul) => {
    const items = Array.from(ul.children);
    const hasTaskItems = items.some((item) => item.classList.contains('task-list-item'));
    const hasRegularItems = items.some((item) => !item.classList.contains('task-list-item'));
    if (!hasTaskItems || !hasRegularItems) return;

    // Split into consecutive runs instead of grouping by kind. Grouping all task
    // items first changes the user's writing order on the next autosave.
    const fragment = root.ownerDocument.createDocumentFragment();
    let currentList: Element | null = null;
    let currentRunIsTask: boolean | null = null;
    items.forEach((item) => {
      const isTask = item.classList.contains('task-list-item');
      if (currentList === null || currentRunIsTask !== isTask) {
        currentList = ul.cloneNode(false) as Element;
        if (!isTask) currentList.classList.remove('contains-task-list');
        fragment.appendChild(currentList);
        currentRunIsTask = isTask;
      }
      currentList.appendChild(item);
    });
    ul.replaceWith(fragment);
  });
}

/** Block tags that end the leading inline run inside a task item body. */
const TASK_BODY_BLOCK = /^(?:P|DIV|UL|OL|BLOCKQUOTE|PRE|TABLE|HR|H[1-6])$/;

/**
 * Converts markdown-it's GFM task-list output into the shape TipTap parses:
 * `<ul data-type="taskList">` of
 * `<li data-type="taskItem" data-checked><label><input></label><div>…</div></li>`.
 *
 * The rewrite runs on a parsed document rather than on the HTML string: a regex
 * that stops at the first `</li>` closes the wrong element as soon as a task
 * item contains a nested list, which flattened the nesting and pushed every
 * following item out of its `<ul>`.
 */
function taskListsToTipTapHtml(html: string): string {
  const doc = new DOMParser().parseFromString(`<div>${html}</div>`, 'text/html');
  const root = doc.body.querySelector('div');
  if (!root) return html;

  splitMixedTaskLists(root);
  // Collected outer-to-inner in document order, so a nested item's own marker is
  // still the first `task-list-item-checkbox` inside it when its turn comes.
  const items = Array.from(root.querySelectorAll('li.task-list-item'));
  for (const ul of Array.from(root.querySelectorAll('ul.contains-task-list'))) {
    ul.removeAttribute('class');
    ul.setAttribute('data-type', 'taskList');
  }

  for (const li of items) {
    const marker = li.querySelector('input.task-list-item-checkbox');
    const checked = marker?.hasAttribute('checked') ?? false;
    marker?.remove();

    const body = doc.createElement('div');
    while (li.firstChild) body.appendChild(li.firstChild);

    // TipTap's taskItem schema is `paragraph block*`, so the body must open
    // with one; markdown-it emits the item text bare in a tight list.
    if (!TASK_BODY_BLOCK.test(body.firstChild?.nodeName ?? '')) {
      const paragraph = doc.createElement('p');
      while (body.firstChild && !TASK_BODY_BLOCK.test(body.firstChild.nodeName)) {
        paragraph.appendChild(body.firstChild);
      }
      body.insertBefore(paragraph, body.firstChild);
    }
    if (body.firstElementChild?.tagName !== 'P') {
      body.insertBefore(doc.createElement('p'), body.firstChild);
    }

    // Drop the whitespace markdown-it left around the checkbox marker.
    const lead = body.firstElementChild as Element;
    const first = lead.firstChild;
    if (first?.nodeValue) first.nodeValue = first.nodeValue.replace(/^\s+/, '');
    const last = lead.lastChild;
    if (last?.nodeValue) last.nodeValue = last.nodeValue.replace(/\s+$/, '');

    const label = doc.createElement('label');
    const input = doc.createElement('input');
    input.setAttribute('type', 'checkbox');
    if (checked) input.setAttribute('checked', 'checked');
    label.appendChild(input);

    li.removeAttribute('class');
    li.setAttribute('data-type', 'taskItem');
    li.setAttribute('data-checked', String(checked));
    li.append(label, body);
  }
  return root.innerHTML;
}

const TABLE_DELIMITER_SOURCE = String.raw`[ \t]{0,3}(?:\|[ \t]*:?-+:?[ \t]*(?:\|[ \t]*:?-+:?[ \t]*)*\|?|:?-+:?[ \t]*(?:\|[ \t]*:?-+:?[ \t]*)+\|?)[ \t]*`;
const TABLE_DELIMITER_ROW = new RegExp(`^${TABLE_DELIMITER_SOURCE}$`);
const CODE_FENCE = /^[ \t]{0,3}(`{3,}|~{3,})/;

/** The cells of a GFM row, split on unescaped pipes as markdown-it splits them. */
function tableRowCells(line: string): string[] {
  let row = line.trim();
  if (row.startsWith('|')) row = row.slice(1);
  if (/(^|[^\\])\|$/.test(row)) row = row.slice(0, -1);
  return row
    .replace(/\\\|/g, '\0')
    .split('|')
    .map((cell) => cell.replace(/\0/g, '\\|'));
}

/**
 * Each GFM table in `lines` as `[header line, line after its last row]`: a row
 * of pipes followed by a delimiter row with as many cells. Fenced code is
 * skipped, since a table-shaped line inside it is code.
 */
function gfmTables(lines: string[]): Array<[number, number]> {
  const tables: Array<[number, number]> = [];
  let fence: string | null = null;
  for (let i = 0; i < lines.length; i++) {
    const opener = CODE_FENCE.exec(lines[i])?.[1];
    if (fence) {
      if (opener && opener[0] === fence[0] && opener.length >= fence.length) fence = null;
      continue;
    }
    if (opener) {
      fence = opener;
      continue;
    }
    const delimiter = lines[i + 1];
    if (
      delimiter === undefined ||
      !lines[i].includes('|') ||
      !TABLE_DELIMITER_ROW.test(delimiter) ||
      tableRowCells(lines[i]).length !== tableRowCells(delimiter).length
    ) {
      continue;
    }
    let end = i + 2;
    while (end < lines.length && lines[end].trim() !== '' && lines[end].includes('|')) end++;
    tables.push([i, end]);
    i = end - 1;
  }
  return tables;
}

/**
 * markdown-it sizes a table by its header and silently drops any cell beyond
 * it, so a row longer than the header lost its tail on the next save. The
 * header and delimiter rows are widened to the longest row first.
 */
function padRaggedTables(markdown: string): string {
  const lines = markdown.split('\n');
  for (const [header, end] of gfmTables(lines)) {
    const width = Math.max(...lines.slice(header + 2, end).map((row) => tableRowCells(row).length));
    const missing = width - tableRowCells(lines[header]).length;
    if (missing <= 0) continue;
    const pad = (row: string, fill: string) =>
      `|${[...tableRowCells(row), ...Array<string>(missing).fill(` ${fill} `)].join('|')}|`;
    lines[header] = pad(lines[header], '');
    lines[header + 1] = pad(lines[header + 1], '---');
  }
  return lines.join('\n');
}

/**
 * Converts Markdown content to HTML for display in the editor.
 * Processes wiki links and task lists, converting them to TipTap-compatible HTML.
 * Sanitizes output with DOMPurify to prevent XSS attacks.
 * @param markdown - The Markdown content to convert
 * @returns Sanitized HTML representation with wiki links and task lists processed
 */
export function markdownToHtml(markdown: string, options?: ConversionOptions): string {
  if (!markdown || markdown.trim() === '') return '';
  return convertWith(options, () => renderMarkdown(markdown));
}

/** `[[Note Name]]` or `[[Display Text|Note Name]]`; inside a table the separator is written `\|`. */
const WIKI_LINK_SOURCE = String.raw`\[\[([^\]|]+?)(?:\\?\|([^\]]+))?\]\]`;
const WIKI_LINK = new RegExp(WIKI_LINK_SOURCE, 'g');
const WIKI_LINK_AT = new RegExp(WIKI_LINK_SOURCE, 'y');
const INLINE_MARK = /\[\[|\\[\\`]|`+|<!--/g;

/**
 * Both halves are kept exactly as written so the link saves back unchanged;
 * `data-target` is only the resolved filename. A pipe is written as an entity
 * so it cannot end a table cell before markdown-it sees the row.
 */
function wikiLinkHtml(text: string, target: string | undefined): string {
  const displayText = text.trim();
  const filename = noteNameToFilename((target || text).trim());
  const attribute = (value: string) => escapeHtmlAttribute(value).replace(/\|/g, '&#124;');
  const rawTarget = target === undefined ? '' : ` data-raw-target="${attribute(target)}"`;

  return `<wiki-link data-target="${filename}" data-label="${attribute(text)}"${rawTarget}>${displayText}</wiki-link>`;
}

function wikiLinksInText(text: string): string {
  return text.replace(WIKI_LINK, (_match, label: string, target?: string) =>
    wikiLinkHtml(label, target)
  );
}

/** Where a backtick run of `length` closes before `limit`, or -1: CommonMark pairs equal runs only. */
function codeSpanEnd(text: string, from: number, length: number, limit: number): number {
  for (let at = text.indexOf('`', from); at !== -1 && at < limit; at = text.indexOf('`', at)) {
    let end = at;
    while (text[end] === '`') end++;
    if (end - at === length) return end;
    at = end;
  }
  return -1;
}

/**
 * Wiki links in one inline block, skipping its code spans and HTML comments,
 * which are saved as written. A link that starts before a backtick wins over
 * it, matching the plain rewrite used elsewhere.
 * GFM splits a table row on its pipes before it pairs backticks.
 */
function wikiLinksInInline(text: string, tableRow: boolean): string {
  let result = '';
  let copied = 0;
  INLINE_MARK.lastIndex = 0;
  for (let mark = INLINE_MARK.exec(text); mark; mark = INLINE_MARK.exec(text)) {
    const at = mark.index;
    if (mark[0] === '[[') {
      WIKI_LINK_AT.lastIndex = at;
      const link = WIKI_LINK_AT.exec(text);
      INLINE_MARK.lastIndex = link ? WIKI_LINK_AT.lastIndex : at + 1;
      if (link) {
        result += text.slice(copied, at) + wikiLinkHtml(link[1], link[2]);
        copied = INLINE_MARK.lastIndex;
      }
    } else if (mark[0] === '<!--') {
      const end = text.indexOf('-->', at + 4);
      if (end !== -1) INLINE_MARK.lastIndex = end + 3;
    } else if (mark[0][0] === '`') {
      const runEnd = at + mark[0].length;
      const cellEnd = tableRow ? text.slice(runEnd).search(/(?<!\\)\|/) : -1;
      const limit = cellEnd === -1 ? text.length : runEnd + cellEnd;
      const end = codeSpanEnd(text, runEnd, mark[0].length, limit);
      if (end !== -1) INLINE_MARK.lastIndex = end;
    }
  }
  return result + text.slice(copied);
}

/**
 * Wiki links become HTML before markdown-it runs, so `[[...]]` in a fence, an
 * indented block or a code span has to be found the way markdown-it reads the
 * note: rewriting it there would save a `<wiki-link>` tag into the code.
 * markdown-it's line map gives the code blocks and the extent of each inline
 * block, inside which code spans pair; everything else is rewritten whole.
 */
function wikiLinksToHtml(markdown: string): string {
  if (!markdown.includes('[[')) return markdown;
  const lineStarts = [0];
  for (const ending of markdown.matchAll(/\r\n?|\n/g)) {
    lineStarts.push(ending.index + ending[0].length);
  }
  const offset = (line: number) => lineStarts[line] ?? markdown.length;

  let result = '';
  let copied = 0;
  for (const token of md.parse(markdown, {})) {
    const code = ['fence', 'code_block', 'raw_block'].includes(token.type);
    if (!token.map || !(code || token.type === 'inline' || token.type === 'tr_open')) continue;
    const start = offset(token.map[0]);
    const end = offset(token.map[1]);
    const text = markdown.slice(start, end);
    result += wikiLinksInText(markdown.slice(copied, start));
    result += code ? text : wikiLinksInInline(text, token.type === 'tr_open');
    copied = end;
  }
  return result + wikiLinksInText(markdown.slice(copied));
}

/**
 * Names one load of a note's Markdown, so blocks are only treated as
 * neighbours in the source when they came from the same text. It is derived
 * from the text, so loading the same note twice renders the same HTML.
 */
function sourceName(markdown: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < markdown.length; i++) {
    hash = Math.imul(hash ^ markdown.charCodeAt(i), 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

function renderMarkdown(markdown: string): string {
  const lines = markdown.split('\n');
  const body = renderToBody(markdown, lines);
  return body.innerHTML;
}

/**
 * The sanitized editor HTML for `markdown`, with block sources attached when
 * `lines` are given. `references` are the link reference definitions of the
 * note a block came from, for rendering that block on its own.
 */
function renderToBody(markdown: string, lines?: string[], references?: unknown): HTMLElement {
  const prepared = padRaggedTables(wikiLinksToHtml(markdown));
  // Block line numbers index the note itself, so a rewrite that moved lines,
  // or a lone `\r` that markdown-it counts as a line break, turns mapping off.
  const mappable =
    lines && prepared.split('\n').length === lines.length && !/\r(?!\n)/.test(markdown);
  const env: SourceMapEnv = { listMarkers: true, references };
  if (mappable) env.sourceMap = sourceName(markdown);
  let html = md.render(prepared, env);

  // markdown-it emits `<ul class="contains-task-list">` with a leading checkbox
  // per item; TipTap parses `<ul data-type="taskList">` with the checkbox in a
  // label and the item body in a div.
  html = taskListsToTipTapHtml(html);

  // Sanitize HTML to prevent XSS attacks
  const body = DOMPurify.sanitize(html, { ...DOMPURIFY_CONFIG, RETURN_DOM: true }) as HTMLElement;
  // The editor centres an image that names no alignment; saying so here makes
  // the image save the same before and after it passes through the editor.
  for (const image of Array.from(body.querySelectorAll('img:not([data-alignment])'))) {
    image.setAttribute('data-alignment', 'center');
  }
  const blocks = env.sourceBlocks;
  if (lines && blocks)
    withEscapes(markdown, () => attachSources(body, lines, blocks, env.references));
  return body;
}

const LEGACY_ASSET_URL = /(?:asset:\/\/|https?:\/\/asset\.localhost\/)/;

/**
 * markdown-it puts a fence's attributes on its `<code>`, and an image alone in
 * a paragraph leaves that paragraph in the editor, so both ids move to the
 * element the editor keeps.
 */
function liftSourceIds(root: Element): void {
  for (const element of Array.from(root.children)) {
    const code = element.firstElementChild;
    const codeId = code?.nodeName === 'CODE' ? code.getAttribute('data-md-id') : null;
    if (element.nodeName === 'PRE' && code && codeId) {
      element.setAttribute('data-md-id', codeId);
      code.removeAttribute('data-md-id');
    }
    const id = element.getAttribute('data-md-id');
    const images = Array.from(element.children);
    if (
      element.nodeName === 'P' &&
      id &&
      images.length > 0 &&
      images.every((child) => child.nodeName === 'IMG') &&
      !element.textContent?.trim()
    ) {
      for (const image of images) image.setAttribute('data-md-id', id);
      element.replaceWith(...images);
    }
  }
}

/**
 * Gives each top-level block the Markdown it came from, how the editor would
 * write it now, and the lines that separated it from the block before, so a
 * save can write an untouched block back exactly as it was.
 *
 * A source is only attached when it opens, on its own, as exactly what the
 * block shows. Lines that rendered outside the block (text an `<img>` line
 * carries on with) would otherwise be saved twice: once in the source and
 * once from the element the editor made of them.
 */
function attachSources(
  root: Element,
  lines: string[],
  blocks: Array<[number, number]>,
  references: unknown
): void {
  liftSourceIds(root);
  const stops = blocks.map(([start, end]) => {
    let stop = end;
    while (stop > start && isBlank(lines[stop - 1])) stop--;
    return stop;
  });
  for (const unit of sourceUnits(root)) {
    const index = Number(unit.id?.split('.')[1]);
    if (!unit.first || !blocks[index]) continue;
    const start = blocks[index][0];
    const source = lines.slice(start, stops[index]).join('\n');
    // Older builds wrote images as asset URLs naming one machine's home
    // directory. Such a block is left to save as the editor writes it, which
    // is the Forge-relative path every device can resolve.
    if (forgeImagesEnabled && LEGACY_ASSET_URL.test(source)) continue;
    const fresh = freshMarkdown(unit.nodes);
    if (fresh !== source) {
      if (blocksToMarkdown(renderToBody(source, undefined, references)) !== fresh) continue;
      unit.first.setAttribute('data-md-fresh', fresh);
    }
    unit.first.setAttribute('data-md-source', source);
    if (index > 0) {
      const between = lines.slice(stops[index - 1], start).map((line) => `${line}\n`);
      const gap = `\n${between.join('')}`;
      if (gap !== '\n\n') unit.first.setAttribute('data-md-gap', gap);
    }
  }
}

/**
 * Parses HTML content to count task items and their completion status.
 * Used for calendar indicators to show days with incomplete tasks.
 * @param html - The HTML content to parse
 * @returns Object with totalTasks and completedTasks counts
 */
export function parseTaskStatus(html: string): { totalTasks: number; completedTasks: number } {
  if (!html) return { totalTasks: 0, completedTasks: 0 };

  const taskItemRegex = /data-type="taskItem"/g;
  const totalMatches = html.match(taskItemRegex);
  const totalTasks = totalMatches ? totalMatches.length : 0;

  // Count completed task items - handle both attribute orders
  const checkedRegex1 = /data-checked="true"[^>]*data-type="taskItem"/g;
  const checkedRegex2 = /data-type="taskItem"[^>]*data-checked="true"/g;
  const checkedMatches1 = html.match(checkedRegex1) || [];
  const checkedMatches2 = html.match(checkedRegex2) || [];
  const completedTasks = checkedMatches1.length + checkedMatches2.length;

  return { totalTasks, completedTasks };
}

/** A block container opening the body — never `<img>`, which is inline. */
const LEGACY_HTML_OPENER = /^<(p|h[1-6]|ul|ol|blockquote|pre|div|table)(\s[^>]*)?>/i;

/** The same body has to close a block somewhere, or it isn't an HTML document. */
const LEGACY_HTML_CLOSER = /<\/(p|h[1-6]|ul|ol|li|blockquote|pre|div|table)>/i;

/** Markdown structure that a legacy HTML body would have expressed as tags. */
const MARKDOWN_BLOCK_MARKER = /^(?:#{1,6} |[-*+] |\d+\. |> |```|~~~|---\s*$)/m;

/** A GFM delimiter row: a note whose table follows an aligned paragraph is still Markdown. */
const TABLE_DELIMITER_LINE = new RegExp(`^${TABLE_DELIMITER_SOURCE}$`, 'm');

/**
 * Detects if content is a legacy HTML-bodied note (pre-Markdown storage).
 *
 * The sniff has to be pessimistic, because a false positive corrupts the note:
 * the caller skips `markdownToHtml`, so every heading/bold/list renders as
 * literal text and the next autosave writes that literal text back escaped.
 * Markdown notes routinely contain raw HTML — the Turndown image rule emits a
 * bare `<img ...>` tag, so any note whose first block is an image starts with
 * one — so leading markup alone proves nothing. We require a real block
 * container to open the body, a block tag to close somewhere, and no Markdown
 * block markers anywhere. Guessing "Markdown" is the safe way to be wrong:
 * markdown-it is configured with `html: true`, so genuine HTML still survives
 * that path.
 *
 * @param content - The content to check
 * @returns True if content appears to be a legacy HTML body
 */
export function isHtmlContent(content: string): boolean {
  if (!content) return false;
  const trimmed = content.trim();
  return (
    LEGACY_HTML_OPENER.test(trimmed) &&
    LEGACY_HTML_CLOSER.test(trimmed) &&
    !MARKDOWN_BLOCK_MARKER.test(trimmed) &&
    !TABLE_DELIMITER_LINE.test(trimmed)
  );
}

/**
 * Converts raw note content into sanitized HTML for the editor, choosing the
 * right path for each storage format.
 *
 * `markdownToHtml` already sanitizes its output, but the legacy-HTML branch
 * (`isHtmlContent`) hands the disk content to the editor as-is. Every caller
 * that does `isHtmlContent(content) ? content : markdownToHtml(content)`
 * outside of `filenameToNote` bypasses DOMPurify for that branch, so this is
 * the choke point for those callers too.
 *
 * @param content - The raw note content read from disk
 * @returns Sanitized HTML safe to hand to the editor
 */
export function noteContentToEditorHtml(content: string, options?: ConversionOptions): string {
  return isHtmlContent(content)
    ? convertWith(options, () => DOMPurify.sanitize(content, DOMPURIFY_CONFIG))
    : markdownToHtml(content, options);
}

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
 * Result shape returned by `read_note`. The body has had any leading YAML
 * frontmatter stripped; structured fields (currently just `color`) are
 * surfaced separately. `contentHash` is the SHA-256 hex of `content`, used
 * as the base for external-edit conflict detection on the next save.
 */
export interface NoteReadResult {
  content: string;
  color: string | null;
  contentHash: string;
}

export interface AgentWriteInfo {
  client: string | null;
}

/**
 * Result shape returned by `write_note`. `contentHash` is the hash of the
 * body just written (stored as the new conflict-detection base).
 * `conflictCopy` is the relative path of the conflict copy created when the
 * on-disk note had changed externally since it was last read, else null.
 */
export interface NoteWriteResult {
  contentHash: string;
  conflictCopy: string | null;
}

/**
 * Per-note base hashes for external-edit conflict detection, keyed by the
 * note's backend address (kind + filename). Recorded on every read, sent to
 * the backend on every write, and replaced with the hash of what was just
 * written after a successful save. The registry is module-level state: it
 * resets on window reload, which matches Forge switching (a full reload).
 * `lockedNoteWrites` prevents new saves during a lock transition, while
 * `noteWritesInFlight` lets that transition drain already-started writes.
 * `cloudPlaceholderProbe` reports an address whose open tab is still an iCloud
 * placeholder: with no base hash, a write there would replace the real note, so
 * writes and guarded deletes are refused. It asks the live tabs rather than keeping
 * its own record, so a closed, replaced or readdressed placeholder never blocks a
 * later note at the same address.
 */
const noteBaseHashes = new Map<string, string>();
const lastPersistedMarkdown = new Map<string, string>();
const lockedNoteWrites = new Set<string>();
let cloudPlaceholderProbe:
  | ((filename: string, isDaily: boolean, isWeekly: boolean) => boolean)
  | null = null;
const noteWritesInFlight = new Map<string, Set<Promise<NoteWriteResult>>>();
const noteWriteTails = new Map<string, Promise<void>>();
const noteWriteGenerations = new Map<string, number>();
const noteWriteChainHashes = new Map<string, string>();

export class LockedNoteWriteError extends Error {
  constructor() {
    super('Note is locked');
    this.name = 'LockedNoteWriteError';
  }
}

export class CloudPlaceholderWriteError extends Error {
  constructor() {
    super("This note hasn't downloaded from iCloud yet");
    this.name = 'CloudPlaceholderWriteError';
  }
}

export function registerCloudPlaceholderProbe(
  probe: (filename: string, isDaily: boolean, isWeekly: boolean) => boolean
): void {
  cloudPlaceholderProbe = probe;
}

function isCloudPlaceholder(filename: string, isDaily: boolean, isWeekly: boolean): boolean {
  return cloudPlaceholderProbe?.(filename, isDaily, isWeekly) ?? false;
}

function noteHashKey(filename: string, isDaily: boolean, isWeekly: boolean): string {
  return `${isDaily ? 'daily' : isWeekly ? 'weekly' : 'notes'}:${filename}`;
}

/** Drop the recorded base hash for a note after its content identity is gone. */
function forgetNoteBaseHash(filename: string, isDaily: boolean, isWeekly: boolean): void {
  const key = noteHashKey(filename, isDaily, isWeekly);
  noteBaseHashes.delete(key);
  lastPersistedMarkdown.delete(key);
  noteWriteChainHashes.delete(key);
}

/** Preserve conflict and write-chain state when a note changes address. */
function readdressNote(
  oldFilename: string,
  newFilename: string,
  isDaily: boolean,
  isWeekly: boolean
): void {
  const oldKey = noteHashKey(oldFilename, isDaily, isWeekly);
  const newKey = noteHashKey(newFilename, isDaily, isWeekly);
  if (oldKey === newKey) return;

  const transfer = <T>(registry: Map<string, T>) => {
    const value = registry.get(oldKey);
    registry.delete(newKey);
    if (value !== undefined) registry.set(newKey, value);
    registry.delete(oldKey);
  };

  transfer(noteBaseHashes);
  transfer(lastPersistedMarkdown);
  transfer(noteWriteChainHashes);
  transfer(noteWriteGenerations);
}

/** Carry every note's conflict and write-chain state across a folder rename or move. */
function readdressFolderNotes(oldFolder: string, newFolder: string): void {
  const prefix = noteHashKey(`${oldFolder}/`, false, false);
  const filenames = new Set<string>();
  for (const registry of [noteBaseHashes, lastPersistedMarkdown, noteWriteChainHashes]) {
    for (const key of registry.keys()) {
      if (key.startsWith(prefix)) filenames.add(key.slice(prefix.length));
    }
  }
  for (const rest of filenames) {
    readdressNote(`${oldFolder}/${rest}`, `${newFolder}/${rest}`, false, false);
  }
}

/** Whether a disk hash is the body this editor last read or wrote for the note. */
export function isPersistedNoteHash(
  filename: string,
  isDaily: boolean,
  isWeekly: boolean,
  contentHash: string
): boolean {
  const key = noteHashKey(filename, isDaily, isWeekly);
  return noteBaseHashes.get(key) === contentHash || noteWriteChainHashes.get(key) === contentHash;
}

export function getLastPersistedMarkdown(
  filename: string,
  isDaily: boolean,
  isWeekly: boolean = false
): string | undefined {
  return lastPersistedMarkdown.get(noteHashKey(filename, isDaily, isWeekly));
}

/**
 * Backend note commands address standalone notes by their path relative to
 * the notes/ directory (folder included); daily and weekly notes use a bare
 * filename. Passing `note.name` alone breaks for notes inside folders.
 */
export function noteFileBackendPath(note: Pick<NoteFile, 'name' | 'folderPath'>): string {
  return note.folderPath ? `${note.folderPath}/${note.name}` : note.name;
}

/**
 * List times for a note this window just created. The list gets them only from a
 * scan, and a note without them sorts last under Modified and Created.
 */
export function justCreatedTimes(): Pick<NoteFile, 'createdAt' | 'modifiedAt'> {
  const now = Math.floor(Date.now() / 1000);
  return { createdAt: now, modifiedAt: now };
}

export async function readNote(
  filename: string,
  isDaily: boolean,
  isWeekly: boolean = false
): Promise<string> {
  const result = await readNoteWithMeta(filename, isDaily, isWeekly);
  return result.content;
}

/**
 * Same as {@link readNote}, but returns the structured result with `color`
 * and `contentHash`.
 */
export async function readNoteWithMeta(
  filename: string,
  isDaily: boolean,
  isWeekly: boolean = false
): Promise<NoteReadResult> {
  const result = await readNoteSnapshot(filename, isDaily, isWeekly);
  adoptNoteSnapshot(filename, isDaily, isWeekly, result);
  return result;
}

/**
 * Adopt a snapshot as the editor's current disk baseline after the caller has
 * confirmed that no local edit raced its read.
 */
export function adoptNoteSnapshot(
  filename: string,
  isDaily: boolean,
  isWeekly: boolean,
  result: NoteReadResult
): void {
  const key = noteHashKey(filename, isDaily, isWeekly);
  noteBaseHashes.set(key, result.contentHash);
  lastPersistedMarkdown.set(key, result.content);
  noteWriteChainHashes.set(key, result.contentHash);
}

/**
 * Read the current disk body without advancing the save-conflict baseline.
 * Dirty-buffer reconciliation needs the incoming hash for attribution while
 * retaining the older hash that lets Keep mine preserve the disk version.
 */
export async function readNoteSnapshot(
  filename: string,
  isDaily: boolean,
  isWeekly: boolean = false
): Promise<NoteReadResult> {
  return await invoke<NoteReadResult>('read_note', { filename, isDaily, isWeekly });
}

/**
 * Consume one matching MCP attribution marker. Marker loss and every spool or
 * IPC error are normal fallbacks to generic external-change wording.
 */
export async function takeAgentWrite(
  relPath: string,
  contentHash: string
): Promise<AgentWriteInfo | null> {
  try {
    return await invoke<AgentWriteInfo | null>('take_agent_write', { relPath, contentHash });
  } catch {
    return null;
  }
}

/**
 * Writes content to a note file, creating it if it doesn't exist.
 *
 * External-edit conflict safety: the hash recorded by the last read of this
 * note is sent along as `baseHash`. If the on-disk content changed since
 * then (sync tool, other editor…) and differs from `content`, the backend
 * preserves the disk version as a sibling conflict copy before writing —
 * check `conflictCopy` on the result to surface that to the user.
 *
 * @param filename - The note filename
 * @param content - The Markdown content to write
 * @param isDaily - Whether this is a daily note
 * @param isWeekly - Whether this is a weekly note
 * @param color - Optional color id to stamp into frontmatter. `null`/undefined
 *   leaves the existing color in place; pass `"default"` to clear it.
 * @returns The write result with the new content hash and any conflict copy
 */
export async function writeNote(
  filename: string,
  content: string,
  isDaily: boolean,
  isWeekly: boolean = false,
  color?: string | null
): Promise<NoteWriteResult> {
  const key = noteHashKey(filename, isDaily, isWeekly);
  if (lockedNoteWrites.has(key)) {
    throw new LockedNoteWriteError();
  }
  if (isCloudPlaceholder(filename, isDaily, isWeekly)) throw new CloudPlaceholderWriteError();

  const generation = (noteWriteGenerations.get(key) ?? 0) + 1;
  noteWriteGenerations.set(key, generation);
  const previous = noteWriteTails.get(key) ?? Promise.resolve();
  const write = previous.then(async () => {
    const result = await invoke<NoteWriteResult>('write_note', {
      filename,
      content,
      isDaily,
      isWeekly,
      color: color ?? null,
      baseHash: noteWriteChainHashes.get(key) ?? noteBaseHashes.get(key) ?? null,
    });
    // Every completed generation feeds the next queued write, but only the
    // newest requested generation may become the public editor baseline.
    noteWriteChainHashes.set(key, result.contentHash);
    if (noteWriteGenerations.get(key) === generation) {
      noteBaseHashes.set(key, result.contentHash);
      lastPersistedMarkdown.set(key, content);
    }
    return result;
  });
  const tail = write.then(
    () => undefined,
    () => undefined
  );
  noteWriteTails.set(key, tail);
  const writes = noteWritesInFlight.get(key) ?? new Set<Promise<NoteWriteResult>>();
  writes.add(write);
  noteWritesInFlight.set(key, writes);

  try {
    return await write;
  } finally {
    writes.delete(write);
    if (writes.size === 0) {
      noteWritesInFlight.delete(key);
      if (noteWriteTails.get(key) === tail) noteWriteTails.delete(key);
    }
  }
}

/** Wait for every write already queued for one note. New writes can be blocked by the caller. */
export async function drainNoteWrites(
  filename: string,
  isDaily: boolean,
  isWeekly: boolean = false
): Promise<void> {
  const pending = noteWritesInFlight.get(noteHashKey(filename, isDaily, isWeekly));
  if (pending) await Promise.all([...pending]);
}

export async function deleteNote(
  filename: string,
  isDaily: boolean,
  isWeekly: boolean = false,
  /** `baseHash` replaces the recorded one: the delete is refused unless the body on disk has it. */
  opts?: { guarded?: boolean; baseHash?: string }
): Promise<void> {
  const key = noteHashKey(filename, isDaily, isWeekly);
  if (opts?.guarded && isCloudPlaceholder(filename, isDaily, isWeekly)) {
    throw new CloudPlaceholderWriteError();
  }
  const wasWriteLocked = lockedNoteWrites.has(key);
  let deleted = false;
  lockedNoteWrites.add(key);
  try {
    await drainNoteWrites(filename, isDaily, isWeekly);
    await invoke('delete_note', {
      filename,
      isDaily,
      isWeekly,
      baseHash: opts?.baseHash ?? (opts?.guarded ? (noteBaseHashes.get(key) ?? null) : null),
    });
    forgetNoteBaseHash(filename, isDaily, isWeekly);
    deleted = true;
  } finally {
    // A successful delete must allow a future note at the same address. On a
    // failed delete, restore a pre-existing lock (for a temporarily unlocked note).
    if (deleted || !wasWriteLocked) lockedNoteWrites.delete(key);
  }
}

export async function preserveBufferCopy(
  filename: string,
  content: string,
  isDaily: boolean,
  isWeekly: boolean = false
): Promise<string> {
  return await invoke('preserve_buffer_copy', { filename, content, isDaily, isWeekly });
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

export async function renameNote(
  oldFilename: string,
  newFilename: string,
  isDaily: boolean,
  isWeekly: boolean = false
): Promise<void> {
  const key = noteHashKey(oldFilename, isDaily, isWeekly);
  if (lockedNoteWrites.has(key)) throw new LockedNoteWriteError();
  lockedNoteWrites.add(key);
  try {
    await drainNoteWrites(oldFilename, isDaily, isWeekly);
    await invoke('rename_note', { oldFilename, newFilename, isDaily, isWeekly });
    readdressNote(oldFilename, newFilename, isDaily, isWeekly);
  } finally {
    lockedNoteWrites.delete(key);
  }
}

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
 *
 * The content is sanitized here because this is the one choke point every note
 * body crosses on its way into the editor: bodies taking the legacy HTML branch
 * never pass through `markdownToHtml`, which is otherwise the only place
 * DOMPurify runs. Re-sanitizing already-converted Markdown is idempotent.
 *
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
    content: content ? DOMPurify.sanitize(content, DOMPURIFY_CONFIG) : content,
    createdAt: new Date(), // Would need file metadata for actual values
    updatedAt: new Date(),
    isDaily: file.isDaily,
    isWeekly: file.isWeekly,
    date: file.date,
    week: file.week,
  };
}

/**
 * Locks a note by encrypting it with a password.
 * The note will be stored as filename.md.locked with AES-256 encryption.
 * @param filename - The note filename (e.g., "my-note.md")
 * @param password - The password to encrypt the note with
 * @param isDaily - Whether this is a daily note
 * @param isWeekly - Whether this is a weekly note
 */
export async function lockNote(
  filename: string,
  password: string,
  isDaily: boolean,
  isWeekly: boolean = false
): Promise<void> {
  const key = noteHashKey(filename, isDaily, isWeekly);
  lockedNoteWrites.add(key);
  try {
    const pending = noteWritesInFlight.get(key);
    if (pending) await Promise.all(pending);
    await invoke('lock_note', { filename, password, isDaily, isWeekly });
    forgetNoteBaseHash(filename, isDaily, isWeekly);
  } catch (error) {
    lockedNoteWrites.delete(key);
    throw error;
  }
}

/**
 * `conflictCopy` is set when an interrupted lock or unlock had left a plaintext
 * copy beside the locked file that differed from it: the relative path it was kept at.
 */
export interface UnlockedNote {
  content: string;
  conflictCopy: string | null;
}

/**
 * Temporarily unlocks a note to view its content.
 * The note remains encrypted on disk; only returns decrypted content.
 * @param filename - The note filename (e.g., "my-note.md")
 * @param password - The password to decrypt the note
 * @param isDaily - Whether this is a daily note
 * @param isWeekly - Whether this is a weekly note
 * @returns The decrypted content, and where a differing plaintext copy was kept
 */
export async function unlockNote(
  filename: string,
  password: string,
  isDaily: boolean,
  isWeekly: boolean = false
): Promise<UnlockedNote> {
  const unlocked = await invoke<UnlockedNote>('unlock_note', {
    filename,
    password,
    isDaily,
    isWeekly,
  });
  lockedNoteWrites.add(noteHashKey(filename, isDaily, isWeekly));
  forgetNoteBaseHash(filename, isDaily, isWeekly);
  return unlocked;
}

/**
 * Permanently unlocks a note, decrypting it and saving as a regular .md file.
 * @param filename - The note filename (e.g., "my-note.md")
 * @param password - The password to decrypt the note
 * @param isDaily - Whether this is a daily note
 * @param isWeekly - Whether this is a weekly note
 * @returns Where a differing plaintext copy was kept, or null
 */
export async function permanentlyUnlockNote(
  filename: string,
  password: string,
  isDaily: boolean,
  isWeekly: boolean = false
): Promise<string | null> {
  const conflictCopy = await invoke<string | null>('permanently_unlock_note', {
    filename,
    password,
    isDaily,
    isWeekly,
  });
  lockedNoteWrites.delete(noteHashKey(filename, isDaily, isWeekly));
  forgetNoteBaseHash(filename, isDaily, isWeekly);
  return conflictCopy;
}

/**
 * Gets the current notes directory path.
 * @returns The absolute path to the notes directory
 */
export async function getNotesDirectory(): Promise<string> {
  return await invoke('get_notes_directory');
}

/** Where Moldavite looks for Forges. Repoints only — it moves no files. */
export async function getForgesRoot(): Promise<string> {
  return await invoke('get_forges_root_path');
}

export async function setForgesRoot(path: string): Promise<string> {
  const root = await invoke<string>('set_forges_root', { path });
  void refreshForgeRoot();
  return root;
}

export async function setActiveForge(name: string): Promise<string> {
  const forge = await invoke<string>('set_active_forge', { name });
  void refreshForgeRoot();
  return forge;
}

/**
 * Re-scans the Forge directory: rebuilds the backlinks index from disk so any
 * externally-added notes are picked up. Callers should refresh their notes
 * list afterward.
 */
export async function rescanForge(): Promise<void> {
  await invoke('rescan_forge');
}

/**
 * Opens the Forge directory in the system file browser. macOS only — a no-op
 * on other platforms.
 */
export async function openForgeInFinder(): Promise<void> {
  await invoke('open_forge_in_finder');
}

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
export async function exportEncryptedBackup(
  destination: string,
  password: string
): Promise<string> {
  return await invoke('export_encrypted_backup', { destination, password });
}

/**
 * Imports notes and templates from an encrypted backup file.
 * @param backupPath - The path to the encrypted backup file
 * @param password - The password to decrypt the backup
 * @param merge - If true, merge with existing notes; if false, replace all notes
 * @returns Import statistics (counts of imported items)
 */
export async function importEncryptedBackup(
  backupPath: string,
  password: string,
  merge: boolean
): Promise<ImportResult> {
  return await invoke('import_encrypted_backup', { backupPath, password, merge });
}

/**
 * Strips Markdown formatting (and TipTap-style inline HTML we round-trip
 * through) down to plain readable text. Designed for our own content shape,
 * not arbitrary CommonMark — we keep the implementation regex-based to avoid
 * pulling another parser into the bundle.
 *
 * Handles:
 *  - ATX headings, blockquotes, list / task-list markers, horizontal rules
 *  - Emphasis, strong, strikethrough, inline code
 *  - Fenced and indented code blocks (preserves contents, drops fences)
 *  - Links and images (`[text](url)` → `text`, `![alt](url)` → `alt`)
 *  - Wiki links `[[Note|Display]]` → `Display`
 *  - Inline HTML tags from turndown (`<u>`, `<mark>`, `<img>` etc.)
 *  - HTML entities like `&amp;` / `&nbsp;`
 */
export function stripMarkdown(input: string): string {
  if (!input) return '';

  const lines = input.split('\n');
  // 0. GFM tables: drop the delimiter row and separate cells with tabs.
  for (const [header, end] of gfmTables(lines).reverse()) {
    const rows = [lines[header], ...lines.slice(header + 2, end)].map((row) =>
      tableRowCells(row)
        .map((cell) =>
          cell
            .replace(/<br\s*\/?>/gi, ' ')
            .replace(/\\\|/g, '|')
            .trim()
        )
        .join('\t')
    );
    lines.splice(header, end - header, ...rows);
  }

  let out = lines.join('\n');

  // 1. Remove fenced code blocks but keep the inner code, dropping the fences.
  //    We do this first because subsequent passes would otherwise mangle the
  //    code body (e.g. backticks, `*` inside code).
  out = out.replace(/```[^\n]*\n([\s\S]*?)```/g, (_m, code) => code);
  out = out.replace(/~~~[^\n]*\n([\s\S]*?)~~~/g, (_m, code) => code);

  // 2. Wiki links: [[Display|target]] or [[Name]] → Display / Name.
  out = out.replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_m, a, b) => (b ? a : a));

  // 3. Images: ![alt](url) → alt (drop URL entirely).
  out = out.replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1');

  // 4. Standard links: [text](url) → text.
  out = out.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1');

  // 5. Strip inline HTML tags (we deliberately allow some, like <u>/<mark>,
  //    in our markdown — for plaintext we want them gone).
  out = out.replace(/<\/?[a-zA-Z][^>]*>/g, '');

  // 6. Decode the small handful of entities we actually emit.
  out = out
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");

  // 7. Headings: drop leading # markers (and any optional trailing #).
  out = out.replace(/^[ \t]*#{1,6}[ \t]+(.+?)[ \t]*#*[ \t]*$/gm, '$1');

  // 8. Blockquotes: drop the leading `>` markers.
  out = out.replace(/^[ \t]*>[ \t]?/gm, '');

  // 9. Horizontal rules → blank line.
  out = out.replace(/^[ \t]*([-*_])([ \t]*\1){2,}[ \t]*$/gm, '');

  // 10. Task list markers: "- [x] foo" / "- [ ] foo" → "[x] foo" / "[ ] foo".
  //     Keep the checkbox glyph so plaintext still conveys task status.
  out = out.replace(/^[ \t]*[-*+][ \t]+\[([ xX])\][ \t]+/gm, '[$1] ');

  // 11. Regular bullet markers: drop the marker, keep the indent.
  out = out.replace(/^([ \t]*)[-*+][ \t]+/gm, '$1');

  // 12. Ordered list markers: drop the "1." but keep the indent.
  out = out.replace(/^([ \t]*)\d+\.[ \t]+/gm, '$1');

  // 13. Inline code: `code` → code.
  out = out.replace(/`([^`\n]+)`/g, '$1');

  // 14. Strong (** / __) → text.
  out = out.replace(/(\*\*|__)([^*_]+?)\1/g, '$2');

  // 15. Emphasis (* / _) → text. Run after strong so the lookahead doesn't
  //     eat the inner asterisks/underscores.
  out = out.replace(/(?:\*|_)([^*_\n]+?)(?:\*|_)/g, '$1');

  // 16. Strikethrough (~~text~~) → text.
  out = out.replace(/~~([^~]+)~~/g, '$1');

  // 17. Collapse 3+ blank lines into 2 (cleaner paragraph spacing).
  out = out.replace(/\n{3,}/g, '\n\n');

  return out.trimEnd() + (out.endsWith('\n') ? '' : '\n');
}

/**
 * Reads a note, strips Markdown formatting, and writes the resulting plain
 * text to `destination`. Designed to be paired with a `dialog.save` picker —
 * callers do that step themselves so they can customize the suggested name.
 *
 * @param filename - The note filename within its sub-directory (e.g. "todo.md")
 * @param destination - Absolute path where the .txt file will be written
 * @param isDaily - Whether the note lives under daily/
 * @param isWeekly - Whether the note lives under weekly/
 * @returns The destination path (echoes input, mirrors export_single_note)
 */
export async function exportNoteAsPlaintext(
  filename: string,
  destination: string,
  isDaily: boolean,
  isWeekly: boolean = false
): Promise<string> {
  const markdown = await readNote(filename, isDaily, isWeekly);
  const plain = stripMarkdown(markdown);

  // Reuse the existing write_binary_file IPC so we don't need a new backend
  // command. UTF-8 bytes are safe to round-trip through Vec<u8>; we pass the
  // explicit `txt` extension so the backend's path validator approves the
  // destination (it defaults to PDF for the legacy caller).
  // Encode the plaintext as UTF-8 bytes via the existing Blob -> arrayBuffer
  // path so we don't depend on `TextEncoder` (which the project's eslint
  // environment doesn't recognize as a global).
  const arrayBuffer = await new Blob([plain], { type: 'text/plain' }).arrayBuffer();
  const bytes = new Uint8Array(arrayBuffer);
  await invoke('write_binary_file', {
    path: destination,
    contents: Array.from(bytes),
    extension: 'txt',
  });

  return destination;
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
  const newPath = await invoke<string>('rename_folder', { oldPath, newName });
  readdressFolderNotes(oldPath, newPath);
  return newPath;
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
  const key = noteHashKey(notePath, false, false);
  if (lockedNoteWrites.has(key)) throw new LockedNoteWriteError();
  lockedNoteWrites.add(key);
  try {
    await drainNoteWrites(notePath, false, false);
    const baseHash = noteWriteChainHashes.get(key) ?? noteBaseHashes.get(key) ?? null;
    const newPath = await invoke<string>('move_note', { notePath, toFolder, baseHash });
    readdressNote(notePath, newPath.replace(/^notes\//, ''), false, false);
    return newPath;
  } finally {
    lockedNoteWrites.delete(key);
  }
}

/**
 * Moves a folder (and all its contents) to a different folder or to root.
 * Handles naming conflicts by appending (2), (3), etc.
 * @param folderPath - The current folder path
 * @param toFolder - Destination parent folder path, or undefined for root
 * @returns The new folder path
 */
export async function moveFolder(folderPath: string, toFolder?: string): Promise<string> {
  const newPath = await invoke<string>('move_folder', { folderPath, toFolder });
  readdressFolderNotes(folderPath, newPath);
  return newPath;
}

/**
 * Moves a note to the trash instead of permanently deleting it.
 * @param filename - The note filename (relative path within notes/ or daily/ or weekly/)
 * @param isDaily - Whether this is a daily note
 * @param isWeekly - Whether this is a weekly note
 */
export async function trashNote(
  filename: string,
  isDaily: boolean,
  isWeekly: boolean = false
): Promise<string> {
  const key = noteHashKey(filename, isDaily, isWeekly);
  const wasWriteLocked = lockedNoteWrites.has(key);
  let trashed = false;
  lockedNoteWrites.add(key);
  try {
    await drainNoteWrites(filename, isDaily, isWeekly);
    const trashId = await invoke<string>('trash_note', { filename, isDaily, isWeekly });
    forgetNoteBaseHash(filename, isDaily, isWeekly);
    trashed = true;
    return trashId;
  } finally {
    if (trashed || !wasWriteLocked) lockedNoteWrites.delete(key);
  }
}

export async function listTrash(): Promise<TrashedNote[]> {
  return await invoke('list_trash');
}

/**
 * Restores a note from the trash to its original location.
 * @param trashId - The unique ID of the trashed note
 */
export async function restoreNote(trashId: string): Promise<string> {
  return await invoke<string>('restore_note', { trashId });
}

export async function permanentlyDeleteTrash(trashId: string): Promise<void> {
  await invoke('permanently_delete_trash', { trashId });
}

export async function emptyTrash(): Promise<void> {
  await invoke('empty_trash');
}

/**
 * Cleans up old trash items (older than 7 days).
 * Should be called on app startup.
 * @returns The trash IDs removed from metadata
 */
export async function cleanupOldTrash(): Promise<string[]> {
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
    // Folder-relative address: `note.name` alone resolves to notes/<name>.md,
    // which either misses the note in a folder or rewrites a different note
    // that happens to share its basename at the vault root.
    const backendPath = noteFileBackendPath(note);
    try {
      const content = await readNote(backendPath, note.isDaily, note.isWeekly);

      if (!hasTag(content, oldTag)) {
        continue;
      }

      const updatedContent = renameTagInContent(content, oldTag, newTag);

      if (updatedContent !== content) {
        await writeNote(backendPath, updatedContent, note.isDaily, note.isWeekly);
        updatedCount++;
      }
    } catch (err) {
      console.error(`[renameTagGlobally] Failed to process note ${backendPath}:`, err);
      // Continue with other notes even if one fails
    }
  }

  return updatedCount;
}

/**
 * Page size options accepted by {@link exportNoteToPdf}. These map 1:1 to
 * jsPDF's `format` strings.
 */
export type PdfExportPageSize = 'letter' | 'a4' | 'legal';

/**
 * Margin presets accepted by {@link exportNoteToPdf}. The numeric (mm)
 * values used by jsPDF live in `pdfExportStore` so the UI and the export
 * helper share one source of truth.
 */
export type PdfExportMargin = 'narrow' | 'normal' | 'wide';

/**
 * Optional layout overrides for PDF export. When omitted we fall back to
 * Letter / Normal margins.
 */
export interface PdfExportOptions {
  pageSize?: PdfExportPageSize;
  margin?: PdfExportMargin;
}

const PDF_MARGIN_MM_INTERNAL: Record<PdfExportMargin, number> = {
  narrow: 8,
  normal: 16,
  wide: 26,
};

// Map margin preset → CSS padding for the printable wrapper. Slightly
// generous so headings have breathing room even at "narrow".
const PDF_WRAPPER_PADDING_PX: Record<PdfExportMargin, number> = {
  narrow: 24,
  normal: 40,
  wide: 56,
};

/**
 * Exports a note to PDF format.
 * @param title - The note title (for filename and header)
 * @param htmlContent - The HTML content to export
 * @param destination - The path where the PDF will be saved
 * @param options - Optional page size / margin overrides
 * @returns The path to the created PDF file
 */
export async function exportNoteToPdf(
  title: string,
  htmlContent: string,
  destination: string,
  options: PdfExportOptions = {}
): Promise<string> {
  const pageSize: PdfExportPageSize = options.pageSize ?? 'letter';
  const margin: PdfExportMargin = options.margin ?? 'normal';
  const marginMm = PDF_MARGIN_MM_INTERNAL[margin];
  const wrapperPaddingPx = PDF_WRAPPER_PADDING_PX[margin];

  // Dynamically import html2pdf.js (it's a CJS module)
  const html2pdf = (await import('html2pdf.js')).default;

  // Build the container safely: title goes via textContent (never innerHTML)
  // to prevent markup injection; htmlContent is sanitized upstream by markdownToHtml
  // but we re-sanitize here as defense in depth.
  const container = document.createElement('div');
  const wrapper = document.createElement('div');
  wrapper.style.cssText = `font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; padding: ${wrapperPaddingPx}px; max-width: 760px; margin: 0 auto;`;

  const heading = document.createElement('h1');
  heading.style.cssText = 'font-size: 24px; font-weight: 600; margin-bottom: 24px; color: #1a1a1a;';
  heading.textContent = title;
  wrapper.appendChild(heading);

  const body = document.createElement('div');
  body.style.cssText = 'font-size: 14px; line-height: 1.6; color: #333;';
  body.innerHTML = DOMPurify.sanitize(htmlContent, DOMPURIFY_CONFIG);
  await loadForgeRoot();
  // Strip remote images from the export DOM to avoid leaking URLs to third parties.
  body.querySelectorAll('img').forEach((img) => {
    const src = resolveForgeImageSrc(img.getAttribute('src') ?? '', getForgeRoot());
    if (!/^(data:|asset:|blob:|file:|https?:\/\/asset\.localhost)/i.test(src)) {
      img.remove();
    } else {
      img.setAttribute('src', src);
    }
  });
  wrapper.appendChild(body);
  container.appendChild(wrapper);

  container.querySelectorAll('a').forEach((link) => {
    link.style.color = '#2563eb';
    link.style.textDecoration = 'underline';
  });

  container.querySelectorAll('code').forEach((code) => {
    code.style.backgroundColor = '#f3f4f6';
    code.style.padding = '2px 4px';
    code.style.borderRadius = '4px';
    code.style.fontFamily = 'ui-monospace, SFMono-Regular, Menlo, Monaco, monospace';
    code.style.fontSize = '13px';
  });

  container.querySelectorAll('pre').forEach((pre) => {
    pre.style.backgroundColor = '#f3f4f6';
    pre.style.padding = '12px';
    pre.style.borderRadius = '8px';
    pre.style.overflow = 'auto';
  });

  container.querySelectorAll('table').forEach((table) => {
    table.style.borderCollapse = 'collapse';
    table.style.margin = '12px 0';
  });

  container.querySelectorAll('th, td').forEach((cell) => {
    (cell as HTMLElement).style.border = '1px solid #d1d5db';
    (cell as HTMLElement).style.padding = '6px 10px';
    (cell as HTMLElement).style.verticalAlign = 'top';
  });

  container.querySelectorAll('blockquote').forEach((bq) => {
    bq.style.borderLeft = '3px solid #d1d5db';
    bq.style.paddingLeft = '16px';
    bq.style.marginLeft = '0';
    bq.style.color = '#6b7280';
  });

  const html2pdfOptions = {
    margin: marginMm,
    filename: destination,
    image: { type: 'jpeg' as const, quality: 0.98 },
    // useCORS and allowTaint disabled: remote images were already stripped above
    // to prevent the exporter from leaking image URLs to third-party servers.
    html2canvas: { scale: 2, useCORS: false, allowTaint: false },
    jsPDF: { unit: 'mm', format: pageSize, orientation: 'portrait' as const },
  };

  const pdfBlob = await html2pdf().set(html2pdfOptions).from(container).outputPdf('blob');

  const arrayBuffer = await pdfBlob.arrayBuffer();
  const uint8Array = new Uint8Array(arrayBuffer);

  await invoke('write_binary_file', {
    path: destination,
    contents: Array.from(uint8Array),
  });

  return destination;
}

/**
 * Saves an image to the local images directory.
 * @param data - Base64 encoded image data (can include data URL prefix)
 * @param filename - Original filename (extension determines format)
 * @returns The absolute path to the saved image
 */
export async function saveImage(data: string, filename: string): Promise<string> {
  return await invoke('save_image', { data, filename });
}

export function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

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
  const { maxWidth = 1200, maxHeight = 1200, quality = 0.85, format = 'auto' } = options;

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

      if (width > maxWidth || height > maxHeight) {
        const ratio = Math.min(maxWidth / width, maxHeight / height);
        width = Math.round(width * ratio);
        height = Math.round(height * ratio);
      }

      canvas.width = width;
      canvas.height = height;

      ctx.drawImage(img, 0, 0, width, height);

      let outputFormat: string;
      let outputExt: string;
      const originalExt = file.name.split('.').pop()?.toLowerCase() || '';

      if (format === 'auto') {
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

      const dataUrl = canvas.toDataURL(outputFormat, quality);

      const baseName = file.name.replace(/\.[^/.]+$/, '');
      const filename = `${baseName}.${outputExt}`;

      resolve({ dataUrl, filename });
    };

    img.onerror = () => {
      reject(new Error('Failed to load image'));
    };

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

  const { dataUrl, filename } = await resizeImage(file, options);

  return await saveImage(dataUrl, filename);
}

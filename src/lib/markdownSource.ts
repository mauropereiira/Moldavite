/**
 * markdown-it rules for Markdown the editor has no model for but must save back
 * unchanged. Footnote definitions, HTML blocks the editor did not write, and
 * any lines markdown-it consumes without a token (link reference definitions)
 * become `raw_block` tokens holding their exact source, which the editor keeps
 * as an editable plain-text block; a footnote reference, an inline HTML comment
 * and an inline tag the editor cannot show become inline atoms. Links and lists
 * also carry how the note spelled them, so Turndown can write a bare URL bare,
 * keep a list's markers and keep its blank lines where they were.
 *
 * With `env.sourceMap` set, every top-level block is numbered and its line
 * range recorded in `env.sourceBlocks`, so the caller can attach each block's
 * original Markdown to the HTML it rendered. With `env.listMarkers` set, each
 * list records the marker its first item was written with.
 */

import type MarkdownIt from 'markdown-it';

type BlockRule = Parameters<MarkdownIt['block']['ruler']['before']>[2];
type StateBlock = Parameters<BlockRule>[0];
type InlineRule = Parameters<MarkdownIt['inline']['ruler']['after']>[2];
type Token = ReturnType<StateBlock['push']>;

export interface SourceMapEnv {
  references?: unknown;
  listMarkers?: boolean;
  sourceMap?: string;
  sourceBlocks?: Array<[number, number]>;
}

const FOOTNOTE_DEFINITION = /^\[\^[^\s\]]+\]:/;
const DETAILS_OPEN = /^<details(?=[\s>]|$)/i;
const DETAILS_TAG = /<(\/?)details(?=[\s/>]|$)/gi;

function lineText(state: StateBlock, line: number): string {
  return state.src.slice(state.bMarks[line] + state.tShift[line], state.eMarks[line]);
}

function pushRawBlock(state: StateBlock, startLine: number, nextLine: number): void {
  const token = state.push('raw_block', 'pre', 0);
  token.map = [startLine, nextLine];
  token.content = state.getLines(startLine, nextLine, state.blkIndent, false);
  state.line = nextLine;
}

/**
 * A run of `[^label]: text` definitions with their indented and lazy
 * continuation lines, extended the way markdown-it-footnote reads one. Adjacent
 * definitions share a block so saving them adds no blank line between.
 */
const footnoteDefinition: BlockRule = (state, startLine, endLine, silent) => {
  if (state.sCount[startLine] - state.blkIndent >= 4) return false;
  if (!FOOTNOTE_DEFINITION.test(lineText(state, startLine))) return false;
  if (silent) return true;

  const terminators = state.md.block.ruler.getRules('paragraph');
  const parentType = state.parentType;
  state.parentType = 'paragraph';
  let end = startLine + 1;
  for (let line = end; line < endLine; line++) {
    if (state.isEmpty(line)) continue;
    const lazy = state.sCount[line] < 0;
    if (!lazy && state.sCount[line] < state.blkIndent) break;
    const indented = state.sCount[line] - state.blkIndent >= 4;
    if (line > end) {
      if (!indented) break;
    } else if (
      !indented &&
      !lazy &&
      !FOOTNOTE_DEFINITION.test(lineText(state, line)) &&
      terminators.some((rule) => rule(state, line, endLine, true))
    ) {
      break;
    }
    end = line + 1;
  }
  state.parentType = parentType;

  pushRawBlock(state, startLine, end);
  return true;
};

/**
 * From `<details>` to its matching `</details>`, nested ones included, then on
 * to a blank line as any HTML block runs. One that never closes ends at the
 * first blank line, which is all markdown-it would have kept together.
 */
const detailsBlock: BlockRule = (state, startLine, endLine, silent) => {
  if (state.sCount[startLine] - state.blkIndent >= 4) return false;
  if (!DETAILS_OPEN.test(lineText(state, startLine))) return false;
  if (silent) return true;

  let closed = startLine;
  let depth = 0;
  for (let line = startLine; line < endLine; line++) {
    if (!state.isEmpty(line) && state.sCount[line] < state.blkIndent) break;
    for (const tag of lineText(state, line).matchAll(DETAILS_TAG)) depth += tag[1] ? -1 : 1;
    if (depth <= 0) {
      closed = line;
      break;
    }
  }
  let end = closed + 1;
  while (end < endLine && !state.isEmpty(end) && state.sCount[end] >= state.blkIndent) end++;

  pushRawBlock(state, startLine, end);
  return true;
};

/** `[^label]` anywhere in text. A definition is not required, so the bytes never depend on one. */
const footnoteReference: InlineRule = (state, silent) => {
  const start = state.pos;
  if (state.src.charCodeAt(start) !== 0x5b || state.src.charCodeAt(start + 1) !== 0x5e) {
    return false;
  }
  const end = state.src.indexOf(']', start + 2);
  if (end === -1 || end >= state.posMax) return false;
  const label = state.src.slice(start + 2, end);
  if (!label || /\s/.test(label)) return false;
  if (!silent) state.push('footnote_ref', '', 0).meta = { label };
  state.pos = end + 1;
  return true;
};

/**
 * HTML the editor writes itself: its images and aligned paragraphs. Any other
 * HTML block (a `<div align>` wrapper, a `<table>`, an unknown tag) lost its
 * tags on the way through the editor, or vanished entirely.
 */
const EDITOR_HTML_BLOCK = /^(?:<img\s|<p style="text-align:)/i;

/** Inline tags the editor has a mark or node for; any other inline HTML is kept as written. */
const EDITOR_INLINE_TAG =
  /^<\/?(?:a|b|br|code|del|em|i|img|input|label|mark|s|strong|u|wiki-link)(?=[\s/>])/i;

/** Blank as markdown-it reads a line: spaces and tabs only, not other whitespace. */
export function isBlank(line: string | undefined): boolean {
  return /^[ \t]*$/.test(line ?? '');
}

/** Source lines no top-level token covers, such as link reference definitions, as raw blocks. */
function keepUncoveredLines(tokens: Token[], src: string, makeToken: () => Token): Token[] {
  const lines = src.split('\n');
  const out: Token[] = [];
  let covered = 0;
  const keep = (end: number) => {
    let start = covered;
    while (start < end && isBlank(lines[start])) start++;
    let stop = end;
    while (stop > start && isBlank(lines[stop - 1])) stop--;
    if (stop > start) {
      const token = makeToken();
      token.map = [start, stop];
      token.content = lines.slice(start, stop).join('\n');
      out.push(token);
    }
  };
  for (const token of tokens) {
    if (token.level === 0 && token.nesting !== -1 && token.map) {
      if (token.map[0] > covered) keep(token.map[0]);
      covered = Math.max(covered, token.map[1]);
    }
    out.push(token);
  }
  keep(lines.length);
  return out;
}

/**
 * The marker a list's first item was written with and the spaces after it, as
 * `*3` for `*   `: DOMPurify trims attribute values, which would lose them.
 */
function listMarker(list: Token, lines: string[]): string {
  const line = (lines[list.map?.[0] ?? -1] ?? '').replace(/^(?:[ \t]*>)*/, '');
  const spaces = /^[ \t]*(?:[-*+]|\d{1,9}[.)])( *)/.exec(line)?.[1].length ?? 1;
  return `${list.markup}${spaces >= 1 && spaces <= 4 ? spaces : 1}`;
}

function mapSources(tokens: Token[], src: string, env: SourceMapEnv): void {
  const lines = src.split('\n');
  const blocks: Array<[number, number]> = [];
  for (const token of tokens) {
    if (env.listMarkers && /^(?:bullet|ordered)_list_open$/.test(token.type)) {
      token.attrSet('data-md-marker', listMarker(token, lines));
    }
    if (env.sourceMap && token.level === 0 && token.nesting !== -1 && token.map) {
      token.attrSet('data-md-id', `${env.sourceMap}.${blocks.length}`);
      blocks.push([token.map[0], token.map[1]]);
    }
  }
  env.sourceBlocks = blocks;
}

/**
 * The text each bare or `<...>` link was written as. markdown-it shows a link's
 * text decoded and its href encoded, so `caf%C3%A9` and `café` render alike and
 * only the source says which one the note used.
 */
function recordLinkSources(md: MarkdownIt, inline: Token): void {
  const links = (inline.children ?? []).filter(
    (token) => token.type === 'link_open' && /^(?:linkify|autolink)$/.test(token.markup)
  );
  if (links.length === 0) return;
  const matches = md.linkify.match(inline.content) ?? [];
  let next = 0;
  for (const link of links) {
    const href = link.attrGet('href');
    const at = matches.findIndex((match, i) => i >= next && md.normalizeLink(match.url) === href);
    if (at === -1) continue;
    link.meta = { source: matches[at].raw };
    next = at + 1;
  }
}

/**
 * Where a list item had blank lines: before the next item, and between its own
 * blocks. markdown-it only says whether a whole list is loose, and the editor
 * splits a list where bullets meet tasks, so each item keeps its own spacing.
 */
function recordListSpacing(tokens: Token[], src: string): void {
  const lines = src.split('\n');
  const blank = (line: number) => line >= 0 && /^[\s>]*$/.test(lines[line] ?? '');
  const closeOf = (open: number) => {
    let at = open + 1;
    while (tokens[at].level !== tokens[open].level) at++;
    return at;
  };
  tokens.forEach((item, open) => {
    if (item.type !== 'list_item_open') return;
    const close = closeOf(open);
    const children = tokens
      .slice(open + 1, close)
      .filter((child) => child.level === item.level + 1 && child.nesting !== -1);
    if (children.some((child, i) => i > 0 && child.map && blank(child.map[0] - 1))) {
      item.attrSet('data-gap-inside', 'true');
    }
    const next = tokens[close + 1];
    if (next?.type === 'list_item_open' && next.map && blank(next.map[0] - 1)) {
      item.attrSet('data-gap-after', 'true');
    }
  });
}

export function markdownSourcePlugin(md: MarkdownIt): void {
  md.block.ruler.before('reference', 'footnote_definition', footnoteDefinition, {
    alt: ['paragraph', 'reference'],
  });
  md.block.ruler.before('html_block', 'details_block', detailsBlock, {
    alt: ['paragraph', 'reference', 'blockquote'],
  });
  md.inline.ruler.after('image', 'footnote_reference', footnoteReference);

  md.core.ruler.after('block', 'raw_html_blocks', (state) => {
    for (const token of state.tokens) {
      if (token.type === 'html_block' && !EDITOR_HTML_BLOCK.test(token.content)) {
        token.type = 'raw_block';
        token.content = token.content.replace(/\n$/, '');
      }
    }
    state.tokens = keepUncoveredLines(state.tokens, state.src, () => {
      const token = new state.Token('raw_block', 'pre', 0);
      token.block = true;
      return token;
    });
  });
  md.core.ruler.push('raw_inline_html', (state) => {
    for (const token of state.tokens) {
      for (const child of token.children ?? []) {
        if (child.type === 'html_inline' && !EDITOR_INLINE_TAG.test(child.content)) {
          child.type = 'raw_inline';
        }
      }
    }
  });
  md.core.ruler.push('source_map', (state) => {
    const env = state.env as SourceMapEnv;
    if (env.sourceMap || env.listMarkers) mapSources(state.tokens, state.src, env);
  });

  md.core.ruler.after('block', 'list_spacing', (state) =>
    recordListSpacing(state.tokens, state.src)
  );
  md.core.ruler.after('linkify', 'link_sources', (state) => {
    for (const token of state.tokens) if (token.type === 'inline') recordLinkSources(md, token);
  });

  const escape = md.utils.escapeHtml;
  md.renderer.rules.raw_block = (tokens, idx, _options, _env, self) =>
    `<pre data-type="raw-markdown"${self.renderAttrs(tokens[idx])}>${escape(tokens[idx].content)}</pre>\n`;
  md.renderer.rules.raw_inline = (tokens, idx) =>
    `<span data-type="raw-inline">${escape(tokens[idx].content)}</span>`;
  md.renderer.rules.html_block = (tokens, idx) => {
    const id = tokens[idx].attrGet('data-md-id');
    const html = tokens[idx].content;
    return id ? html.replace(/^<(img|p)\b/gim, `<$1 data-md-id="${escape(id)}"`) : html;
  };
  md.renderer.rules.footnote_ref = (tokens, idx) => {
    const label = escape(tokens[idx].meta.label);
    return `<span data-type="footnote-ref" data-label="${label}">${label}</span>`;
  };

  md.renderer.rules.link_open = (tokens, idx, options, _env, self) => {
    const token = tokens[idx];
    if (token.markup === 'linkify') token.attrJoin('class', 'md-linkify');
    if (token.markup === 'autolink') token.attrJoin('class', 'md-autolink');
    const source = token.meta?.source;
    if (source && source !== tokens[idx + 1]?.content) token.attrSet('data-source', source);
    return self.renderToken(tokens, idx, options);
  };
}

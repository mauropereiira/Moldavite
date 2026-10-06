/**
 * markdown-it rules for Markdown the editor has no model for but must save back
 * unchanged. Footnote definitions, `<details>` blocks and HTML comments become
 * `raw_block` tokens holding their exact source, which the editor keeps as an
 * editable plain-text block; a footnote reference becomes an inline atom. Links
 * and list items also carry how the note spelled them, so Turndown can write a
 * bare URL bare and keep a list's blank lines where they were.
 */

import type MarkdownIt from 'markdown-it';

type BlockRule = Parameters<MarkdownIt['block']['ruler']['before']>[2];
type StateBlock = Parameters<BlockRule>[0];
type InlineRule = Parameters<MarkdownIt['inline']['ruler']['after']>[2];
type Token = ReturnType<StateBlock['push']>;

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

  md.core.ruler.after('block', 'raw_html_comments', (state) => {
    for (const token of state.tokens) {
      if (token.type === 'html_block' && token.content.startsWith('<!--')) {
        token.type = 'raw_block';
        token.content = token.content.replace(/\n$/, '');
      }
    }
  });

  md.core.ruler.after('block', 'list_spacing', (state) =>
    recordListSpacing(state.tokens, state.src)
  );
  md.core.ruler.after('linkify', 'link_sources', (state) => {
    for (const token of state.tokens) if (token.type === 'inline') recordLinkSources(md, token);
  });

  const escape = md.utils.escapeHtml;
  md.renderer.rules.raw_block = (tokens, idx) =>
    `<pre data-type="raw-markdown">${escape(tokens[idx].content)}</pre>\n`;
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

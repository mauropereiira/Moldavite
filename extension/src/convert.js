/**
 * HTML → Markdown for the clipper. Text only: links survive, everything visual
 * does not. Kept free of extension APIs so it can be tested in jsdom without a
 * browser — the popup is the only caller that knows about tabs or ports.
 */

import { Readability } from '@mozilla/readability';
import TurndownService from 'turndown';
import { gfm } from 'turndown-plugin-gfm';

/** Removed before conversion: none of it survives as text worth reading. */
const DROPPED = [
  'script',
  'style',
  'noscript',
  'img',
  'picture',
  'svg',
  'iframe',
  'video',
  'audio',
  'form',
  'button',
];

function service() {
  const turndown = new TurndownService({
    headingStyle: 'atx',
    codeBlockStyle: 'fenced',
    bulletListMarker: '-',
    emDelimiter: '*',
  });
  turndown.use(gfm);
  // A rule, not `remove()`: Turndown consults its built-in rules first, so the
  // stock `image` rule would beat a remove filter and emit `![]()` anyway.
  turndown.addRule('stripVisuals', {
    filter: DROPPED,
    replacement: () => '',
  });
  return turndown;
}

/**
 * Rewrite hrefs in place: absolute http(s) survives, everything else unwraps to
 * plain text. A note is read far from the page it came from, so a relative link
 * is worse than no link, and `javascript:` has no business in a file on disk.
 */
function normaliseLinks(root, baseUrl) {
  for (const anchor of root.querySelectorAll('a[href]')) {
    let resolved;
    try {
      resolved = new URL(anchor.getAttribute('href'), baseUrl);
    } catch {
      anchor.removeAttribute('href');
      continue;
    }
    if (resolved.protocol !== 'http:' && resolved.protocol !== 'https:') {
      anchor.removeAttribute('href');
      continue;
    }
    anchor.setAttribute('href', resolved.href);
  }
}

/**
 * Parse with the page's own URL as the document base. Without this the popup's
 * `chrome-extension://` origin is the base, and Readability rewrites every
 * relative link on the page to point back into the extension.
 */
function parseWithBase(parser, html, baseUrl) {
  const doc = parser.parseFromString(html, 'text/html');
  const base = doc.createElement('base');
  base.setAttribute('href', baseUrl);
  doc.head?.prepend(base);
  return doc;
}

/**
 * @param {string} html full page HTML
 * @param {string} baseUrl the page's own URL, used to resolve relative links
 * @returns {string} Markdown. No H1: the note's title heading is written by the
 *   app from the page title, so emitting one here would double it.
 */
export function htmlToMarkdown(html, baseUrl) {
  const parser = new DOMParser();

  // Readability mutates the document it is handed, so it gets its own copy and
  // the fallback still has an untouched one to work from.
  let article = null;
  try {
    article = new Readability(parseWithBase(parser, html, baseUrl)).parse();
  } catch {
    article = null;
  }

  const source = parseWithBase(parser, article?.content ?? html, baseUrl);
  normaliseLinks(source.body, baseUrl);

  return service().turndown(source.body.innerHTML).trim();
}

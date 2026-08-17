import { describe, expect, it } from 'vitest';
// `?raw` rather than readFileSync: under the jsdom environment `import.meta.url`
// is an http URL, so a path derived from it does not exist on disk.
import articleHtml from './fixtures/article.html?raw';
import codeAndTablesHtml from './fixtures/code-and-tables.html?raw';
import docsPageHtml from './fixtures/docs-page.html?raw';
import { htmlToMarkdown } from '../src/convert.js';

describe('htmlToMarkdown', () => {
  it('keeps structure and links, drops images and styling', () => {
    const md = htmlToMarkdown(articleHtml, 'https://example.com/posts/tls');

    expect(md).toContain('## How the handshake works');
    // Turndown's own list indentation, which is what the app already writes
    // everywhere else. One markdown style per Forge.
    expect(md).toContain('-   First point');
    expect(md).toContain('> A quoted line');
    expect(md).not.toContain('![');
    expect(md).not.toContain('class=');
    expect(md).not.toContain('<div');
  });

  it('makes relative links absolute so they still work from a note', () => {
    const md = htmlToMarkdown(articleHtml, 'https://example.com/posts/tls');

    expect(md).toContain('(https://example.com/posts/related)');
    expect(md).not.toContain('](/posts/related)');
  });

  it('drops links that are not http(s)', () => {
    const md = htmlToMarkdown(
      '<article><p><a href="javascript:alert(1)">click</a></p></article>',
      'https://example.com/'
    );

    expect(md).toContain('click');
    expect(md).not.toContain('javascript:');
  });

  it('keeps fenced code and tables', () => {
    const md = htmlToMarkdown(codeAndTablesHtml, 'https://example.com/');

    expect(md).toContain('```');
    expect(md).toContain('| Header |');
  });

  it('keeps the main content and leaves the navigation behind', () => {
    const md = htmlToMarkdown(docsPageHtml, 'https://example.com/docs');

    expect(md).toContain('timeout');
    expect(md).not.toContain('/docs/install');
  });

  it('falls back to the page body when there is no article to find', () => {
    const md = htmlToMarkdown(
      '<html><body><p>Just a sentence.</p></body></html>',
      'https://example.com/'
    );

    expect(md).toBe('Just a sentence.');
  });
});

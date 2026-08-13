/** Markdown-paste detection and conversion regression coverage. */

import { describe, expect, it } from 'vitest';
import { markdownToHtml } from './fileSystem';
import { looksLikeMarkdown } from './markdownPaste';

describe('looksLikeMarkdown', () => {
  it.each([
    ['level-one heading', '# Heading'],
    ['level-two heading', '## Heading'],
    ['level-three heading', '### Heading'],
    ['dash list', '- item'],
    ['asterisk list', '* item'],
    ['plus list', '+ item'],
    ['ordered list', '1. item'],
    ['unchecked task', '- [ ] task'],
    ['checked task', '- [x] task'],
    ['fenced code block', '```ts\nconst value = 1;\n```'],
    ['blockquote', '> quote'],
    ['bold', 'This is **bold** text.'],
    ['underscore bold', 'This is __bold__ text.'],
    ['italic', 'This is *italic* text.'],
    ['strikethrough', 'This is ~~removed~~ text.'],
    ['inline code', 'Use `code` here.'],
    ['Markdown link', '[Link](https://example.com)'],
    ['horizontal rule in a Markdown document', '**Section**\n\n---'],
    ['wiki link', 'See [[Note]].'],
    ['aliased wiki link', 'See [[Display|Target]].'],
    [
      'representative document',
      '# Title\n\nThis is **bold**.\n\n- one\n- two\n\n> quote\n\n[[Note]]',
    ],
  ])('recognizes %s', (_name, text) => {
    expect(looksLikeMarkdown(text)).toBe(true);
  });

  it.each([
    ['empty text', ''],
    ['whitespace', ' \n\t '],
    ['normal paragraph', 'This is an ordinary paragraph.'],
    ['sentence hyphen', 'This is a normal sentence - with a dash.'],
    ['hashtag', 'Call #support tomorrow.'],
    ['decimal', 'Version 2.5 is installed.'],
    ['ordinary brackets', 'Use [brackets] in the label.'],
    ['plain URL', 'https://example.com'],
    ['ordinary multiline prose', 'First ordinary line.\nSecond ordinary line.'],
    ['level-four heading', '#### Heading'],
    ['level-five heading', '##### Heading'],
    ['level-six heading', '###### Heading'],
    ['dunder method', 'def __init__(self, x):'],
    ['JavaScript template literal', 'const greeting = `hello there`;'],
    // A lone `---` is also Moldavite's frontmatter delimiter, so it no longer opts into conversion.
    ['lone horizontal rule', '---'],
    ['YAML frontmatter block', '---\ntitle: My Note\n---'],
    ['raw Moldavite note', '---\ntitle: My Note\n---\n\n# Markdown body'],
  ])('rejects %s', (_name, text) => {
    expect(looksLikeMarkdown(text)).toBe(false);
  });
});

describe('Markdown paste conversion', () => {
  it('produces supported TipTap-compatible HTML through the existing conversion pipeline', () => {
    const markdown = [
      '# Heading',
      '',
      'This is **bold**.',
      '',
      '- regular item',
      '',
      '- [ ] unfinished task',
      '',
      '[Link](https://example.com)',
      '',
      '[[Display|Target Note]]',
      '',
      '```js',
      'console.log("hello");',
      '```',
    ].join('\n');

    const container = document.createElement('div');
    container.innerHTML = markdownToHtml(markdown);

    expect(container.querySelector('h1')?.textContent).toBe('Heading');
    expect(container.querySelector('strong')?.textContent).toBe('bold');
    expect(container.querySelector('ul:not([data-type="taskList"]) li')?.textContent?.trim()).toBe(
      'regular item'
    );
    expect(container.querySelector('ul[data-type="taskList"]')).not.toBeNull();
    expect(
      container.querySelector('li[data-type="taskItem"][data-checked="false"]')?.textContent
    ).toContain('unfinished task');
    expect(container.querySelector('a')?.getAttribute('href')).toBe('https://example.com');
    expect(container.querySelector('wiki-link')?.getAttribute('data-target')).toBe(
      'target-note.md'
    );
    expect(container.querySelector('pre code')?.textContent).toContain('console.log("hello");');
  });
});

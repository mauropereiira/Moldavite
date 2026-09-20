/**
 * Round-trip and sanitiser regressions for the Markdown <-> HTML boundary.
 * Every note goes through this pair on every load and every autosave, so a
 * lossy conversion silently rewrites the file on disk.
 */

import { describe, it, expect } from 'vitest';
import { markdownToHtml, htmlToMarkdown } from './fileSystem';

function parse(html: string): HTMLElement {
  const container = document.createElement('div');
  container.innerHTML = html;
  return container;
}

describe('nested task lists', () => {
  it('keeps a nested task list inside its parent item', () => {
    const dom = parse(markdownToHtml('- [ ] a\n  - [x] b\n- [ ] c'));

    const lists = dom.querySelectorAll('ul[data-type="taskList"]');
    expect(lists).toHaveLength(2);

    const outerItems = Array.from(lists[0].children);
    expect(outerItems.map((li) => li.getAttribute('data-checked'))).toEqual(['false', 'false']);

    const nested = outerItems[0].querySelector('ul[data-type="taskList"]');
    expect(nested).not.toBeNull();
    expect(nested?.children).toHaveLength(1);
    expect(nested?.children[0].getAttribute('data-checked')).toBe('true');

    // Every task item must stay inside a list; a stray <li> is dropped by TipTap.
    for (const item of Array.from(dom.querySelectorAll('li[data-type="taskItem"]'))) {
      expect(item.parentElement?.getAttribute('data-type')).toBe('taskList');
    }
  });

  it('round-trips nesting and checked state without change', () => {
    const markdown = '- [ ] a\n  - [x] b\n- [ ] c';
    expect(htmlToMarkdown(markdownToHtml(markdown))).toBe(markdown);
  });

  it('still converts a flat task list', () => {
    const dom = parse(markdownToHtml('- [x] done\n- [ ] todo'));
    const items = dom.querySelectorAll('li[data-type="taskItem"]');
    expect(items).toHaveLength(2);
    expect(items[0].getAttribute('data-checked')).toBe('true');
    expect(items[0].querySelector('label > input[type="checkbox"]')).not.toBeNull();
    expect(items[0].querySelector('div > p')?.textContent).toBe('done');
    expect(items[1].getAttribute('data-checked')).toBe('false');
    expect(items[1].querySelector('div > p')?.textContent).toBe('todo');
  });
});

describe('image attributes', () => {
  it('escapes quotes in alt text so the image survives a save/load cycle', () => {
    const markdown = htmlToMarkdown('<p><img src="a.png" alt="say &quot;hi&quot;" width="10"></p>');
    const image = parse(markdownToHtml(markdown)).querySelector('img');
    expect(image).not.toBeNull();
    expect(image?.getAttribute('alt')).toBe('say "hi"');
    expect(image?.getAttribute('width')).toBe('10');
  });
});

describe('literal angle brackets', () => {
  it('keeps tag-like text instead of dropping it as unknown HTML', () => {
    const first = htmlToMarkdown(markdownToHtml('placeholder &lt;Name&gt; here'));
    expect(parse(markdownToHtml(first)).textContent).toContain('<Name>');
    // And the escape is stable, so the file stops changing on later saves.
    expect(htmlToMarkdown(markdownToHtml(first))).toBe(first);
  });

  it('leaves a lone comparison alone', () => {
    expect(htmlToMarkdown(markdownToHtml('when a < b holds'))).toBe('when a < b holds');
  });
});

describe('image URL schemes', () => {
  it('drops javascript: image sources', () => {
    expect(
      parse(markdownToHtml('<img src="javascript:alert(1)">')).querySelector('img')
    ).not.toBeNull();
    expect(
      parse(markdownToHtml('<img src="javascript:alert(1)">'))
        .querySelector('img')
        ?.hasAttribute('src')
    ).toBe(false);
  });

  it('keeps the asset URLs the app itself writes', () => {
    for (const src of [
      'asset://localhost/Users/x/a.png',
      'http://asset.localhost/Users/x/a.png',
      'data:image/png;base64,AAA',
    ]) {
      const image = parse(markdownToHtml(`<img src="${src}" alt="">`)).querySelector('img');
      expect(image?.getAttribute('src')).toBe(src);
    }
  });
});

describe('link target hardening', () => {
  it('gives every new-tab link a rel that severs the opener', () => {
    const dom = parse(markdownToHtml('<a href="https://example.com" target="_blank">x</a>'));
    const link = dom.querySelector('a');

    // Without `noopener`, the opened page gets `window.opener` back and can
    // navigate this one. `noreferrer` also covers older WebKit, which honours
    // it but not `noopener`.
    expect(link?.getAttribute('rel')).toContain('noopener');
    expect(link?.getAttribute('rel')).toContain('noreferrer');
  });

  it('keeps a rel the note already carried', () => {
    const dom = parse(
      markdownToHtml('<a href="https://example.com" target="_blank" rel="author">x</a>')
    );

    expect(dom.querySelector('a')?.getAttribute('rel')).toContain('author');
  });

  it('leaves a same-tab link alone', () => {
    const dom = parse(markdownToHtml('<a href="https://example.com">x</a>'));

    expect(dom.querySelector('a')?.hasAttribute('rel')).toBe(false);
  });
});

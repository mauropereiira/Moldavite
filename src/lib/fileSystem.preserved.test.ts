/**
 * Footnotes, `<details>` blocks, HTML comments and bare URLs have no editor
 * model of their own. Saving dropped the first three and rewrote the last, so
 * each has to come back from load, TipTap and save byte for byte, including
 * after an edit beside it.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { Editor } from '@tiptap/core';
import { createNoteExtensions } from '@/components/editor/noteExtensions';
import { htmlToMarkdown, markdownToHtml, noteContentToEditorHtml } from './fileSystem';

let editor: Editor;
afterEach(() => editor?.destroy());

function open(markdown: string): Editor {
  editor = new Editor({
    extensions: createNoteExtensions(),
    content: noteContentToEditorHtml(markdown),
  });
  return editor;
}

function save(markdown: string): string {
  const opened = new Editor({
    extensions: createNoteExtensions(),
    content: noteContentToEditorHtml(markdown),
  });
  try {
    return htmlToMarkdown(opened.getHTML());
  } finally {
    opened.destroy();
  }
}

function saveOpen(): string {
  return htmlToMarkdown(editor.getHTML());
}

function typeInto(text: string) {
  for (const char of text) {
    const { from, to } = editor.state.selection;
    const handled = editor.view.someProp('handleTextInput', (handle) =>
      handle(editor.view, from, to, char, () => editor.state.tr.insertText(char, from, to))
    );
    if (!handled) editor.view.dispatch(editor.state.tr.insertText(char, from, to));
  }
}

/** The document position just after the first occurrence of `text`. */
function after(text: string): number {
  let found = -1;
  editor.state.doc.descendants((node, pos) => {
    if (found !== -1 || !node.isText) return;
    const at = (node.text ?? '').indexOf(text);
    if (at !== -1) found = pos + at + text.length;
  });
  if (found === -1) throw new Error(`"${text}" is not in the document`);
  return found;
}

function nodeTypes(): string[] {
  const types: string[] = [];
  editor.state.doc.descendants((node) => {
    types.push(node.type.name);
  });
  return types;
}

describe('footnotes', () => {
  it.each([
    ['a reference and its definition', 'Text[^1] here.\n\n[^1]: The note.'],
    ['named labels', 'Claim[^source] and[^other-2].\n\n[^source]: A book.\n\n[^other-2]: A site.'],
    ['adjacent definitions', 'A[^1] B[^2]\n\n[^1]: One.\n[^2]: Two.\n[^3]: Three.'],
    [
      'a definition with indented paragraphs',
      'A[^long]\n\n[^long]: First paragraph\n    still the first.\n\n    A second paragraph.\n\n        code in it\n\nAfter.',
    ],
    ['a lazy continuation line', 'A[^1]\n\n[^1]: Starts here\nand carries on here.'],
    ['a definition holding a URL and a wiki link', 'A[^1]\n\n[^1]: See [[Note]] and https://x.com'],
    ['a definition that looks like a link reference', 'A[^1]\n\n[^1]: https://example.com'],
    ['a reference in a heading', '## Heading[^1]\n\n[^1]: Note.'],
    ['a reference in bold and in a table', '**Bold[^1]**\n\n| a[^2] | b |\n| --- | --- |'],
    ['references in a list', '- one[^1]\n- two[^2]\n  - deeper[^3]'],
    ['a definition in a list item', '- item[^1]\n\n  [^1]: Defined in the list.\n\n- next'],
    ['a footnote in a quote', '> Quoted[^q].\n>\n> [^q]: Defined in the quote.'],
    ['a footnote in a nested quote', '> Outer\n>\n> > Inner[^n]\n> >\n> > [^n]: Nested.'],
    ['definitions in the middle of a note', 'One[^1]\n\n[^1]: Mid.\n\n## Next\n\nTwo.'],
    ['a reference with no definition', 'Dangling[^nowhere] reference.'],
  ])('keeps %s byte for byte', (_name, markdown) => {
    expect(save(markdown)).toBe(markdown);
  });

  it('shows a reference as its label and a definition as editable source', () => {
    open('Text[^1]\n\n[^1]: The note.');
    expect(nodeTypes()).toEqual(['paragraph', 'text', 'footnoteRef', 'rawMarkdown', 'text']);
    expect(editor.view.dom.querySelector('.footnote-ref')?.textContent).toBe('1');
    expect(editor.view.dom.querySelector('pre.raw-markdown')?.textContent).toBe('[^1]: The note.');
  });

  it.each([
    ['a code span', 'Use `[^1]` literally.'],
    ['a fence', '```\nregex [^abc]\n[^1]: not a footnote\n```'],
    ['an escaped bracket', 'Not \\[^1\\] a reference.'],
  ])('leaves %s as it was', (_name, markdown) => {
    expect(markdownToHtml(markdown)).not.toContain('footnote-ref');
    expect(markdownToHtml(markdown)).not.toContain('raw-markdown');
    expect(save(markdown)).toBe(markdown);
  });

  it('leaves a label with a space as text', () => {
    expect(markdownToHtml('Not [^a b] a reference.')).not.toContain('footnote-ref');
  });

  it('keeps a reference and its definition when text is typed beside them', () => {
    open('Text[^1] here.\n\n[^1]: The note.');
    editor.commands.setTextSelection(after('Text'));
    typeInto(' more');
    editor.commands.setTextSelection(after('The note.'));
    typeInto(' Edited.');
    expect(saveOpen()).toBe('Text more[^1] here.\n\n[^1]: The note. Edited.');
  });

  it('makes a typed [^label] a reference that saves as written', () => {
    open('Start');
    editor.commands.setTextSelection(after('Start'));
    typeInto(' end[^2]');
    expect(nodeTypes()).toContain('footnoteRef');
    expect(saveOpen()).toBe('Start end[^2]');
  });
});

describe('details blocks', () => {
  it.each([
    ['a simple block', '<details>\n<summary>More</summary>\n\nHidden **text**.\n\n</details>'],
    ['an open block', '<details open>\n<summary>Shown</summary>\n\n- a\n- b\n\n</details>'],
    ['one line', '<details><summary>Q</summary>A</details>'],
    [
      'nested blocks',
      '<details>\n<summary>Outer</summary>\n\n<details>\n<summary>Inner</summary>\n\nDeep.\n\n</details>\n\nOuter again.\n\n</details>',
    ],
    [
      'code inside',
      '<details>\n<summary>Code</summary>\n\n```js\nconst a = 1;\n\nlet b;\n```\n\n</details>',
    ],
    [
      'a block in a list item',
      '- item\n\n  <details>\n  <summary>S</summary>\n\n  Body\n\n  </details>\n\n- next',
    ],
    ['a block in a quote', '> <details>\n> <summary>S</summary>\n>\n> Body\n>\n> </details>'],
    [
      'text around a block',
      'Before.\n\n<details>\n<summary>S</summary>\n\nBody\n\n</details>\n\nAfter [[Note]].',
    ],
    [
      'lines after the closing tag',
      '<details>\n<summary>S</summary>\nBody\n</details>\nTrailing line',
    ],
    ['an unclosed block', '<details>\n<summary>S</summary>\n\nText after it.'],
    ['uppercase tags', '<DETAILS>\n<SUMMARY>S</SUMMARY>\n\nBody\n\n</DETAILS>'],
  ])('keeps %s byte for byte', (_name, markdown) => {
    expect(save(markdown)).toBe(markdown);
  });

  it('keeps wiki links and tags inside the block as source', () => {
    const markdown = '<details>\n<summary>S</summary>\n\nSee [[Note]] #tag\n\n</details>';
    expect(markdownToHtml(markdown)).not.toContain('<wiki-link');
    expect(save(markdown)).toBe(markdown);
  });

  it('keeps the block when a paragraph is added before it and its text is edited', () => {
    open('Intro\n\n<details>\n<summary>S</summary>\n\nBody\n\n</details>');
    editor.commands.setTextSelection(after('Intro'));
    editor.commands.splitBlock();
    typeInto('New line');
    editor.commands.setTextSelection(after('Body'));
    typeInto(' text');
    expect(saveOpen()).toBe(
      'Intro\n\nNew line\n\n<details>\n<summary>S</summary>\n\nBody text\n\n</details>'
    );
  });

  it('does not stop a <detailsfoo> tag being HTML', () => {
    expect(markdownToHtml('<detailsx>\ntext')).not.toContain('raw-markdown');
  });
});

describe('HTML comments', () => {
  it.each([
    ['a one-line comment', '<!-- hidden -->\n\nText'],
    ['a comment over several lines', 'Text\n\n<!--\nTODO: one\n\nTODO: two\n-->\n\nMore'],
    ['a comment in a list item', '- a\n\n  <!-- note -->\n\n- b'],
  ])('keeps %s byte for byte', (_name, markdown) => {
    expect(save(markdown)).toBe(markdown);
  });
});

describe('bare URLs', () => {
  it.each([
    ['a URL in a sentence', 'See https://example.com for more.'],
    ['a URL at the start of a line', 'https://example.com is the site.'],
    ['a URL at the end of a line', 'The site is https://example.com'],
    ['a URL alone', 'https://example.com/path?q=1&r=2#frag'],
    ['a URL in parentheses', 'The site (https://example.com) is up.'],
    ['a URL holding parentheses', 'Read https://en.wikipedia.org/wiki/Foo_(bar) now.'],
    ['trailing punctuation', 'Go to https://example.com. Or https://example.org, or https://x.io!'],
    ['a question mark after a URL', 'Is it https://example.com?'],
    ['underscores and tildes', 'See https://example.com/a_b_c/~user/x*y'],
    ['a www address', 'Visit www.example.com today.'],
    ['an email address', 'Mail me@example.com please.'],
    ['a percent-encoded URL', 'See https://de.wikipedia.org/wiki/K%C3%B6ln here.'],
    ['a Unicode URL', 'See https://de.wikipedia.org/wiki/Köln here.'],
    ['an autolink', 'See <https://example.com> here.'],
    ['an email autolink', 'Mail <me@example.com>.'],
    ['an explicit link showing its URL', '[https://example.com](https://example.com)'],
    ['a link with text', '[Example](https://example.com) and [x](https://x.io "Title")'],
    ['a URL in bold', 'This **https://example.com** matters.'],
    ['a URL in a list', '- https://example.com\n- see https://example.org.'],
    ['a URL in a quote', '> https://example.com\n>\n> said someone'],
    ['a URL in a table', '| Site | Link |\n| --- | --- |\n| Ex | https://example.com |'],
    ['a URL in a task', '- [ ] read https://example.com'],
    ['a URL in a heading', '## Docs at https://example.com'],
    ['a URL in a code span', 'Run `curl https://example.com` now.'],
    ['a URL in a fence', '```\ncurl https://example.com\n```'],
    ['a URL beside a wiki link', '[[Note]] https://example.com [[Other]]'],
  ])('keeps %s as written', (_name, markdown) => {
    expect(save(markdown)).toBe(markdown);
  });

  it('keeps a bare URL bare when the text around it is edited', () => {
    open('See https://example.com for more.');
    editor.commands.setTextSelection(after('for more.'));
    typeInto(' Edited.');
    expect(saveOpen()).toBe('See https://example.com for more. Edited.');
  });

  // TipTap's link mark is inclusive while autolink is on, so text typed at the
  // end of any link joins it.
  it('writes a URL whose link text was typed into as a Markdown link', () => {
    open('See https://example.com now');
    editor.commands.setTextSelection(after('https://example.com'));
    typeInto('abc');
    expect(saveOpen()).toBe('See [https://example.comabc](https://example.com) now');
  });

  it('brackets a URL when a letter is typed right before it', () => {
    open('See https://example.com now');
    editor.commands.setTextSelection(after('See '));
    typeInto('x');
    expect(saveOpen()).toBe('See x<https://example.com> now');
  });

  it('writes a link whose target was changed as a Markdown link', () => {
    open('See https://example.com now');
    editor.commands.setTextSelection({ from: after('See '), to: after('https://example.com') });
    editor.commands.setLink({ href: 'https://other.example' });
    expect(saveOpen()).toBe('See [https://example.com](https://other.example) now');
  });
});

describe('lists and quotes', () => {
  it.each([
    ['a tight list', '- a\n- b\n- c'],
    ['a tight ordered list', '1. one\n2. two\n3. three'],
    ['tight nested lists', '- a\n  - b\n    - c\n  - d\n- e'],
    ['tight nested ordered lists', '1. a\n   1. b\n   2. c\n2. d'],
    ['tasks under a bullet', '- area\n  - [ ] task\n  - [x] done'],
    ['a loose list', '- a\n\n- b\n\n- c'],
    ['a loose list with a nested list', '- a\n\n  - b\n  - c\n\n- d'],
    ['an item with two paragraphs', '- a\n\n  more about a\n\n- b'],
    ['a fence in a tight item', '1. Run:\n   ```sh\n   npm i\n\n   npm test\n   ```\n2. Done'],
    ['a quote in a tight item', '- a\n  > quoted\n- b'],
    ['bullets running into tasks', '- note\n- another\n- [ ] task\n- [x] done\n- back to notes'],
    ['bullets, a blank line, then tasks', '- note\n- another\n\n- [ ] task\n- [ ] more'],
    ['blank lines between some items only', '- a\n- b\n\n- c\n- d'],
    ['an item whose blocks are spaced in a tight run', '- a[^1]\n\n  [^1]: in the item\n- b'],
    ['a blank line in a quote', '> one\n>\n> two'],
    ['a list in a quote', '> - a\n>   - b\n> - c'],
    ['nested quotes with blank lines', '> a\n>\n> > b\n> >\n> > c'],
  ])('keeps %s byte for byte', (_name, markdown) => {
    expect(save(markdown)).toBe(markdown);
  });

  it.each([
    ['a footnote run', 'Text[^1]\n\n[^1]: x\n[^2]: y'],
    ['a details block', '<details>\n<summary>S</summary>\n\nB\n\n</details>'],
    ['bullets and tasks', '- a\n  - b\n- [ ] t\n\n- c'],
    ['bare and bracketed URLs', 'See https://x.com and <https://y.com> (www.z.com).'],
    ['a fence in a tight item', '1. a\n   ```\n   x\n   ```\n2. b'],
  ])('writes %s back the same without the editor too', (_name, markdown) => {
    expect(htmlToMarkdown(markdownToHtml(markdown))).toBe(markdown);
  });

  it('saves a list made in the editor tight', () => {
    open('');
    editor.commands.setContent(
      '<ul><li><p>a</p><ul><li><p>b</p></li></ul></li><li><p>c</p></li></ul>'
    );
    expect(saveOpen()).toBe('- a\n  - b\n- c');
  });

  it('keeps a tight list tight when an item is added', () => {
    open('- a\n- b');
    editor.commands.setTextSelection(after('b'));
    editor.commands.splitListItem('listItem');
    typeInto('c');
    expect(saveOpen()).toBe('- a\n- b\n- c');
  });
});

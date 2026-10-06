/**
 * Every autosave rewrites the whole note from the editor. A block the user did
 * not edit has to come back exactly as the note spelled it, however the editor
 * itself would write it, and an edited block has to keep that spelling
 * wherever the edit did not reach. Each case here is the shape of something
 * real notes contained that a save used to rewrite.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { Editor } from '@tiptap/core';
import { createNoteExtensions } from '@/components/editor/noteExtensions';
import {
  htmlToMarkdown,
  markdownToHtml,
  noteContentToEditorHtml,
  withoutMarkdownSources,
} from './fileSystem';

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

function typeAfter(anchor: string, text: string) {
  editor.commands.setTextSelection(after(anchor));
  typeInto(text);
}

describe('a note saved without edits', () => {
  it.each([
    ['brackets in prose', 'Ask about their [preference] first, then [[Note]] and [x] later.'],
    [
      'underscores inside words and paths',
      'Set internal_only, check wp_navigation and /_jb_static/ paths :waving_hand:.',
    ],
    ['escapes the note wrote', 'Not a heading: \\# one, \\<Name\\>, \\[x\\], 2\\*3 and C:\\Users.'],
    ['a heading that starts with a number', '### 1. Think first\n\n## 2) Then act'],
    ['an ordered list from zero', '0. Zero\n1. One\n2. Two'],
    ['extra spaces after list markers', '-   Item one\n-   Item two\n\n1.  First\n2.  Second'],
    ['star and plus bullets', '* a\n* b\n\n+ c\n+ d'],
    ['an ordered list with parentheses', '1) a\n2) b'],
    ['tasks in a star list', '* [ ] open\n* [x] done'],
    [
      'a hard-wrapped paragraph',
      'A paragraph wrapped\nby hand at a fixed\nwidth, with [brackets].',
    ],
    ['a hard-wrapped list item', '- An item that wraps\n  onto a second line\n- Next'],
    ['two blank lines between blocks', 'One\n\n\nTwo\n\n\n\nThree'],
    ['a list right under its paragraph', 'Intro:\n- a\n- b\n\n## Heading\nText under it'],
    ['separator lines holding whitespace', 'One\n \nTwo\n\t\nThree\n\u00a0\nFour'],
    ['a compact table', '|a|b|\n|---|:-:|\n|1|2|'],
    ['a padded table', '| Name  | Qty |\n|-------|----:|\n| apple |   2 |'],
    [
      'setext headings, starred rules, tilde fences and indented code',
      'Title\n=====\n\nSub\n---\n\n***\n\n~~~js\nx\n~~~\n\n    indented',
    ],
    ['underscore emphasis', '_em_ and __strong__ next to *em* and **strong**'],
    ['a closing hash on a heading', '## Title ##'],
    ['bold and links around code', 'A **`code`** and [`file.php`](https://example.com/f) here.'],
    [
      'links and bare domains inside bold',
      '**[Example](https://example.com) docs** and **To another example.com site**',
    ],
    ['a line break between marks', '*a*\n**b** and [link](https://example.com)\n**c**'],
    ['an inline HTML comment', 'Text <!-- note --> more'],
    ['inline tags the editor has no mark for', 'Press <kbd>Ctrl</kbd> and x<sup>2</sup>.'],
    [
      'an HTML wrapper block',
      '# Project\n\n<div align="center">\n  <img src="https://example.com/logo.png" width="80">\n</div>',
    ],
    ['a custom tag block', '<example>\nHello there.\n</example>\n\nText'],
    ['Obsidian callouts', '> [!note] Title\n> Body with [x] text\n\n> [!warning]-\n> Folded'],
    ['a reference link and its definition', 'See [the docs][docs].\n\n[docs]: https://example.com'],
    ['entities and an escaped one', 'Fish &amp; chips &copy; and a literal \\&amp; one.'],
    ['a Markdown image', '![A photo](images/photo.png)\n\nText'],
    ['strikethrough and tildes', '~~gone~~ and a ~ tilde'],
  ])('keeps %s byte for byte', (_name, markdown) => {
    expect(save(markdown)).toBe(markdown);
  });

  it.each([
    ['an image line that runs on into text', '# Photos\n\n<img src="images/a.png">\nCaption'],
    ['an image inside a paragraph', 'Before ![a](images/a.png) after'],
  ])('never saves %s twice', (_name, markdown) => {
    const saved = save(markdown);
    expect(saved.match(/Caption|Before/g)).toHaveLength(1);
    expect(save(saved)).toBe(saved);
  });

  it('keeps a wiki link inside an inline comment as written', () => {
    expect(save('See [[Note]] <!-- not [[Linked]] -->')).toBe(
      'See [[Note]] <!-- not [[Linked]] -->'
    );
  });

  it('loads the same note to the same HTML every time', () => {
    const markdown = '# Title\n\n* a\n* b';
    expect(markdownToHtml(markdown)).toBe(markdownToHtml(markdown));
  });

  it('keeps the space at a line break between marks in the editor', () => {
    open('*a*\n**b**');
    expect(editor.state.doc.textContent).toBe('a b');
  });
});

describe('an edit keeps the rest of the note as written', () => {
  it('keeps the other lines of a hard-wrapped paragraph', () => {
    open('A paragraph wrapped\nby hand, with [brackets]\nand internal_only.\n\nNext.');
    typeAfter('by hand', ' and edited');
    expect(saveOpen()).toBe(
      'A paragraph wrapped\nby hand and edited, with [brackets]\nand internal_only.\n\nNext.'
    );
  });

  it('keeps the markers and spacing of the other items', () => {
    open('*   one [a]\n*   two\n*   three');
    typeAfter('two', ' more');
    expect(saveOpen()).toBe('*   one [a]\n*   two more\n*   three');
  });

  it('changes only the checkbox of a checked task', () => {
    open('*   [ ] one [a]\n*   [ ] two\n    wrapped\n*   [x] three');
    editor.state.doc.descendants((node, pos) => {
      if (node.type.name === 'taskItem' && node.textContent.startsWith('two')) {
        editor.view.dispatch(
          editor.state.tr.setNodeMarkup(pos, undefined, { ...node.attrs, checked: true })
        );
      }
    });
    expect(saveOpen()).toBe('*   [ ] one [a]\n*   [x] two\n    wrapped\n*   [x] three');
  });

  it("writes a new item with the list's own marker", () => {
    open('* a [b]\n* c');
    editor.commands.setTextSelection(after('c'));
    editor.commands.splitListItem('listItem');
    typeInto('d');
    expect(saveOpen()).toBe('* a [b]\n* c\n* d');
  });

  it('keeps the other rows of an edited table', () => {
    open('| Name  | Qty |\n|-------|----:|\n| apple |   2 |\n| pear  |  10 |');
    typeAfter('pear', 's');
    expect(saveOpen()).toBe('| Name  | Qty |\n|-------|----:|\n| apple |   2 |\n| pears  |  10 |');
  });

  it('keeps bold and links around code the edit did not reach', () => {
    open('A **`code`** and [`file.php`](https://example.com/f) here.');
    typeAfter('here', ' now');
    expect(saveOpen()).toBe('A **`code`** and [`file.php`](https://example.com/f) here now.');
  });

  it('keeps an inline comment beside the edit', () => {
    open('Text <!-- note --> more');
    typeAfter('more', ' words');
    expect(saveOpen()).toBe('Text <!-- note --> more words');
  });

  it('keeps a callout marker when its text is edited', () => {
    open('> [!note] Title\n> Body text');
    typeAfter('Body', ' edited');
    expect(saveOpen()).toBe('> [!note] Title\n> Body edited text');
  });

  it('keeps the blank lines around blocks it did not touch', () => {
    open('One\n\n\nTwo\n\n\n\nThree');
    typeAfter('Two', '!');
    expect(saveOpen()).toBe('One\n\n\nTwo!\n\n\n\nThree');
  });

  it('keeps the lines of a paragraph split in two', () => {
    open('First half [a] second\nhalf [b].\n\nAfter.');
    editor.commands.setTextSelection(after('First half [a]'));
    editor.commands.splitBlock();
    expect(saveOpen()).toBe('First half [a]\n\nsecond\nhalf [b].\n\nAfter.');
  });

  it('keeps a paragraph that a new line was opened above', () => {
    open('Intro\n\nA [wrapped]\nparagraph.');
    editor.commands.setTextSelection(after('Intro'));
    editor.commands.splitBlock();
    typeInto('Added');
    expect(saveOpen()).toBe('Intro\n\nAdded\n\nA [wrapped]\nparagraph.');
  });

  it('writes the edit itself as the editor writes Markdown', () => {
    open('Plain text.');
    editor.commands.setTextSelection(after('Plain text.'));
    editor.commands.insertContent(' A [link](x) and *stars*.');
    expect(saveOpen()).toBe('Plain text. A [link\\](x) and *stars\\*.');
  });
});

describe('escaping text the editor writes', () => {
  it.each([
    ['brackets', '[x] and [[not a link]]', '[x] and [[not a link]\\]'],
    ['a link-shaped text', 'a [b](c)', 'a [b\\](c)'],
    ['underscores inside words', 'snake_case and _jb_static', 'snake_case and _jb_static'],
    ['an underscore pair', '_word_', '_word\\_'],
    ['a number that would start a list', '1. not a list', '1\\. not a list'],
    ['a parenthesised number', '1) not a list', '1\\) not a list'],
    ['a hash that would start a heading', '# not a heading', '\\# not a heading'],
    ['a dash that would start a list', '- not a bullet', '\\- not a bullet'],
    ['a tag-shaped text', 'Hi <Name>', 'Hi \\<Name>'],
    ['an entity-shaped text', 'a &amp; b', 'a \\&amp; b'],
    ['a backslash', 'C:\\Users', 'C:\\Users'],
    ['an asterisk between words', 'a * b and 2*3*4', 'a * b and 2*3\\*4'],
  ])('escapes %s only where it would read back differently', (_name, text, markdown) => {
    const paragraph = document.createElement('p');
    paragraph.textContent = text;
    expect(htmlToMarkdown(paragraph.outerHTML)).toBe(markdown);
  });

  it('escapes a task marker typed at the start of a bullet', () => {
    expect(htmlToMarkdown('<ul><li><p>[ ] not a task</p></li></ul>')).toBe('- [ \\] not a task');
  });
});

describe('HTML that leaves the note', () => {
  it('carries no Markdown sources', () => {
    const html = markdownToHtml('# Title\n\n* a [b]\n\nText');
    expect(html).toContain('data-md-source');
    expect(withoutMarkdownSources(html)).not.toContain('data-md-');
  });
});

describe('pasted HTML', () => {
  it('loses the source it carries, so a save writes what is shown', () => {
    open('Start');
    const pasted =
      '<p data-md-id="x.0" data-md-source="hidden text" data-md-fresh="Shown">Shown</p>';
    let html = pasted;
    editor.view.someProp('transformPastedHTML', (transform) => {
      html = transform(html, editor.view);
    });
    expect(html).not.toContain('data-md-');
    editor.commands.setTextSelection(after('Start'));
    editor.commands.insertContent(html);
    expect(saveOpen()).not.toContain('hidden');
    expect(saveOpen()).toContain('Shown');
  });
});

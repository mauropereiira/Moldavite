/**
 * GFM tables through the Markdown <-> HTML boundary and through TipTap, which
 * is what every autosave actually serialises (issue #146).
 */

import { afterEach, describe, expect, it } from 'vitest';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import TextAlign from '@tiptap/extension-text-align';
import {
  NoteTables,
  insertBlock,
  insertNoteTable,
} from '@/components/editor/extensions/NoteTables';
import { ResizableImage } from '@/components/editor/extensions/ResizableImage';
import { WikiLink } from '@/components/editor/extensions/WikiLink';
import {
  htmlToMarkdown,
  isHtmlContent,
  markdownToHtml,
  noteContentToEditorHtml,
  stripMarkdown,
} from './fileSystem';

const EXTENSIONS = [
  StarterKit,
  TextAlign.configure({ types: ['heading', 'paragraph'] }),
  ResizableImage,
  WikiLink,
  ...NoteTables,
];

let editor: Editor | null = null;

afterEach(() => {
  editor?.destroy();
  editor = null;
});

function throughEditor(markdown: string): string {
  editor?.destroy();
  editor = new Editor({
    extensions: EXTENSIONS,
    content: noteContentToEditorHtml(markdown),
  });
  return htmlToMarkdown(editor.getHTML());
}

function editorWith(html: string): Editor {
  editor?.destroy();
  editor = new Editor({ extensions: EXTENSIONS, content: html });
  return editor;
}

function tableCount(current: Editor): number {
  let count = 0;
  current.state.doc.descendants((node) => {
    if (node.type.name === 'table') count++;
  });
  return count;
}

const SIMPLE = '| a | b |\n| --- | --- |\n| 1 | 2 |';

describe('GFM tables', () => {
  it('survives a round trip instead of flattening into paragraphs', () => {
    expect(htmlToMarkdown(markdownToHtml('| a | b |\n|---|---|\n| 1 | 2 |\n'))).toBe(SIMPLE);
  });

  it('survives the editor, which keeps its header row inside tbody', () => {
    expect(throughEditor(SIMPLE)).toBe(SIMPLE);
  });

  it('keeps inline formatting in cells', () => {
    const markdown = '| **bold** | *em* |\n| --- | --- |\n| `code` | [link](https://example.com) |';
    expect(htmlToMarkdown(markdownToHtml(markdown))).toBe(markdown);
    expect(throughEditor(markdown)).toBe(markdown);
  });

  it('escapes pipes in cell text and inside code spans', () => {
    const markdown = '| a \\| b | `x \\| y` |\n| --- | --- |\n| 1 | 2 |';
    const html = markdownToHtml(markdown);

    expect(html).toContain('a | b');
    expect(html).toContain('<code>x | y</code>');
    expect(htmlToMarkdown(html)).toBe(markdown);
    expect(throughEditor(markdown)).toBe(markdown);
  });

  it('keeps empty cells', () => {
    const markdown = '| a |  |\n| --- | --- |\n|  | 2 |';
    expect(htmlToMarkdown(markdownToHtml(markdown))).toBe(markdown);
    expect(throughEditor(markdown)).toBe(markdown);
  });

  it('keeps column alignment', () => {
    const markdown = '| l | c | r | n |\n| :--- | :---: | ---: | --- |\n| 1 | 2 | 3 | 4 |';
    expect(htmlToMarkdown(markdownToHtml(markdown))).toBe(markdown);
    expect(throughEditor(markdown)).toBe(markdown);
  });

  it('writes line breaks inside a cell as <br> so the row stays on one line', () => {
    editor = new Editor({
      extensions: EXTENSIONS,
      content:
        '<table><tbody><tr><th><p>a</p></th></tr><tr><td><p>one<br>two</p><p>three</p></td></tr></tbody></table>',
    });

    const markdown = htmlToMarkdown(editor.getHTML());
    expect(markdown).toBe('| a |\n| --- |\n| one<br>two<br>three |');
    expect(throughEditor(markdown)).toBe(markdown);
  });

  it('keeps the blocks around a table separate from it', () => {
    const markdown = `# Title\n\n${SIMPLE}\n\nAfter`;
    expect(throughEditor(markdown)).toBe(markdown);
  });

  it('moves between cells with Tab and adds a row past the last cell', () => {
    editor = new Editor({ extensions: EXTENSIONS, content: markdownToHtml(SIMPLE) });
    const view = editor.view;
    const press = (shiftKey = false) =>
      view.someProp('handleKeyDown', (handle) =>
        handle(view, new KeyboardEvent('keydown', { key: 'Tab', shiftKey }))
      );
    const cellText = () => editor?.state.selection.$from.parent.textContent;
    editor.commands.setTextSelection(3);
    expect(cellText()).toBe('a');

    press();
    expect(cellText()).toBe('b');
    press(true);
    expect(cellText()).toBe('a');

    press();
    press();
    press();
    expect(cellText()).toBe('2');
    press();
    expect(htmlToMarkdown(editor.getHTML())).toBe(`${SIMPLE}\n|  |  |`);
  });

  it('is not mistaken for legacy HTML when an aligned paragraph opens the note', () => {
    const markdown = `<p style="text-align: center">Budget</p>\n\n${SIMPLE}`;
    expect(isHtmlContent(markdown)).toBe(false);
    expect(noteContentToEditorHtml(markdown)).toContain('<table>');
    expect(throughEditor(markdown)).toBe(markdown);
  });

  it('writes merged cells out as the grid they cover', () => {
    const html =
      '<table><tr><th colspan="2">A</th><th>B</th></tr>' +
      '<tr><td rowspan="2">x</td><td>y</td><td>z</td></tr>' +
      '<tr><td>p</td><td>q</td></tr></table>';
    const expected = '| A |  | B |\n| --- | --- | --- |\n| x | y | z |\n|  | p | q |';

    expect(htmlToMarkdown(html)).toBe(expected);
    expect(throughEditor(html)).toBe(expected);
  });

  it('sizes the header to the widest row', () => {
    expect(htmlToMarkdown('<table><tr><td>a</td></tr><tr><td>1</td><td>2</td></tr></table>')).toBe(
      '| a |  |\n| --- | --- |\n| 1 | 2 |'
    );
  });

  it('keeps a row that is longer than its header', () => {
    expect(throughEditor('| a | b |\n| --- | --- |\n| 1 | 2 | 3 |')).toBe(
      '| a | b |  |\n| --- | --- | --- |\n| 1 | 2 | 3 |'
    );
  });

  it.each([
    ['[[Target|Alias text]]'],
    ['[[Folder/Deep Note|x]]'],
    ['[[My Note]]'],
    ['[[My Note|the alias]]'],
    ['[[Café Ünïcode|Ålias ÉÈ]]'],
    ['[[MiXeD CaSe|mIxEd AlIaS]]'],
  ])('keeps the wiki link %s byte for byte, in prose and in a cell', (link) => {
    expect(htmlToMarkdown(markdownToHtml(`See ${link} here.`))).toBe(`See ${link} here.`);
    expect(throughEditor(`See ${link} here.`)).toBe(`See ${link} here.`);

    const cell = link.replace('|', '\\|');
    const table = `| ${cell} | b |\n| --- | --- |\n| 1 | 2 |`;
    expect(htmlToMarkdown(markdownToHtml(table))).toBe(table);
    expect(throughEditor(table)).toBe(table);
  });

  it('resolves an aliased link to the text after the pipe, as the backlinks index does', () => {
    expect(markdownToHtml('[[Shown|Target Note]]')).toContain('data-target="target-note.md"');
    expect(markdownToHtml('| [[Shown\\|Target Note]] |\n| --- |')).toContain(
      'data-target="target-note.md"'
    );
  });
});

describe('blocks inside table cells', () => {
  it('flattens blocks from a note or paste into paragraphs without splitting the table', () => {
    const current = editorWith(
      '<table><tr><th><ul><li>x</li><li>y</li></ul></th><th><h2>h</h2><pre><code>a\nb</code></pre></th></tr>' +
        '<tr><td>1</td><td><table><tr><td>n</td></tr></table></td></tr></table>'
    );

    expect(tableCount(current)).toBe(1);
    expect(htmlToMarkdown(current.getHTML())).toBe(
      '| x<br>y | h<br>a<br>b |\n| --- | --- |\n| 1 | n |'
    );
  });

  it('refuses list, heading, code and quote blocks in a cell', () => {
    const current = editorWith(markdownToHtml(SIMPLE));
    current.commands.setTextSelection(3);

    expect(current.commands.toggleHeading({ level: 1 })).toBe(false);
    expect(current.commands.toggleBulletList()).toBe(false);
    expect(current.commands.toggleCodeBlock()).toBe(false);
    expect(current.commands.toggleBlockquote()).toBe(false);
  });

  it('refuses an edit that would split the table around a block', () => {
    const current = editorWith(markdownToHtml(SIMPLE));
    current.commands.setTextSelection(3);

    current.commands.setHorizontalRule();
    current.commands.insertContent('<ul><li>x</li></ul>');

    expect(tableCount(current)).toBe(1);
    expect(htmlToMarkdown(current.getHTML())).toBe(SIMPLE);
  });

  it('puts a divider, table or image inserted from a cell after the table', () => {
    const current = editorWith(markdownToHtml(SIMPLE));
    current.commands.setTextSelection(3);
    insertBlock(current, { type: 'horizontalRule' });
    current.commands.setTextSelection(3);
    current.commands.setImage({ src: 'images/a.png' });
    current.commands.setTextSelection(3);
    insertNoteTable(current);

    const types: string[] = [];
    current.state.doc.forEach((node) => types.push(node.type.name));
    expect(types.slice(0, 4)).toEqual(['table', 'table', 'image', 'horizontalRule']);
    expect(current.state.selection.$from.node(1)).toBe(current.state.doc.child(1));
  });

  it('still lets a reload or an undo add blocks while the cursor is in a table', () => {
    const current = editorWith(`${markdownToHtml(SIMPLE)}<p>one</p><p>two</p>`);
    const afterTable = current.state.doc.child(0).nodeSize;
    current.commands.deleteRange({ from: afterTable, to: current.state.doc.content.size });
    current.commands.setTextSelection(3);
    current.commands.undo();
    expect(current.state.doc.childCount).toBe(3);

    current.commands.setContent(`${markdownToHtml(SIMPLE)}<p>a</p><p>b</p><p>c</p>`);
    expect(current.state.doc.childCount).toBe(4);
  });

  it('degrades pasted blocks to paragraphs in a cell', () => {
    const current = editorWith(markdownToHtml(SIMPLE));
    current.commands.setTextSelection(3);
    current.view.pasteHTML(
      '<h1>H</h1><ul><li>x</li></ul>',
      Object.assign(new Event('paste'), { clipboardData: null }) as unknown as ClipboardEvent
    );

    expect(tableCount(current)).toBe(1);
    expect(htmlToMarkdown(current.getHTML())).toContain('| H<br>xa | b |');
  });
});

describe('tables in plain text', () => {
  it('leaves table-shaped lines alone inside fenced code and without a delimiter row', () => {
    const markdown = '```\n| a | b |\n| --- | --- |\n```\n\nx | y\n\n| 1 | 2 |';
    expect(stripMarkdown(markdown)).toBe('| a | b |\n| --- | --- |\n\nx | y\n\n| 1 | 2 |\n');
  });
});

/**
 * GFM tables through the Markdown <-> HTML boundary and through TipTap, which
 * is what every autosave actually serialises (issue #146).
 */

import { afterEach, describe, expect, it } from 'vitest';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { TableKit } from '@tiptap/extension-table';
import { htmlToMarkdown, markdownToHtml } from './fileSystem';

let editor: Editor | null = null;

afterEach(() => {
  editor?.destroy();
  editor = null;
});

function throughEditor(markdown: string): string {
  editor = new Editor({
    extensions: [StarterKit, TableKit],
    content: markdownToHtml(markdown),
  });
  return htmlToMarkdown(editor.getHTML());
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
      extensions: [StarterKit, TableKit],
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
    editor = new Editor({ extensions: [StarterKit, TableKit], content: markdownToHtml(SIMPLE) });
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
});

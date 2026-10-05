/**
 * Formatting the editor offers has to survive the save, or the next edit
 * anywhere in the note quietly strips it from the file.
 */

import { describe, expect, it } from 'vitest';
import { Editor } from '@tiptap/core';
import { createNoteExtensions } from '@/components/editor/noteExtensions';
import { htmlToMarkdown, noteContentToEditorHtml } from './fileSystem';

function save(markdown: string): string {
  const editor = new Editor({
    extensions: createNoteExtensions(),
    content: noteContentToEditorHtml(markdown),
  });
  try {
    return htmlToMarkdown(editor.getHTML());
  } finally {
    editor.destroy();
  }
}

describe('strikethrough', () => {
  it.each([
    ['a word', 'Old ~~plan~~ new plan'],
    ['inside a task', '- [ ] ~~drop this~~ keep this'],
    ['with other marks', '**bold ~~and struck~~** text'],
    ['in a table cell', '| ~~a~~ | b |\n| --- | --- |\n| 1 | 2 |'],
  ])('keeps %s', (_name, markdown) => {
    expect(save(markdown)).toBe(markdown);
  });

  it.each(['s', 'del', 'strike'])('writes <%s> as ~~', (tag) => {
    expect(htmlToMarkdown(`<p>a <${tag}>b</${tag}> c</p>`)).toBe('a ~~b~~ c');
  });

  it('leaves single tildes alone', () => {
    expect(save('H~2~O and ~/notes')).toBe('H~2~O and ~/notes');
  });
});

describe('task item text that looks like a checkbox', () => {
  it.each([
    ['- [ ] fix arr[x] bug', 'arr[x]'],
    ['- [x] read [ ] docs', 'read [ ] docs'],
    ['- [ ] compare [] and [x]', '[] and [x]'],
  ])('keeps the brackets in %s', (markdown, text) => {
    const saved = save(markdown);
    expect(noteContentToEditorHtml(saved)).toContain(text);
    expect(saved.slice(0, 6)).toBe(markdown.slice(0, 6));
    expect(save(saved)).toBe(saved);
  });
});

describe('headings', () => {
  it('keeps every Markdown heading level', () => {
    const markdown = '# One\n\n## Two\n\n### Three\n\n#### Four\n\n##### Five\n\n###### Six';
    expect(save(markdown)).toBe(markdown);
  });
});

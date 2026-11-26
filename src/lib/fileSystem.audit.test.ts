import { afterEach, describe, expect, it } from 'vitest';
import { Editor } from '@tiptap/core';
import { createNoteExtensions } from '@/components/editor/noteExtensions';
import {
  filenameToNote,
  htmlToMarkdown,
  isHtmlContent,
  noteContentToEditorHtml,
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

function firstTaskParagraphs(): string[] {
  const item = editor.state.doc.firstChild?.firstChild;
  const paragraphs: string[] = [];
  item?.forEach((node) => {
    if (node.type.name === 'paragraph') paragraphs.push(node.textContent);
  });
  return paragraphs;
}

describe('task item paragraphs', () => {
  const markdown = '- [ ] a\n\n  second para\n- [ ] b';

  it('loads a loose task body without an extra empty paragraph', () => {
    open(markdown);
    expect(firstTaskParagraphs()).toEqual(['a', 'second para']);
  });

  it('keeps task body paragraph boundaries after a structural edit', () => {
    open(markdown);
    editor.commands.insertContentAt(2, {
      type: 'paragraph',
      content: [{ type: 'text', text: 'intro' }],
    });
    const saved = htmlToMarkdown(editor.getHTML());
    expect(saved).toBe('- [ ] intro\n\n  a\n\n  second para\n- [ ] b');
    editor.commands.setContent(noteContentToEditorHtml(saved));
    expect(firstTaskParagraphs()).toEqual(['intro', 'a', 'second para']);
  });
});

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

function save(): string {
  return htmlToMarkdown(editor.getHTML());
}

function shape(): unknown {
  type Json = { type: string; attrs?: Record<string, unknown>; content?: Json[]; text?: string };
  const strip = (node: Json): unknown => ({
    type: node.type,
    ...(node.type === 'taskList' ? { start: node.attrs?.start ?? null } : {}),
    ...(node.type === 'taskItem' ? { checked: node.attrs?.checked } : {}),
    ...(node.type === 'text' ? { text: node.text } : {}),
    ...(node.content ? { content: node.content.map(strip) } : {}),
  });
  return strip(editor.getJSON() as Json);
}

describe('numbered to-do lists', () => {
  const cases = [
    ['numbered tasks', '1. [ ] a\n2. [x] b'],
    ['a list that starts later', '3. [ ] a\n4. [x] b'],
    ['parenthesized markers', '3) [ ] a\n4) [X] b'],
    ['tasks mixed with ordinary items', '1. plain\n2. [ ] [[Other]]\n3. last'],
    ['a nested numbered task list', '- outer\n  1. [ ] a\n  2. [x] b'],
    ['a quoted numbered task list', '> 1. [ ] a\n> 2. [x] b'],
    ['a task holding a nested list', '1. [ ] a\n   - inner\n2. [ ] b'],
    ['items with blank lines between', '1. [ ] a\n\n2. [ ] b'],
  ] as const;

  it('loads as checkboxes that know their first number', () => {
    open('3. [ ] a\n4. [x] b');
    expect(shape()).toEqual({
      type: 'doc',
      content: [
        {
          type: 'taskList',
          start: 3,
          content: [
            {
              type: 'taskItem',
              checked: false,
              content: [{ type: 'paragraph', content: [{ type: 'text', text: 'a' }] }],
            },
            {
              type: 'taskItem',
              checked: true,
              content: [{ type: 'paragraph', content: [{ type: 'text', text: 'b' }] }],
            },
          ],
        },
      ],
    });
    const list = editor.view.dom.querySelector('ul[data-type="taskList"]');
    expect(list).toHaveAttribute('start', '3');
    expect((list as HTMLElement).style.counterReset).toBe('task-number 2');
    expect(list?.querySelectorAll('input[type="checkbox"]')).toHaveLength(2);
  });

  it('keeps the first number through the sanitizer every note body crosses', () => {
    const html = noteContentToEditorHtml('3. [ ] a');
    const file = {
      name: 'a.md',
      path: 'notes/a.md',
      isDaily: false,
      isWeekly: false,
      isLocked: false,
    };
    expect(filenameToNote(file, html).content).toContain('start="3"');
  });

  it('leaves an ordinary to-do list without a number', () => {
    open('- [ ] a\n- [x] b');
    expect(editor.state.doc.firstChild?.attrs.start).toBeNull();
    expect(editor.view.dom.querySelector('ul[data-type="taskList"]')).not.toHaveAttribute('start');
    typeInto('!');
    expect(save()).toMatch(/^- \[ \] /);
  });

  it.each(cases)('saves %s as written when nothing in it changed', (_name, tasks) => {
    open(`${tasks}\n\nAfter`);
    expect(save()).toBe(`${tasks}\n\nAfter`);
    editor.commands.insertContentAt(editor.state.doc.content.size - 1, ' edited');
    expect(save()).toBe(`${tasks}\n\nAfter edited`);
  });

  it.each(cases)('keeps the numbers and boxes of %s when an item is edited', (_name, tasks) => {
    open(tasks);
    editor.commands.setTextSelection(after('a'));
    typeInto('Z');
    const saved = save();
    expect(saved).toBe(tasks.replace('a', 'aZ'));
    const edited = shape();
    editor.commands.setContent(noteContentToEditorHtml(saved));
    expect(shape()).toEqual(edited);
  });

  it('ticks a box without touching the numbers', () => {
    open('1. [ ] a\n2. [ ] b');
    const box = editor.view.dom.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')[1];
    box.checked = true;
    box.dispatchEvent(new Event('change'));
    expect(save()).toBe('1. [ ] a\n2. [x] b');
  });

  it('numbers an item added with Enter', () => {
    open('7. [ ] a\n8. [x] b');
    editor.commands.setTextSelection(after('a'));
    editor.commands.splitListItem('taskItem');
    typeInto('new');
    expect(save()).toBe('7. [ ] a\n8. [ ] new\n9. [x] b');
  });

  it('renumbers the items after a to-do added in the middle of a mixed list', () => {
    open('1. plain\n2. [ ] task\n3. last');
    editor.commands.setTextSelection(after('task'));
    editor.commands.splitListItem('taskItem');
    typeInto('more');
    expect(save()).toBe('1. plain\n2. [ ] task\n3. [ ] more\n4. last');
  });

  it('turns a numbered item into a numbered to-do when [ ] is typed at its start', () => {
    open('');
    typeInto('1. ');
    typeInto('[ ] buy milk');
    expect(editor.state.doc.firstChild?.type.name).toBe('taskList');
    expect(editor.state.doc.firstChild?.attrs.start).toBe(1);
    editor.commands.splitListItem('taskItem');
    typeInto('call home');
    expect(save()).toBe('1. [ ] buy milk\n2. [ ] call home');
  });

  it('converts only the item typed in and keeps the numbers around it', () => {
    open('1. one\n2. two\n3. three');
    editor.commands.setTextSelection(after('two') - 3);
    typeInto('[x] ');
    const blocks = (shape() as { content: unknown[] }).content.slice(0, 3);
    expect(blocks).toMatchObject([
      { type: 'orderedList' },
      { type: 'taskList', start: 2, content: [{ type: 'taskItem', checked: true }] },
      { type: 'orderedList' },
    ]);
    expect(save()).toBe('1. one\n2. [x] two\n3. three');
  });

  it('leaves [ ] typed in a bullet or later in a numbered item as text', () => {
    open('1. one');
    editor.commands.setTextSelection(after('one'));
    typeInto(' [ ] ');
    expect(editor.state.doc.firstChild?.type.name).toBe('orderedList');
    open('- one');
    editor.commands.setTextSelection(after('one') - 3);
    typeInto('[ ] ');
    expect(editor.state.doc.firstChild?.type.name).toBe('bulletList');
  });
});

describe('aligned paragraph formatting', () => {
  it.each([
    ['bold', '<strong>Hello</strong>'],
    ['italic', '<em>Hello</em>'],
    ['inline code', '<code>Hello</code>'],
    ['nested marks', '<strong>Hello <em>there</em></strong>'],
  ])('saves %s as HTML inside the alignment wrapper', (_name, inline) => {
    open(`<p>${inline}</p>`);
    editor.commands.selectAll();
    editor.commands.setTextAlign('right');
    const saved = htmlToMarkdown(editor.getHTML());
    expect(saved).toBe(`<p style="text-align: right">${inline}</p>`);
    const before = editor.state.doc.toJSON();
    editor.commands.setContent(noteContentToEditorHtml(saved));
    expect(editor.state.doc.toJSON()).toEqual(before);
  });
});

describe('wiki links in an aligned paragraph', () => {
  it('keeps the bracket spelling that backlinks and renames read', () => {
    open('See [[Alias|Other]] and [[Plain]] today');
    editor.commands.selectAll();
    editor.commands.setTextAlign('center');
    const saved = htmlToMarkdown(editor.getHTML());
    expect(saved).toContain('[[Alias|Other]]');
    expect(saved).toContain('[[Plain]]');
    expect(saved).not.toContain('<wiki-link');
    expect(saved.startsWith('<p style="text-align: center">')).toBe(true);
  });
});

describe('Markdown prose outside HTML blocks', () => {
  it.each(['**bold**', '*italic*', '`code`', '[link](https://example.com)', '[[Other]]'])(
    'classifies %s outside a block as Markdown',
    (prose) => {
      expect(isHtmlContent(`<p style="text-align: center">Intro</p>\n\n${prose}`)).toBe(false);
    }
  );

  it('loads bold and wiki links outside HTML as editor nodes and keeps them after an edit', () => {
    const markdown = '<p style="text-align: center">Intro</p>\n\n**bold** and [[Other]]';
    open(markdown);
    expect(editor.view.dom.querySelector('strong')?.textContent).toBe('bold');
    expect(editor.view.dom.querySelector('[data-wiki-link="true"]')).not.toBeNull();
    editor.commands.insertContentAt(editor.state.doc.content.size - 1, ' edited');
    expect(htmlToMarkdown(editor.getHTML())).toBe(`${markdown} edited`);
  });

  it.each([
    '<p>Literal **stars** and [[brackets]]</p>',
    '<div><p>Literal *stars*</p>\n\n[[brackets]]</div>',
    '<p>Intro</p>\n\nplain text',
  ])('keeps the legacy classification for %s', (html) => {
    expect(isHtmlContent(html)).toBe(true);
  });
});

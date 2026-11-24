import { afterEach, describe, expect, it } from 'vitest';
import { Editor } from '@tiptap/core';
import { createNoteExtensions } from '@/components/editor/noteExtensions';
import { htmlToMarkdown, isHtmlContent, noteContentToEditorHtml } from './fileSystem';

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

describe('ordered task lists', () => {
  it.each([
    ['numbered tasks', '1. [ ] a\n2. [x] b'],
    ['parenthesized markers', '3) [ ] a\n4) [X] b'],
    ['tasks mixed with ordinary items', '1. plain\n2. [ ] [[Other]]\n3. last'],
    ['a nested ordered task list', '- outer\n  1. [ ] a\n  2. [x] b'],
    ['a quoted ordered task list', '> 1. [ ] a\n> 2. [x] b'],
  ])('keeps %s as raw Markdown after an edit elsewhere', (_name, tasks) => {
    open(`${tasks}\n\nAfter`);
    expect(editor.state.doc.firstChild?.type.name).toBe('rawMarkdown');
    expect(editor.state.doc.firstChild?.textContent).toBe(tasks);
    editor.commands.insertContentAt(editor.state.doc.content.size - 1, ' edited');
    expect(htmlToMarkdown(editor.getHTML())).toBe(`${tasks}\n\nAfter edited`);
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

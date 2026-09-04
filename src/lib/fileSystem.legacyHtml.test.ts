/**
 * Legacy HTML detection and editor-bound sanitization tests.
 *
 * A body that is really Markdown must never take the legacy-HTML branch:
 * that branch skips `markdownToHtml`, so the note renders as literal text and
 * the next autosave writes that literal text back escaped. Notes whose first
 * block is an image are the common case — the Turndown image rule emits a raw
 * `<img ...>` tag, so those bodies start with markup.
 */

import { describe, it, expect } from 'vitest';
import {
  isHtmlContent,
  markdownToHtml,
  filenameToNote,
  noteContentToEditorHtml,
} from './fileSystem';
import type { NoteFile } from '@/types';

const noteFile: NoteFile = {
  name: 'photos.md',
  path: 'notes/photos.md',
  isDaily: false,
  isWeekly: false,
  isLocked: false,
};

describe('isHtmlContent', () => {
  it('treats an image-first Markdown note as Markdown', () => {
    const body = '<img src="asset://img/a.png" alt="">\n\n# Heading\n\nSome **bold** text.';
    expect(isHtmlContent(body)).toBe(false);
  });

  it('treats a body that is only an image as Markdown', () => {
    expect(isHtmlContent('<img src="asset://img/a.png" alt="">')).toBe(false);
  });

  it('treats an image followed by a centered paragraph as Markdown', () => {
    // The textAlign Turndown rule emits a raw <p style=...> block into
    // Markdown, so the presence of a closing block tag must not tip the sniff.
    const body =
      '<img src="asset://img/a.png" alt="">\n\n<p style="text-align: center">caption</p>\n\nplain *text*';
    expect(isHtmlContent(body)).toBe(false);
  });

  it('still recognizes a genuine legacy HTML body', () => {
    expect(isHtmlContent('<p>Hello</p><h2>Section</h2><ul><li>one</li></ul>')).toBe(true);
    expect(isHtmlContent('<h1>Title</h1><p>Body</p>')).toBe(true);
    expect(isHtmlContent('<div class="x"><p>attrs on the opener</p></div>')).toBe(true);
  });

  it('rejects markup that never closes a block', () => {
    expect(isHtmlContent('<p>unterminated')).toBe(false);
  });

  it('rejects HTML-looking bodies that carry Markdown block markers', () => {
    expect(isHtmlContent('<p>intro</p>\n\n## Later heading')).toBe(false);
    expect(isHtmlContent('<p>intro</p>\n\n```\ncode\n```')).toBe(false);
    expect(isHtmlContent('<p>intro</p>\n\n1. first')).toBe(false);
  });

  it('returns false for plain Markdown and empty content', () => {
    expect(isHtmlContent('')).toBe(false);
    expect(isHtmlContent('# Just a heading')).toBe(false);
  });
});

describe('markdownToHtml on image-first notes', () => {
  it('renders the Markdown below a leading image instead of leaking it as text', () => {
    const html = markdownToHtml('<img src="asset://img/a.png" alt="">\n\n# Heading\n\n- one');
    expect(html).toContain('<h1>Heading</h1>');
    expect(html).toContain('<li>one</li>');
    expect(html).toContain('img');
  });
});

describe('filenameToNote sanitization', () => {
  it('sanitizes legacy HTML bodies that never pass through markdownToHtml', () => {
    const legacy = '<p>Hello</p><script>alert(1)</script><p onclick="steal()">Bye</p>';
    const note = filenameToNote(noteFile, legacy);
    expect(note.content).not.toContain('<script>');
    expect(note.content).not.toContain('onclick');
    expect(note.content).toContain('<p>Hello</p>');
  });

  it('leaves converted Markdown untouched (sanitizing twice is idempotent)', () => {
    const html = markdownToHtml('# Title\n\n- one\n- [ ] task\n\nSee [[Other Note]].');
    expect(html).toContain('wiki-link');
    expect(filenameToNote(noteFile, html).content).toBe(html);
  });

  it('passes empty content straight through', () => {
    expect(filenameToNote(noteFile, '').content).toBe('');
  });
});

describe('noteContentToEditorHtml', () => {
  it('sanitizes a legacy HTML body, stripping scripts and event handlers', () => {
    const legacy =
      '<p>Hello</p><script>alert(1)</script><img src="x.png" onerror="alert(2)" alt="">';
    const html = noteContentToEditorHtml(legacy);
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('onerror');
    expect(html).toContain('<p>Hello</p>');
    expect(html).toContain('<img');
  });

  it('routes Markdown through markdownToHtml unchanged', () => {
    const markdown = '# Title\n\n- one\n- [ ] task\n\nSee [[Other Note]].';
    expect(noteContentToEditorHtml(markdown)).toBe(markdownToHtml(markdown));
  });
});

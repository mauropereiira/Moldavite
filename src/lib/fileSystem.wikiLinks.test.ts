/**
 * `[[...]]` is a wiki link in prose and plain text in code. Rewriting it inside
 * code put a literal `<wiki-link>` tag into the code block on the next save.
 */

import { describe, expect, it } from 'vitest';
import { Editor } from '@tiptap/core';
import { createNoteExtensions } from '@/components/editor/noteExtensions';
import { htmlToMarkdown, markdownToHtml, noteContentToEditorHtml } from './fileSystem';

function throughEditor(markdown: string): string {
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

function linkTargets(markdown: string): string[] {
  const container = document.createElement('div');
  container.innerHTML = markdownToHtml(markdown);
  return Array.from(container.querySelectorAll('wiki-link')).map(
    (link) => link.getAttribute('data-target') ?? ''
  );
}

describe('wiki links inside code', () => {
  // Tilde and indented blocks are saved as backtick fences, and a soft break
  // in a span as a space, so those are checked by the code they keep.
  it.each([
    ['a backtick fence', '```bash\nif [[ -f "$file" ]]; then echo ok; fi\n```', null],
    [
      'a tilde fence',
      '~~~\nwhile [[ $i -lt 3 ]]; do :; done\n~~~',
      'while [[ $i -lt 3 ]]; do :; done',
    ],
    ['a long fence holding a short one', '````md\n```\n[[Not a link]]\n```\n````', null],
    ['an indented block', 'Shell:\n\n    [[ -d dir ]] && echo yes', '[[ -d dir ]] && echo yes'],
    ['a fence in a list item', '- step\n\n  ```sh\n  [[ -n $x ]]\n  ```', '  [[ -n $x ]]'],
    ['a fence in a quote', '> ```\n> [[quoted code]]\n> ```', null],
    ['an inline span', 'Run `[[ -n $x ]]` first', null],
    ['a double-backtick span holding a backtick', 'Try ``a ` [[b]]`` now', null],
    ['a span across a soft break', 'Start `[[one\ntwo]]` end', '`[[one two]]`'],
    ['a span in a heading', '## The `[[x]]` test', null],
    ['a span in a table cell', '| `[[a]]` | b |\n| --- | --- |\n| 1 | 2 |', null],
  ])('keeps %s as written', (_name, markdown, code) => {
    expect(linkTargets(markdown)).toEqual([]);
    const saved = throughEditor(markdown);
    if (code === null) {
      expect(htmlToMarkdown(markdownToHtml(markdown))).toBe(markdown);
      expect(saved).toBe(markdown);
    } else {
      expect(saved).toContain(code);
      expect(saved).not.toContain('wiki-link');
      expect(throughEditor(saved)).toBe(saved);
    }
  });

  it('keeps everything after an unclosed fence as code', () => {
    const markdown = 'Intro [[Real]]\n\n```\n[[ -f x ]]\nstill code [[y]]';
    expect(linkTargets(markdown)).toEqual(['real.md']);
    expect(markdownToHtml(markdown)).not.toContain('&lt;wiki-link');
  });

  it.each([
    ['prose', 'See [[My Note]] here.', ['my-note.md']],
    ['an alias', 'See [[Shown|Target Note]].', ['target-note.md']],
    ['prose around a span', '`code` then [[A]] and `more` [[B]]', ['a.md', 'b.md']],
    ['an unclosed backtick', 'A stray ` then [[A]]', ['a.md']],
    ['an escaped backtick', 'Not code \\` [[A]] \\`', ['a.md']],
    ['a backtick run that never closes at its length', '``x` [[A]]', ['a.md']],
    ['a line after a fence', '```\ncode\n```\n[[After]]', ['after.md']],
    ['a nested list item', '- item\n\n    - nested [[Deep]]', ['deep.md']],
    ['a task item', '- [ ] call [[Bob]]', ['bob.md']],
    ['a quote', '> see [[Quoted]]', ['quoted.md']],
    ['a cell beside a code span', '| `x` | [[A\\|B]] |\n| --- | --- |', ['b.md']],
    ['a heading', '# About [[Topic]]', ['topic.md']],
  ])('still converts a link in %s', (_name, markdown, targets) => {
    expect(linkTargets(markdown)).toEqual(targets);
    const saved = throughEditor(markdown);
    expect(linkTargets(saved)).toEqual(targets);
    expect(throughEditor(saved)).toBe(saved);
  });

  it('handles Windows and old Mac line endings', () => {
    expect(linkTargets('```\r\n[[x]]\r\n```\r\n[[Y]]')).toEqual(['y.md']);
    expect(linkTargets('```\r[[x]]\r```\r[[Y]]')).toEqual(['y.md']);
  });
});

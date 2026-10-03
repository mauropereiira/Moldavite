import { Editor } from '@tiptap/core';
import { describe, expect, it, vi } from 'vitest';
import { createNoteExtensions } from './noteExtensions';

describe('shared note extensions', () => {
  it('toggles highlighting with the shared keyboard shortcut', () => {
    const editor = new Editor({
      extensions: createNoteExtensions(),
      content: '<p>Highlight me</p>',
    });
    try {
      editor.commands.setTextSelection({ from: 1, to: 10 });
      editor.commands.keyboardShortcut('Mod-Shift-h');
      expect(editor.getHTML()).toBe('<p><mark>Highlight</mark> me</p>');
      editor.commands.keyboardShortcut('Mod-Shift-h');
      expect(editor.getHTML()).toBe('<p>Highlight me</p>');
    } finally {
      editor.destroy();
    }
  });

  it('delivers wiki link and tag clicks to the configured handlers', () => {
    const onLinkClick = vi.fn();
    const onTagClick = vi.fn();
    const editor = new Editor({
      extensions: createNoteExtensions(true, {
        wikiLink: { onLinkClick },
        tagMark: { onTagClick },
      }),
      content:
        '<p><wiki-link data-target="Other.md" data-label="Other">Other</wiki-link> #project</p>',
    });
    try {
      const wikiLink = editor.view.dom.querySelector('wiki-link');
      const tag = editor.view.dom.querySelector('.tag-mark');
      expect(wikiLink).not.toBeNull();
      expect(tag).not.toBeNull();
      wikiLink?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      tag?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      expect(onLinkClick).toHaveBeenCalledWith('Other.md', 'Other');
      expect(onTagClick).toHaveBeenCalledWith('project');
    } finally {
      editor.destroy();
    }
  });
});

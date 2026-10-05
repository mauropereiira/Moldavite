import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { NoteTables } from './extensions/NoteTables';
import { SlashCommands } from './extensions/SlashCommands';
import { WritingToolbar } from './WritingToolbar';

let editor: Editor;
let paper: HTMLDivElement;

// jsdom has no layout, and focusing scrolls the caret into view by measuring it.
beforeAll(() => {
  Object.defineProperties(window.Range.prototype, {
    getClientRects: { configurable: true, value: () => [] },
    getBoundingClientRect: { configurable: true, value: () => new DOMRect() },
  });
});

afterAll(() => {
  Reflect.deleteProperty(window.Range.prototype, 'getClientRects');
  Reflect.deleteProperty(window.Range.prototype, 'getBoundingClientRect');
});

afterEach(() => {
  editor?.destroy();
  paper?.remove();
});

/** A real editor inside an `.editor-paper`, as Editor.tsx renders it. */
function setup(content: string, caret?: number) {
  paper = document.createElement('div');
  paper.className = 'editor-paper';
  document.body.appendChild(paper);
  editor = new Editor({
    element: paper,
    extensions: [
      StarterKit,
      TaskList,
      TaskItem,
      ...NoteTables,
      SlashCommands.configure({
        suggestion: { char: '/', startOfLine: true, items: () => [] },
      }),
    ],
    content,
    // jsdom only focuses a contenteditable that is also tabbable.
    editorProps: { attributes: { tabindex: '0' } },
  });
  const onInsertLink = vi.fn();
  render(<WritingToolbar editor={editor} onInsertLink={onInsertLink} />, {
    container: paper.appendChild(document.createElement('div')),
  });
  act(() => {
    editor.commands.setTextSelection(caret ?? editor.state.doc.content.size - 1);
    // TipTap's focus command waits a frame; the DOM focus is what it ends in.
    editor.view.dom.focus();
  });
  return { onInsertLink };
}

const toolbar = () => screen.queryByRole('toolbar', { name: 'Formatting' });
const plus = () => screen.queryByRole('button', { name: 'Insert a block' });
const type = (key: string, init: { altKey?: boolean } = {}) =>
  act(() => {
    editor.view.dom.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, ...init }));
  });

describe('WritingToolbar', () => {
  it('shows above the block the caret is in, with + in the gutter', () => {
    setup('<p>Hello</p>');
    const bar = toolbar();
    expect(bar).not.toBeNull();
    expect(
      within(bar as HTMLElement)
        .getAllByRole('button')
        .map((button) => button.getAttribute('aria-label'))
    ).toEqual([
      'Block type: Text',
      'Bold (Ctrl+B)',
      'Italic (Ctrl+I)',
      'Underline (Ctrl+U)',
      'Strikethrough',
      'Link (Ctrl+K)',
    ]);
    expect(plus()).not.toBeNull();
  });

  it('is gone while the editor does not have the focus', () => {
    setup('<p>Hello</p>');
    act(() => {
      editor.view.dom.blur();
    });
    expect(toolbar()).toBeNull();
    expect(plus()).toBeNull();
  });

  // The WordPress editor's rule: out of the way while writing, back when the
  // writer reaches for the mouse or moves the caret.
  it('steps aside while you type and comes back on a mouse move or caret move', () => {
    setup('<p>Hello</p>');
    type('a');
    expect(toolbar()).toBeNull();
    expect(plus()).toBeNull();
    type('Shift');
    expect(toolbar()).toBeNull();

    fireEvent.mouseMove(window);
    expect(toolbar()).not.toBeNull();

    type('b');
    type('ArrowLeft');
    expect(toolbar()).not.toBeNull();
  });

  it('keeps + on an empty line while you type', () => {
    setup('<p>Hello</p><p></p>');
    type('Enter');
    expect(toolbar()).toBeNull();
    expect(plus()).not.toBeNull();
  });

  it('leaves a selection to the selection toolbar', () => {
    setup('<p>Hello world</p>');
    act(() => {
      editor.commands.setTextSelection({ from: 1, to: 6 });
    });
    expect(toolbar()).toBeNull();
    expect(plus()).toBeNull();
  });

  it('stays out of tables, which have their own controls', () => {
    setup(
      '<table><tbody><tr><th><p>A</p></th></tr><tr><td><p>B</p></td></tr></tbody></table><p>x</p>',
      3
    );
    expect(editor.isActive('table')).toBe(true);
    expect(toolbar()).toBeNull();
  });

  it('turns the block into a heading, a list and back to text', () => {
    // A closing paragraph keeps StarterKit's trailing node out of the HTML.
    setup('<p>Hello</p><p>end</p>', 3);
    const choose = (label: string) => {
      fireEvent.click(screen.getByRole('button', { name: /^Block type:/ }));
      fireEvent.click(screen.getByRole('menuitem', { name: label }));
    };

    choose('Heading 2');
    expect(editor.getHTML()).toBe('<h2>Hello</h2><p>end</p>');
    expect(screen.getByRole('button', { name: 'Block type: Heading 2' })).toBeInTheDocument();

    choose('Bullet list');
    expect(editor.getHTML()).toBe('<ul><li><p>Hello</p></li></ul><p>end</p>');

    choose('Task list');
    expect(editor.isActive('taskList')).toBe(true);
    expect(editor.isActive('bulletList')).toBe(false);

    choose('Text');
    expect(editor.getHTML()).toBe('<p>Hello</p><p>end</p>');
  });

  it('applies inline styles to the word being written and opens the link dialog', () => {
    const { onInsertLink } = setup('<p>Hello</p>');
    fireEvent.click(screen.getByRole('button', { name: /^Bold/ }));
    act(() => {
      editor.commands.insertContent('!');
    });
    expect(editor.getHTML()).toBe('<p>Hello<strong>!</strong></p>');
    expect(screen.getByRole('button', { name: /^Bold/ })).toHaveAttribute('aria-pressed', 'true');

    fireEvent.click(screen.getByRole('button', { name: /^Link/ }));
    expect(onInsertLink).toHaveBeenCalledTimes(1);
  });

  it('opens the slash menu on an empty line with +', () => {
    setup('<p>Hello</p><p></p>');
    fireEvent.click(plus() as HTMLElement);
    expect(editor.getHTML()).toBe('<p>Hello</p><p>/</p>');
    expect(editor.state.selection.$from.parent.textContent).toBe('/');
  });

  it('adds a line after the whole block for + on a line with text', () => {
    setup('<ul><li><p>one</p></li><li><p>two</p></li></ul><p>after</p>', 4);
    fireEvent.click(plus() as HTMLElement);
    expect(editor.getHTML()).toBe(
      '<ul><li><p>one</p></li><li><p>two</p></li></ul><p>/</p><p>after</p>'
    );
  });

  it('takes the focus with Alt+F10 and gives it back with Escape', async () => {
    setup('<p>Hello</p>');
    type('F10', { altKey: true });
    await act(() => new Promise((resolve) => requestAnimationFrame(resolve)));
    expect(screen.getByRole('button', { name: 'Block type: Text' })).toHaveFocus();
    expect(toolbar()).not.toBeNull();

    fireEvent.keyDown(document.activeElement as Element, { key: 'Escape' });
    // TipTap focuses on the next frame.
    await act(() => new Promise((resolve) => requestAnimationFrame(resolve)));
    expect(editor.isFocused).toBe(true);
  });
});

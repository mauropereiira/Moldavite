import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import { NoteTables } from './extensions/NoteTables';
import { ResizableImage } from './extensions/ResizableImage';
import { NodeSelection } from '@tiptap/pm/state';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MobileFormattingBar } from './MobileFormattingBar';

let editor: Editor;
afterEach(() => editor?.destroy());

function setup(content = '<p>Selected words</p>') {
  editor = new Editor({
    extensions: [StarterKit, TaskList, TaskItem, ...NoteTables, ResizableImage],
    content,
  });
  const onInsertLink = vi.fn();
  const onInsertImage = vi.fn();
  render(
    <MobileFormattingBar
      editor={editor}
      onInsertLink={onInsertLink}
      onInsertImage={onInsertImage}
    />
  );
  return { onInsertLink, onInsertImage };
}

describe('mobile formatting', () => {
  it('formats the current selection and exposes the pressed state', () => {
    setup();
    act(() => {
      editor.commands.setTextSelection({ from: 1, to: 9 });
    });
    fireEvent.click(screen.getByRole('button', { name: 'Format' }));
    const button = screen.getByRole('button', { name: 'Bold' });
    fireEvent.pointerDown(button);
    fireEvent.click(button);
    expect(editor.getHTML()).toBe('<p><strong>Selected</strong> words</p>');
    expect(button).toHaveAttribute('aria-pressed', 'true');
  });

  it('keeps the touch target present when focus leaves the editor before click', () => {
    setup();
    act(() => {
      editor.emit('focus', {
        editor,
        event: new window.FocusEvent('focus'),
        transaction: editor.state.tr,
      });
      editor.emit('blur', {
        editor,
        event: new window.FocusEvent('blur'),
        transaction: editor.state.tr,
      });
    });
    expect(screen.getByRole('toolbar')).toHaveAttribute('data-editing', 'true');
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss keyboard' }));
    expect(screen.getByRole('toolbar')).toHaveAttribute('data-editing', 'false');
  });

  it('stops editing when another note opens', () => {
    editor = new Editor({ extensions: [StarterKit], content: '<p>Body</p>' });
    const props = { editor, onInsertLink: vi.fn(), onInsertImage: vi.fn() };
    const { rerender } = render(<MobileFormattingBar {...props} noteId="notes/a.md" />);
    act(() => {
      editor.emit('focus', {
        editor,
        event: new window.FocusEvent('focus'),
        transaction: editor.state.tr,
      });
    });
    expect(screen.getByRole('toolbar')).toHaveAttribute('data-editing', 'true');

    rerender(<MobileFormattingBar {...props} noteId="notes/b.md" />);

    expect(screen.getByRole('toolbar')).toHaveAttribute('data-editing', 'false');
  });

  it('creates a task list with the real editor command', () => {
    setup();
    fireEvent.click(screen.getByRole('button', { name: 'Format' }));
    fireEvent.click(screen.getByRole('button', { name: 'Task list' }));
    expect(editor.isActive('taskList')).toBe(true);
    expect(editor.getText().trim()).toBe('Selected words');
  });

  it('inserts a table with a header row', () => {
    setup();
    fireEvent.click(screen.getByRole('button', { name: 'Insert' }));
    fireEvent.click(screen.getByRole('button', { name: 'Table' }));
    expect(editor.isActive('table')).toBe(true);
    expect(editor.getHTML()).toContain('<th');
  });

  it('disables Table while the caret is in a table, so repeated taps add one table', () => {
    setup();
    fireEvent.click(screen.getByRole('button', { name: 'Insert' }));
    const table = screen.getByRole('button', { name: 'Table' });
    expect(table).not.toBeDisabled();

    fireEvent.click(table);
    fireEvent.click(table);

    expect(table).toBeDisabled();
    expect(editor.view.dom.querySelectorAll('table')).toHaveLength(1);
  });

  it('opens the existing link and photo dialogs and dismisses editing', async () => {
    const callbacks = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Insert' }));
    fireEvent.click(screen.getByRole('button', { name: 'Link' }));
    fireEvent.click(screen.getByRole('button', { name: 'Image' }));
    expect(callbacks.onInsertLink).toHaveBeenCalledOnce();
    expect(callbacks.onInsertImage).toHaveBeenCalledOnce();
    const blur = vi.spyOn(editor.view.dom, 'blur');
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss keyboard' }));
    await waitFor(() => expect(blur).toHaveBeenCalledOnce());
  });

  it('names the wiki link and tag inserts by what they do', () => {
    setup();
    fireEvent.click(screen.getByRole('button', { name: 'Insert' }));
    expect(screen.getByRole('button', { name: 'Link to a note' })).toHaveTextContent('[[Note]]');
    expect(screen.getByRole('button', { name: 'Tag' })).toHaveTextContent('#Tag');
    fireEvent.click(screen.getByRole('button', { name: 'Link to a note' }));
    expect(editor.getText()).toContain('[[');
  });

  it('leads with table actions while the caret is in a table', () => {
    setup();
    fireEvent.click(screen.getByRole('button', { name: 'Insert' }));
    expect(screen.queryByRole('button', { name: 'Add row' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Table' }));

    const buttons = screen
      .getAllByRole('button')
      .map((button) => button.getAttribute('aria-label') ?? button.textContent);
    expect(buttons.slice(0, 5)).toEqual([
      'Add row',
      'Add column',
      'Delete row',
      'Delete column',
      'Delete table',
    ]);
    fireEvent.click(screen.getByRole('button', { name: 'Format' }));
    expect(screen.getByRole('button', { name: 'Heading' })).toBeDisabled();
    // Table actions lead the styles row too.
    expect(screen.getByRole('button', { name: 'Add row' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Add row' }));
    expect(editor.view.dom.querySelectorAll('tr')).toHaveLength(4);
    fireEvent.click(screen.getByRole('button', { name: 'Add column' }));
    expect(editor.view.dom.querySelectorAll('tr:first-child > *')).toHaveLength(4);
    fireEvent.click(screen.getByRole('button', { name: 'Delete row' }));
    expect(editor.view.dom.querySelectorAll('tr')).toHaveLength(3);
    fireEvent.click(screen.getByRole('button', { name: 'Delete column' }));
    expect(editor.view.dom.querySelectorAll('tr:first-child > *')).toHaveLength(3);
    fireEvent.click(screen.getByRole('button', { name: 'Delete table' }));
    expect(editor.view.dom.querySelector('table')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Add row' })).toBeNull();
  });

  it('leads with image actions while an image is selected', () => {
    setup('<p>Before</p><img src="images/a.png"><p>After</p>');
    act(() => {
      let imagePos = -1;
      editor.state.doc.descendants((node, pos) => {
        if (node.type.name === 'image') imagePos = pos;
      });
      editor.view.dispatch(
        editor.state.tr.setSelection(NodeSelection.create(editor.state.doc, imagePos))
      );
    });

    const centre = screen.getByRole('button', { name: 'Align image centre' });
    expect(centre).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByRole('button', { name: 'Align image right' }));
    expect(editor.getAttributes('image').alignment).toBe('right');
    expect(screen.getByRole('button', { name: 'Align image right' })).toHaveAttribute(
      'aria-pressed',
      'true'
    );

    fireEvent.click(screen.getByRole('button', { name: 'Delete image' }));
    expect(editor.view.dom.querySelector('img')).toBeNull();
  });

  it('marks the sides of the row that have more controls to scroll to', () => {
    const width = vi.spyOn(HTMLElement.prototype, 'scrollWidth', 'get').mockReturnValue(600);
    const client = vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(300);
    try {
      setup();
      fireEvent.click(screen.getByRole('button', { name: 'Insert' }));
      const row = screen.getByRole('toolbar').querySelector('.mobile-formatting-scroll');
      if (!(row instanceof HTMLElement)) throw new Error('No scrolling row');
      expect(row).toHaveAttribute('data-more-after', 'true');
      expect(row).toHaveAttribute('data-more-before', 'false');

      row.scrollLeft = 300;
      fireEvent.scroll(row);
      expect(row).toHaveAttribute('data-more-after', 'false');
      expect(row).toHaveAttribute('data-more-before', 'true');
    } finally {
      width.mockRestore();
      client.mockRestore();
    }
  });

  // Undo and Redo were last in a scrolling row, and Aa said nothing to anyone
  // who had not used Apple Notes. The row is now short enough never to scroll.
  it('keeps Undo, Redo, Format, Insert and Done in one row that never scrolls', () => {
    setup();
    const main = screen.getByRole('toolbar').querySelector('.mobile-formatting-main');
    expect(
      Array.from(main?.querySelectorAll('button') ?? []).map(
        (button) => button.getAttribute('aria-label') ?? button.textContent
      )
    ).toEqual(['Undo', 'Redo', 'Format', 'Insert', 'Dismiss keyboard']);
    expect(screen.getByRole('toolbar').querySelector('.mobile-formatting-scroll')).toBeNull();

    expect(screen.getByRole('button', { name: 'Undo' })).toBeDisabled();
    act(() => {
      editor.commands.setTextSelection({ from: 1, to: 9 });
      editor.commands.toggleBold();
    });
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(editor.getHTML()).toBe('<p>Selected words</p>');
    fireEvent.click(screen.getByRole('button', { name: 'Redo' }));
    expect(editor.getHTML()).toBe('<p><strong>Selected</strong> words</p>');
  });

  it('opens Format or Insert in a strip, one at a time, and closes it on Done', () => {
    setup();
    const format = screen.getByRole('button', { name: 'Format' });
    const insert = screen.getByRole('button', { name: 'Insert' });

    fireEvent.click(format);
    expect(format).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('group', { name: 'Format' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Bold' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Link to a note' })).toBeNull();

    fireEvent.click(insert);
    expect(format).toHaveAttribute('aria-expanded', 'false');
    expect(insert).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('button', { name: 'Link to a note' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Bold' })).toBeNull();

    fireEvent.click(insert);
    expect(screen.queryByRole('group', { name: 'Insert' })).toBeNull();

    fireEvent.click(format);
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss keyboard' }));
    expect(format).toHaveAttribute('aria-expanded', 'false');
  });
});

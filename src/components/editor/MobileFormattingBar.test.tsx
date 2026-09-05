import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MobileFormattingBar } from './MobileFormattingBar';

let editor: Editor;
afterEach(() => editor?.destroy());

function setup() {
  editor = new Editor({
    extensions: [StarterKit, TaskList, TaskItem],
    content: '<p>Selected words</p>',
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

  it('creates a task list with the real editor command', () => {
    setup();
    fireEvent.click(screen.getByRole('button', { name: 'Task list' }));
    expect(editor.isActive('taskList')).toBe(true);
    expect(editor.getText().trim()).toBe('Selected words');
  });

  it('opens the existing link and photo dialogs and dismisses editing', async () => {
    const callbacks = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Link' }));
    fireEvent.click(screen.getByRole('button', { name: 'Image' }));
    expect(callbacks.onInsertLink).toHaveBeenCalledOnce();
    expect(callbacks.onInsertImage).toHaveBeenCalledOnce();
    const blur = vi.spyOn(editor.view.dom, 'blur');
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss keyboard' }));
    await waitFor(() => expect(blur).toHaveBeenCalledOnce());
  });
});

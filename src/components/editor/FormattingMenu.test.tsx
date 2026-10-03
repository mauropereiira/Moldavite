import { act, fireEvent, render, screen } from '@testing-library/react';
import { Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Link from '@tiptap/extension-link';
import { afterEach, describe, expect, it } from 'vitest';
import { NoteTables } from './extensions/NoteTables';
import { FormattingMenu } from './FormattingMenu';

let editor: Editor;
afterEach(() => editor?.destroy());

function tableItem(): HTMLElement {
  fireEvent.click(screen.getByRole('button', { name: 'Formatting' }));
  const item = screen.getAllByRole('menuitem').find((menuItem) => menuItem.textContent === 'Table');
  if (!item) throw new Error('No Table item');
  return item;
}

describe('Format menu Table item', () => {
  it('inserts a table outside one and is disabled inside one', () => {
    editor = new Editor({ extensions: [StarterKit, ...NoteTables], content: '<p></p>' });
    render(<FormattingMenu editor={editor} />);

    fireEvent.click(tableItem());
    expect(editor.isActive('table')).toBe(true);

    const item = tableItem();
    expect(item).toBeDisabled();
    act(() => item.click());
    expect(editor.view.dom.querySelectorAll('table')).toHaveLength(1);
  });
});

describe('Format menu Link item', () => {
  it('edits the link under the caret', () => {
    editor = new Editor({
      extensions: [StarterKit.configure({ link: false }), Link],
      content: '<p>See <a href="https://old.example">the docs</a> now</p>',
    });
    editor.commands.setTextSelection(8);
    render(<FormattingMenu editor={editor} />);

    fireEvent.click(screen.getByRole('button', { name: 'Formatting' }));
    const item = screen
      .getAllByRole('menuitem')
      .find((menuItem) => menuItem.textContent?.startsWith('Link'));
    if (!item) throw new Error('No Link item');
    fireEvent.click(item);
    const url = screen.getByLabelText(/URL/);
    expect(url).toHaveValue('https://old.example');
    expect(screen.getByLabelText(/Display Text/)).toHaveValue('the docs');
    fireEvent.change(url, { target: { value: 'https://new.example' } });
    fireEvent.click(screen.getByRole('button', { name: 'Update Link' }));

    expect(editor.getText()).toBe('See the docs now');
    const links = editor.view.dom.querySelectorAll('a');
    expect(links).toHaveLength(1);
    expect(links[0]).toHaveAttribute('href', 'https://new.example');
  });
});

describe('Format menu Image item', () => {
  // An inserted image is saved into the Forge's images/, which a file
  // outside the Forge cannot reach.
  it('is left out for a file outside the Forge', () => {
    editor = new Editor({ extensions: [StarterKit], content: '<p></p>' });
    render(<FormattingMenu editor={editor} allowImages={false} />);

    fireEvent.click(screen.getByRole('button', { name: 'Formatting' }));
    const labels = screen.getAllByRole('menuitem').map((item) => item.textContent);
    expect(labels).not.toContain('Image');
    expect(labels).toContain('Table');
  });
});

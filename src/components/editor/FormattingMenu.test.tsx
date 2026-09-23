import { act, fireEvent, render, screen } from '@testing-library/react';
import { Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
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

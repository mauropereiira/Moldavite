import { act, render, waitFor } from '@testing-library/react';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { EditorContent, useEditor, type Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { SelectionToolbar } from './SelectionToolbar';

// Editor's layout: a note switch inserts the new note-keyed body before the toolbar.
function Harness({ noteId, onEditor }: { noteId: string; onEditor: (e: Editor) => void }) {
  const editor = useEditor({
    extensions: [StarterKit],
    content: '<p>hello world</p>',
    onCreate: ({ editor: created }) => onEditor(created),
  });
  return (
    <div>
      <div key={noteId}>
        <EditorContent editor={editor} />
      </div>
      {editor && <SelectionToolbar editor={editor} onInsertLink={() => {}} />}
    </div>
  );
}

// jsdom has no layout, and the menu's positioning measures the selection.
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

describe('SelectionToolbar', () => {
  it('survives a note switch after it has been shown', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const onEditor = vi.fn<(editor: Editor) => void>();
    const { rerender } = render(<Harness noteId="a" onEditor={onEditor} />);
    await waitFor(() => expect(onEditor).toHaveBeenCalled());
    const [editor] = onEditor.mock.calls[0];

    act(() => {
      editor.commands.focus();
      editor.commands.setTextSelection({ from: 1, to: 6 });
    });
    await waitFor(() =>
      expect(document.querySelector('.selection-toolbar-visible')).not.toBeNull()
    );

    expect(() => {
      rerender(<Harness noteId="b" onEditor={onEditor} />);
      rerender(<Harness noteId="c" onEditor={onEditor} />);
    }).not.toThrow();
    expect(errors.mock.calls.flat().join(' ')).not.toMatch(/NotFoundError|not a child/);
    errors.mockRestore();
  });
});

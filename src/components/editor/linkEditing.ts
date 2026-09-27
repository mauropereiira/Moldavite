import { getMarkRange, type Editor } from '@tiptap/core';

function caretLinkRange(editor: Editor) {
  const { selection, schema } = editor.state;
  if (!selection.empty || !editor.isActive('link')) return null;
  return getMarkRange(selection.$from, schema.marks.link) ?? null;
}

export function linkDialogValues(editor: Editor): { url: string; text: string } {
  const url = editor.getAttributes('link').href || '';
  const { from, to } = editor.state.selection;
  const range = caretLinkRange(editor) ?? { from, to };
  return { url, text: editor.state.doc.textBetween(range.from, range.to) };
}

const linkedText = (url: string, text: string) => ({
  type: 'text',
  marks: [{ type: 'link', attrs: { href: url } }],
  text,
});

export function applyLink(editor: Editor, url: string, text?: string): void {
  const range = caretLinkRange(editor);

  if (range) {
    const current = editor.state.doc.textBetween(range.from, range.to);
    if (text && text !== current) {
      editor.chain().focus().insertContentAt(range, linkedText(url, text)).run();
    } else {
      editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run();
    }
  } else if (!editor.state.selection.empty) {
    editor.chain().focus().setLink({ href: url }).run();
  } else {
    editor
      .chain()
      .focus()
      .insertContent(linkedText(url, text || url))
      .run();
  }
}

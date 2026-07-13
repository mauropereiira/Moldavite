/**
 * Imperative handle to the currently mounted TipTap editor.
 * Exactly one editor instance may be published; consumers must tolerate `null`
 * during mount transitions and must not retain an old handle after it is cleared.
 */

import type { Editor } from '@tiptap/react';

/**
 * A module-level handle to the live TipTap editor, published by the Editor
 * component on mount. Plugins reach the editor through this rather than
 * importing the component, and it is null-safe when no editor is mounted.
 */
let current: Editor | null = null;

export const editorHandle = {
  setEditor(editor: Editor | null) {
    current = editor;
  },
  getEditor(): Editor | null {
    return current && !current.isDestroyed ? current : null;
  },
  insertTextAtCursor(text: string): boolean {
    const ed = current && !current.isDestroyed ? current : null;
    if (!ed) return false;
    ed.chain().focus().insertContent(text).run();
    return true;
  },
};

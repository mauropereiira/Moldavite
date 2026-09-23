import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Editor } from '@tiptap/react';
import { editorHandle } from './editorHandleStore';

function fakeEditor(isEditable: boolean) {
  const run = vi.fn(() => true);
  const chain = { focus: () => chain, insertContent: vi.fn(() => chain), run };
  return {
    editor: { isDestroyed: false, isEditable, chain: () => chain } as unknown as Editor,
    chain,
  };
}

afterEach(() => editorHandle.setEditor(null));

describe('editorHandle.insertTextAtCursor', () => {
  it('inserts into an editable note', () => {
    const { editor, chain } = fakeEditor(true);
    editorHandle.setEditor(editor);

    expect(editorHandle.insertTextAtCursor('hi')).toBe(true);
    expect(chain.insertContent).toHaveBeenCalledWith('hi');
  });

  it('refuses a locked note open for viewing', () => {
    const { editor, chain } = fakeEditor(false);
    editorHandle.setEditor(editor);

    expect(editorHandle.insertTextAtCursor('hi')).toBe(false);
    expect(chain.insertContent).not.toHaveBeenCalled();
  });
});

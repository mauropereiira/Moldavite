/**
 * The kinds of block the toolbars can turn the current one into. Converting
 * clears the block back to a paragraph first, so a list item becomes a heading
 * rather than a heading inside a list.
 */

import type { Editor } from '@tiptap/react';

export interface BlockType {
  id: string;
  label: string;
  isActive: (editor: Editor) => boolean;
  apply: (editor: Editor) => void;
}

const heading = (level: 1 | 2 | 3): BlockType => ({
  id: `h${level}`,
  label: `Heading ${level}`,
  isActive: (editor) => editor.isActive('heading', { level }),
  apply: (editor) => editor.chain().focus().clearNodes().setHeading({ level }).run(),
});

/** Most specific first: a task list is also a list, and anything can sit in a quote. */
export const BLOCK_TYPES: BlockType[] = [
  heading(1),
  heading(2),
  heading(3),
  {
    id: 'task',
    label: 'Task list',
    isActive: (editor) => editor.isActive('taskList'),
    apply: (editor) => editor.chain().focus().clearNodes().toggleTaskList().run(),
  },
  {
    id: 'numbered',
    label: 'Numbered list',
    isActive: (editor) => editor.isActive('orderedList'),
    apply: (editor) => editor.chain().focus().clearNodes().toggleOrderedList().run(),
  },
  {
    id: 'bullet',
    label: 'Bullet list',
    isActive: (editor) => editor.isActive('bulletList'),
    apply: (editor) => editor.chain().focus().clearNodes().toggleBulletList().run(),
  },
  {
    id: 'code',
    label: 'Code block',
    isActive: (editor) => editor.isActive('codeBlock'),
    apply: (editor) => editor.chain().focus().clearNodes().setCodeBlock().run(),
  },
  {
    id: 'quote',
    label: 'Quote',
    isActive: (editor) => editor.isActive('blockquote'),
    apply: (editor) => editor.chain().focus().clearNodes().setBlockquote().run(),
  },
];

export const TEXT_BLOCK: BlockType = {
  id: 'text',
  label: 'Text',
  isActive: (editor) => !BLOCK_TYPES.some((type) => type.isActive(editor)),
  apply: (editor) => editor.chain().focus().clearNodes().run(),
};

export function currentBlockType(editor: Editor): BlockType {
  return BLOCK_TYPES.find((type) => type.isActive(editor)) ?? TEXT_BLOCK;
}

/**
 * Insert a block with the slash menu: on an empty line, right there; otherwise
 * on a new line after the top-level block holding the caret, so a list or a
 * quote is not split.
 */
export function insertBlockWithMenu(editor: Editor) {
  const { $from } = editor.state.selection;
  if ($from.depth === 0) return;
  if ($from.parent.type.name === 'paragraph' && $from.parent.content.size === 0) {
    editor.chain().focus().insertContent('/').run();
    return;
  }
  const after = $from.after(1);
  editor
    .chain()
    .focus()
    .insertContentAt(after, { type: 'paragraph' })
    .setTextSelection(after + 1)
    .insertContent('/')
    .run();
}

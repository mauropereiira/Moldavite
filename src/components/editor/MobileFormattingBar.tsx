import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useEditorState, type Editor } from '@tiptap/react';
import { insertNoteTable } from './extensions/NoteTables';
import type { ImageAlignment } from './extensions/ResizableImage';

interface Control {
  label: string;
  /** The accessible name, when the visible label is an abbreviation or a glyph. */
  name?: string;
  pressed?: boolean;
  disabled?: boolean;
  run: () => void;
}

interface MobileFormattingBarProps {
  editor: Editor;
  onInsertLink: () => void;
  onInsertImage: () => void;
}

/** Sits at the bottom of the resized shell, immediately above the iOS keyboard. */
export function MobileFormattingBar({
  editor,
  onInsertLink,
  onInsertImage,
}: MobileFormattingBarProps) {
  // Keep the row mounted while a touch moves focus from the editor to a
  // formatting button. Hiding on :focus would remove the target before click.
  const [editing, setEditing] = useState(editor.isFocused);
  useEffect(() => {
    const focus = () => setEditing(true);
    editor.on('focus', focus);
    return () => {
      editor.off('focus', focus);
    };
  }, [editor]);
  const active = useEditorState({
    editor,
    selector: ({ editor: current }) => ({
      bold: current.isActive('bold'),
      italic: current.isActive('italic'),
      heading: current.isActive('heading', { level: 2 }),
      list: current.isActive('bulletList'),
      task: current.isActive('taskList'),
      table: current.isActive('table'),
      image: current.isActive('image'),
      alignment: current.isActive('image')
        ? ((current.getAttributes('image').alignment as string | undefined) ?? 'center')
        : null,
      undo: current.can().undo(),
      redo: current.can().redo(),
    }),
  });

  const context = active.image ? 'image' : active.table ? 'table' : 'text';

  // The row scrolls sideways, and a label cut at the edge by the Done divider
  // read as the end of the row. A fade on each side that has more controls
  // behind it says there is more to find.
  const scrollRef = useRef<HTMLDivElement>(null);
  const [overflow, setOverflow] = useState({ before: false, after: false });
  const measure = useCallback(() => {
    const node = scrollRef.current;
    if (!node) return;
    const before = node.scrollLeft > 1;
    const after = node.scrollLeft + node.clientWidth < node.scrollWidth - 1;
    setOverflow((current) =>
      current.before === before && current.after === after ? current : { before, after }
    );
  }, []);
  useLayoutEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollLeft = 0;
    measure();
  }, [context, editing, measure]);
  useEffect(() => {
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [measure]);

  // Image actions leave focus where it is: focusing the editor from a tap
  // raises the keyboard, which an image has no use for.
  const align = (alignment: ImageAlignment) => editor.chain().setImageAlignment(alignment).run();

  // A selected image or a caret in a table has actions of its own. They lead
  // the row, where they are visible without scrolling; the desktop keeps them
  // in a floating toolbar and the Format menu, neither of which a phone has.
  const contextControls: Control[] = active.image
    ? [
        {
          label: 'Left',
          name: 'Align image left',
          pressed: active.alignment === 'left',
          run: () => align('left'),
        },
        {
          label: 'Centre',
          name: 'Align image centre',
          pressed: active.alignment === 'center',
          run: () => align('center'),
        },
        {
          label: 'Right',
          name: 'Align image right',
          pressed: active.alignment === 'right',
          run: () => align('right'),
        },
        {
          label: 'Delete image',
          run: () => editor.chain().deleteSelection().run(),
        },
      ]
    : active.table
      ? [
          {
            label: '+ Row',
            name: 'Add row',
            run: () => editor.chain().focus().addRowAfter().run(),
          },
          {
            label: '+ Column',
            name: 'Add column',
            run: () => editor.chain().focus().addColumnAfter().run(),
          },
          {
            label: '− Row',
            name: 'Delete row',
            run: () => editor.chain().focus().deleteRow().run(),
          },
          {
            label: '− Column',
            name: 'Delete column',
            run: () => editor.chain().focus().deleteColumn().run(),
          },
          {
            label: 'Delete table',
            run: () => editor.chain().focus().deleteTable().run(),
          },
        ]
      : [];

  const controls: Control[] = [
    ...contextControls,
    { label: 'Bold', pressed: active.bold, run: () => editor.chain().focus().toggleBold().run() },
    {
      label: 'Italic',
      pressed: active.italic,
      run: () => editor.chain().focus().toggleItalic().run(),
    },
    {
      label: 'H2',
      name: 'Heading',
      pressed: active.heading,
      disabled: active.table,
      run: () => editor.chain().focus().toggleHeading({ level: 2 }).run(),
    },
    {
      label: 'List',
      name: 'Bullet list',
      pressed: active.list,
      disabled: active.table,
      run: () => editor.chain().focus().toggleBulletList().run(),
    },
    {
      label: 'Task',
      name: 'Task list',
      pressed: active.task,
      disabled: active.table,
      run: () => editor.chain().focus().toggleTaskList().run(),
    },
    {
      label: '[[Note]]',
      name: 'Link to a note',
      run: () => editor.chain().focus().insertContent('[[').run(),
    },
    { label: '#Tag', name: 'Tag', run: () => editor.chain().focus().insertContent('#').run() },
    { label: 'Link', run: onInsertLink },
    { label: 'Image', run: onInsertImage },
    { label: 'Table', disabled: active.table, run: () => insertNoteTable(editor) },
    { label: 'Undo', disabled: !active.undo, run: () => editor.chain().focus().undo().run() },
    { label: 'Redo', disabled: !active.redo, run: () => editor.chain().focus().redo().run() },
  ];

  return (
    <div
      className="mobile-formatting-bar"
      data-editing={editing}
      role="toolbar"
      aria-label="Note formatting"
    >
      <div
        ref={scrollRef}
        className="mobile-formatting-scroll"
        data-more-before={overflow.before}
        data-more-after={overflow.after}
        onScroll={measure}
      >
        {controls.map((control) => (
          <button
            key={control.label}
            type="button"
            aria-label={control.name}
            aria-pressed={control.pressed}
            disabled={control.disabled}
            onPointerDown={(event) => event.preventDefault()}
            onClick={control.run}
          >
            {control.label}
          </button>
        ))}
      </div>
      <button
        type="button"
        className="mobile-keyboard-done"
        aria-label="Dismiss keyboard"
        onClick={() => {
          editor.commands.blur();
          setEditing(false);
        }}
      >
        Done
      </button>
    </div>
  );
}

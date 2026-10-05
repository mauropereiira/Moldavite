import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useEditorState, type Editor } from '@tiptap/react';
import { Redo2, Undo2 } from 'lucide-react';
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
  noteId?: string;
  onInsertLink: () => void;
  onInsertImage: () => void;
}

type Panel = 'format' | 'insert';

/**
 * Sits at the bottom of the resized shell, immediately above the iOS keyboard.
 * The row itself is short enough never to scroll: Undo, Redo, Format, Insert
 * and Done. Format and Insert each open a strip above it with their controls.
 * A selected image or a caret in a table puts its own actions in that strip.
 */
export function MobileFormattingBar({
  editor,
  noteId,
  onInsertLink,
  onInsertImage,
}: MobileFormattingBarProps) {
  // Keep the row mounted while a touch moves focus from the editor to a
  // formatting button. Hiding on :focus would remove the target before click.
  const [editing, setEditing] = useState(editor.isFocused);
  const [editingNoteId, setEditingNoteId] = useState(noteId);
  const [panel, setPanel] = useState<Panel | null>(null);
  if (editingNoteId !== noteId) {
    setEditingNoteId(noteId);
    setEditing(false);
    setPanel(null);
  }
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
  }, [context, editing, panel, measure]);
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

  const styleControls: Control[] = [
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
  ];

  const insertControls: Control[] = [
    {
      label: '[[Note]]',
      name: 'Link to a note',
      run: () => editor.chain().focus().insertContent('[[').run(),
    },
    { label: '#Tag', name: 'Tag', run: () => editor.chain().focus().insertContent('#').run() },
    { label: 'Link', run: onInsertLink },
    { label: 'Image', run: onInsertImage },
    { label: 'Table', disabled: active.table, run: () => insertNoteTable(editor) },
  ];

  const controls = [
    ...contextControls,
    ...(panel === 'format' ? styleControls : panel === 'insert' ? insertControls : []),
  ];
  const toggle = (next: Panel) => setPanel((open) => (open === next ? null : next));
  const keepFocus = (event: React.PointerEvent) => event.preventDefault();

  const button = (control: Control) => (
    <button
      key={control.label}
      type="button"
      aria-label={control.name}
      aria-pressed={control.pressed}
      disabled={control.disabled}
      onPointerDown={keepFocus}
      onClick={control.run}
    >
      {control.label}
    </button>
  );

  return (
    <div
      className="mobile-formatting-bar"
      data-editing={editing}
      role="toolbar"
      aria-label="Note formatting"
    >
      {controls.length > 0 && (
        <div
          ref={scrollRef}
          className="mobile-formatting-scroll"
          role="group"
          aria-label={panel === 'format' ? 'Format' : panel === 'insert' ? 'Insert' : 'Actions'}
          data-more-before={overflow.before}
          data-more-after={overflow.after}
          onScroll={measure}
        >
          {controls.map(button)}
        </div>
      )}
      <div className="mobile-formatting-main">
        <button
          type="button"
          className="mobile-formatting-icon"
          aria-label="Undo"
          disabled={!active.undo}
          onPointerDown={keepFocus}
          onClick={() => editor.chain().focus().undo().run()}
        >
          <Undo2 className="w-5 h-5" strokeWidth={1.25} aria-hidden="true" />
        </button>
        <button
          type="button"
          className="mobile-formatting-icon"
          aria-label="Redo"
          disabled={!active.redo}
          onPointerDown={keepFocus}
          onClick={() => editor.chain().focus().redo().run()}
        >
          <Redo2 className="w-5 h-5" strokeWidth={1.25} aria-hidden="true" />
        </button>
        <button
          type="button"
          aria-expanded={panel === 'format'}
          onPointerDown={keepFocus}
          onClick={() => toggle('format')}
        >
          Format
        </button>
        <button
          type="button"
          aria-expanded={panel === 'insert'}
          onPointerDown={keepFocus}
          onClick={() => toggle('insert')}
        >
          Insert
        </button>
        <button
          type="button"
          className="mobile-keyboard-done"
          aria-label="Dismiss keyboard"
          onClick={() => {
            editor.commands.blur();
            setEditing(false);
            setPanel(null);
          }}
        >
          Done
        </button>
      </div>
    </div>
  );
}

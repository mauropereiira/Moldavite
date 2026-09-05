import { useEffect, useState } from 'react';
import { useEditorState, type Editor } from '@tiptap/react';

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
      undo: current.can().undo(),
      redo: current.can().redo(),
    }),
  });

  const controls = [
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
      run: () => editor.chain().focus().toggleHeading({ level: 2 }).run(),
    },
    {
      label: 'List',
      name: 'Bullet list',
      pressed: active.list,
      run: () => editor.chain().focus().toggleBulletList().run(),
    },
    {
      label: 'Task',
      name: 'Task list',
      pressed: active.task,
      run: () => editor.chain().focus().toggleTaskList().run(),
    },
    { label: '[[', name: 'Wiki link', run: () => editor.chain().focus().insertContent('[[').run() },
    { label: '#', name: 'Tag', run: () => editor.chain().focus().insertContent('#').run() },
    { label: 'Link', run: onInsertLink },
    { label: 'Image', run: onInsertImage },
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
      <div className="mobile-formatting-scroll">
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

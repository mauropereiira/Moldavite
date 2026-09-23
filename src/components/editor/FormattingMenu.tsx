import { useState } from 'react';
import { createPortal } from 'react-dom';
import { Editor, useEditorState } from '@tiptap/react';
import { Dropdown, DropdownItem, DropdownDivider, DropdownLabel } from '@/components/ui/Dropdown';
import { formatShortcut } from '@/lib/shortcuts';
import { LinkModal } from './LinkModal';
import { ImageModal } from './ImageModal';
import { insertBlock, insertNoteTable } from './extensions/NoteTables';

interface FormattingMenuProps {
  editor: Editor | null;
  openDirection?: 'up' | 'down';
}

export function FormattingMenu({ editor, openDirection = 'down' }: FormattingMenuProps) {
  const [isLinkModalOpen, setIsLinkModalOpen] = useState(false);
  const [isImageModalOpen, setIsImageModalOpen] = useState(false);
  const [linkInitialValues, setLinkInitialValues] = useState({ url: '', text: '' });
  const inTable = useEditorState({
    editor,
    selector: ({ editor: current }) => current?.isActive('table') ?? false,
  });

  if (!editor) return null;

  const handleLink = () => {
    const previousUrl = editor.getAttributes('link').href || '';
    const { from, to } = editor.state.selection;
    const hasSelection = from !== to;
    const selectedText = hasSelection ? editor.state.doc.textBetween(from, to) : '';

    setLinkInitialValues({ url: previousUrl, text: selectedText });
    setIsLinkModalOpen(true);
  };

  const handleLinkInsert = (url: string, text?: string) => {
    const { from, to } = editor.state.selection;
    const hasSelection = from !== to;

    if (hasSelection) {
      editor.chain().focus().setLink({ href: url }).run();
    } else {
      const linkText = text || url;
      editor
        .chain()
        .focus()
        .insertContent({
          type: 'text',
          marks: [{ type: 'link', attrs: { href: url } }],
          text: linkText,
        })
        .run();
    }
  };

  const handleImage = () => {
    setIsImageModalOpen(true);
  };

  const handleImageInsert = (url: string, alt?: string) => {
    editor.chain().focus().setImage({ src: url, alt }).run();
  };

  return (
    <>
      <Dropdown
        // Right-aligned like every other footer menu. Centred, this one hung
        // half its width past the trigger, and the trigger sits near the right
        // edge of the window — so the shortcut column ran off-screen unread.
        position="right"
        openDirection={openDirection}
        trigger={
          <button className="toolbar-button" title="Formatting" aria-label="Formatting">
            Format
          </button>
        }
      >
        <div className="max-h-80 overflow-y-auto">
          <DropdownLabel>Text</DropdownLabel>
          <DropdownItem onClick={() => editor.chain().focus().toggleBold().run()}>
            Bold
            <span className="ml-auto text-xs" style={{ color: 'var(--text-muted)' }}>
              {formatShortcut('⌘B')}
            </span>
          </DropdownItem>
          <DropdownItem onClick={() => editor.chain().focus().toggleItalic().run()}>
            Italic
            <span className="ml-auto text-xs" style={{ color: 'var(--text-muted)' }}>
              {formatShortcut('⌘I')}
            </span>
          </DropdownItem>
          <DropdownItem onClick={() => editor.chain().focus().toggleUnderline().run()}>
            Underline
            <span className="ml-auto text-xs" style={{ color: 'var(--text-muted)' }}>
              {formatShortcut('⌘U')}
            </span>
          </DropdownItem>
          <DropdownItem onClick={() => editor.chain().focus().toggleStrike().run()}>
            Strikethrough
          </DropdownItem>
          <DropdownItem onClick={() => editor.chain().focus().toggleHighlight().run()}>
            Highlight
          </DropdownItem>
          <DropdownItem onClick={() => editor.chain().focus().toggleCode().run()}>
            Inline Code
          </DropdownItem>

          <DropdownDivider />

          <DropdownLabel>Headings</DropdownLabel>
          <DropdownItem onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}>
            Heading 1
          </DropdownItem>
          <DropdownItem onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}>
            Heading 2
          </DropdownItem>
          <DropdownItem onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}>
            Heading 3
          </DropdownItem>

          <DropdownDivider />

          <DropdownLabel>Lists</DropdownLabel>
          <DropdownItem onClick={() => editor.chain().focus().toggleBulletList().run()}>
            Bullet List
          </DropdownItem>
          <DropdownItem onClick={() => editor.chain().focus().toggleOrderedList().run()}>
            Numbered List
          </DropdownItem>
          <DropdownItem onClick={() => editor.chain().focus().toggleTaskList().run()}>
            Task List
          </DropdownItem>
          <DropdownDivider />

          <DropdownLabel>Blocks</DropdownLabel>
          <DropdownItem onClick={() => editor.chain().focus().toggleBlockquote().run()}>
            Quote
          </DropdownItem>
          <DropdownItem onClick={() => editor.chain().focus().toggleCodeBlock().run()}>
            Code Block
          </DropdownItem>
          <DropdownItem onClick={() => insertBlock(editor, { type: 'horizontalRule' })}>
            Divider
          </DropdownItem>

          <DropdownDivider />

          <DropdownLabel>Insert</DropdownLabel>
          <DropdownItem onClick={handleLink}>
            Link
            <span className="ml-auto text-xs" style={{ color: 'var(--text-muted)' }}>
              {formatShortcut('⌘K')}
            </span>
          </DropdownItem>
          <DropdownItem onClick={handleImage}>Image</DropdownItem>
          <DropdownItem disabled={!!inTable} onClick={() => insertNoteTable(editor)}>
            Table
          </DropdownItem>

          {inTable && (
            <>
              <DropdownDivider />

              <DropdownLabel>Table</DropdownLabel>
              <DropdownItem onClick={() => editor.chain().focus().addRowAfter().run()}>
                Add Row
              </DropdownItem>
              <DropdownItem onClick={() => editor.chain().focus().addColumnAfter().run()}>
                Add Column
              </DropdownItem>
              <DropdownItem onClick={() => editor.chain().focus().deleteRow().run()}>
                Delete Row
              </DropdownItem>
              <DropdownItem onClick={() => editor.chain().focus().deleteColumn().run()}>
                Delete Column
              </DropdownItem>
              <DropdownItem
                variant="danger"
                onClick={() => editor.chain().focus().deleteTable().run()}
              >
                Delete Table
              </DropdownItem>
            </>
          )}
        </div>
      </Dropdown>

      {/* Portalled for the same reason as MoreOptionsMenu's dialogs: the
          folded Actions menu would otherwise contain them. */}
      {createPortal(
        <>
          <LinkModal
            isOpen={isLinkModalOpen}
            onClose={() => setIsLinkModalOpen(false)}
            onInsert={handleLinkInsert}
            initialUrl={linkInitialValues.url}
            initialText={linkInitialValues.text}
          />
          <ImageModal
            isOpen={isImageModalOpen}
            onClose={() => setIsImageModalOpen(false)}
            onInsert={handleImageInsert}
          />
        </>,
        document.body
      )}
    </>
  );
}

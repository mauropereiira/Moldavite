import { useState } from 'react';
import { Editor } from '@tiptap/react';
import { Dropdown, DropdownItem, DropdownDivider, DropdownLabel } from '@/components/ui/Dropdown';
import { formatShortcut } from '@/lib/shortcuts';
import { LinkModal } from './LinkModal';
import { ImageModal } from './ImageModal';

interface FormattingMenuProps {
  editor: Editor | null;
  openDirection?: 'up' | 'down';
}

export function FormattingMenu({ editor, openDirection = 'down' }: FormattingMenuProps) {
  const [isLinkModalOpen, setIsLinkModalOpen] = useState(false);
  const [isImageModalOpen, setIsImageModalOpen] = useState(false);
  const [linkInitialValues, setLinkInitialValues] = useState({ url: '', text: '' });

  if (!editor) return null;

  const handleLink = () => {
    // Check if cursor is on an existing link
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
      // Apply link to selected text
      editor.chain().focus().setLink({ href: url }).run();
    } else {
      // Insert new link with text
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
        position="center"
        openDirection={openDirection}
        trigger={
          <button className="toolbar-button" title="Formatting" aria-label="Formatting">
            Format
          </button>
        }
      >
        <div className="max-h-80 overflow-y-auto">
          {/* Text Formatting */}
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

          {/* Headings */}
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

          {/* Lists */}
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

          {/* Blocks */}
          <DropdownLabel>Blocks</DropdownLabel>
          <DropdownItem onClick={() => editor.chain().focus().toggleBlockquote().run()}>
            Quote
          </DropdownItem>
          <DropdownItem onClick={() => editor.chain().focus().toggleCodeBlock().run()}>
            Code Block
          </DropdownItem>
          <DropdownItem onClick={() => editor.chain().focus().setHorizontalRule().run()}>
            Divider
          </DropdownItem>

          <DropdownDivider />

          {/* Insert */}
          <DropdownLabel>Insert</DropdownLabel>
          <DropdownItem onClick={handleLink}>
            Link
            <span className="ml-auto text-xs" style={{ color: 'var(--text-muted)' }}>
              {formatShortcut('⌘K')}
            </span>
          </DropdownItem>
          <DropdownItem onClick={handleImage}>Image</DropdownItem>
        </div>
      </Dropdown>

      {/* Modals */}
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
    </>
  );
}

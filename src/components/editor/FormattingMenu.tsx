import React, { useState } from 'react';
import { Editor } from '@tiptap/react';
import {
  Type,
  Bold,
  Italic,
  Underline as UnderlineIcon,
  Strikethrough,
  Highlighter,
  Heading1,
  Heading2,
  Heading3,
  List,
  ListOrdered,
  ListChecks,
  Quote,
  Code,
  Minus,
  Link as LinkIcon,
  Image as ImageIcon
} from 'lucide-react';
import { Dropdown, DropdownItem, DropdownDivider, DropdownLabel } from '@/components/ui/Dropdown';
import { LinkModal } from './LinkModal';
import { ImageModal } from './ImageModal';

interface FormattingMenuProps {
  editor: Editor | null;
}

export function FormattingMenu({ editor }: FormattingMenuProps) {
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
        trigger={
          <button
            className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-600 dark:text-gray-400 transition-colors"
            title="Formatting"
          >
            <Type className="w-4 h-4" />
          </button>
        }
      >
        <div className="max-h-80 overflow-y-auto">
          {/* Text Formatting */}
          <DropdownLabel>Text</DropdownLabel>
          <DropdownItem
            onClick={() => editor.chain().focus().toggleBold().run()}
            icon={<Bold className="w-4 h-4" />}
          >
            Bold
            <span className="ml-auto text-xs text-gray-400">⌘B</span>
          </DropdownItem>
          <DropdownItem
            onClick={() => editor.chain().focus().toggleItalic().run()}
            icon={<Italic className="w-4 h-4" />}
          >
            Italic
            <span className="ml-auto text-xs text-gray-400">⌘I</span>
          </DropdownItem>
          <DropdownItem
            onClick={() => editor.chain().focus().toggleUnderline().run()}
            icon={<UnderlineIcon className="w-4 h-4" />}
          >
            Underline
            <span className="ml-auto text-xs text-gray-400">⌘U</span>
          </DropdownItem>
          <DropdownItem
            onClick={() => editor.chain().focus().toggleStrike().run()}
            icon={<Strikethrough className="w-4 h-4" />}
          >
            Strikethrough
          </DropdownItem>
          <DropdownItem
            onClick={() => editor.chain().focus().toggleHighlight().run()}
            icon={<Highlighter className="w-4 h-4" />}
          >
            Highlight
          </DropdownItem>
          <DropdownItem
            onClick={() => editor.chain().focus().toggleCode().run()}
            icon={<Code className="w-4 h-4" />}
          >
            Inline Code
          </DropdownItem>

          <DropdownDivider />

          {/* Headings */}
          <DropdownLabel>Headings</DropdownLabel>
          <DropdownItem
            onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
            icon={<Heading1 className="w-4 h-4" />}
          >
            Heading 1
          </DropdownItem>
          <DropdownItem
            onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
            icon={<Heading2 className="w-4 h-4" />}
          >
            Heading 2
          </DropdownItem>
          <DropdownItem
            onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
            icon={<Heading3 className="w-4 h-4" />}
          >
            Heading 3
          </DropdownItem>

          <DropdownDivider />

          {/* Lists */}
          <DropdownLabel>Lists</DropdownLabel>
          <DropdownItem
            onClick={() => editor.chain().focus().toggleBulletList().run()}
            icon={<List className="w-4 h-4" />}
          >
            Bullet List
          </DropdownItem>
          <DropdownItem
            onClick={() => editor.chain().focus().toggleOrderedList().run()}
            icon={<ListOrdered className="w-4 h-4" />}
          >
            Numbered List
          </DropdownItem>

          <DropdownDivider />

          {/* Blocks */}
          <DropdownLabel>Blocks</DropdownLabel>
          <DropdownItem
            onClick={() => editor.chain().focus().toggleBlockquote().run()}
            icon={<Quote className="w-4 h-4" />}
          >
            Quote
          </DropdownItem>
          <DropdownItem
            onClick={() => editor.chain().focus().toggleCodeBlock().run()}
            icon={<Code className="w-4 h-4" />}
          >
            Code Block
          </DropdownItem>
          <DropdownItem
            onClick={() => editor.chain().focus().setHorizontalRule().run()}
            icon={<Minus className="w-4 h-4" />}
          >
            Divider
          </DropdownItem>

          <DropdownDivider />

          {/* Insert */}
          <DropdownLabel>Insert</DropdownLabel>
          <DropdownItem
            onClick={handleLink}
            icon={<LinkIcon className="w-4 h-4" />}
          >
            Link
            <span className="ml-auto text-xs text-gray-400">⌘K</span>
          </DropdownItem>
          <DropdownItem
            onClick={handleImage}
            icon={<ImageIcon className="w-4 h-4" />}
          >
            Image
          </DropdownItem>
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

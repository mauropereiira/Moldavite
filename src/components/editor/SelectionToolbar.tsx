import { useEffect, useRef, useState } from 'react';
import type { Editor } from '@tiptap/react';
import { BubbleMenuPlugin } from '@tiptap/extension-bubble-menu';
import {
  Bold,
  Italic,
  Underline as UnderlineIcon,
  Strikethrough,
  Link as LinkIcon,
  ListOrdered,
  List,
  Quote,
  Code,
  Braces,
} from 'lucide-react';

interface SelectionToolbarProps {
  editor: Editor;
  onInsertLink: () => void;
}

/**
 * Floating toolbar that appears when text is selected in the editor.
 * Provides quick access to common formatting options.
 */
export function SelectionToolbar({ editor, onInsertLink }: SelectionToolbarProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    if (!menuRef.current || !editor || editor.isDestroyed) return;

    let isCleanedUp = false;

    const plugin = BubbleMenuPlugin({
      pluginKey: 'selectionToolbar',
      editor,
      element: menuRef.current,
      updateDelay: 100,
      shouldShow: ({ editor: e, state }) => {
        try {
          // Don't show if editor is destroyed or cleanup has started
          if (!e || e.isDestroyed || isCleanedUp) {
            setIsVisible(false);
            return false;
          }

          // Don't show when selecting nodes or when selection is empty
          const { from, to } = state.selection;
          const hasSelection = from !== to;
          const isNodeSelection = state.selection.constructor.name === 'NodeSelection';

          if (!hasSelection || isNodeSelection) {
            setIsVisible(false);
            return false;
          }

          // Don't show in code blocks
          if (e.isActive('codeBlock')) {
            setIsVisible(false);
            return false;
          }

          setIsVisible(true);
          return true;
        } catch (error) {
          console.warn('[SelectionToolbar] shouldShow error:', error);
          setIsVisible(false);
          return false;
        }
      },
      options: {
        placement: 'top',
        offset: { mainAxis: 8 },
      },
    });

    try {
      editor.registerPlugin(plugin);
    } catch (error) {
      console.warn('[SelectionToolbar] registerPlugin error:', error);
    }

    return () => {
      isCleanedUp = true;
      setIsVisible(false);
      try {
        if (editor && !editor.isDestroyed) {
          editor.unregisterPlugin('selectionToolbar');
        }
      } catch (error) {
        console.warn('[SelectionToolbar] cleanup error:', error);
      }
    };
  }, [editor]);

  return (
    <div
      ref={menuRef}
      className={`selection-toolbar ${isVisible ? 'selection-toolbar-visible' : ''}`}
      style={{ visibility: isVisible ? 'visible' : 'hidden' }}
    >
      {/* Text Formatting */}
      <button
        onClick={() => editor.chain().focus().toggleBold().run()}
        className={`toolbar-button ${editor.isActive('bold') ? 'toolbar-button-active' : ''}`}
        title="Bold (⌘B)"
      >
        <Bold className="w-4 h-4" />
      </button>
      <button
        onClick={() => editor.chain().focus().toggleItalic().run()}
        className={`toolbar-button ${editor.isActive('italic') ? 'toolbar-button-active' : ''}`}
        title="Italic (⌘I)"
      >
        <Italic className="w-4 h-4" />
      </button>
      <button
        onClick={() => editor.chain().focus().toggleUnderline().run()}
        className={`toolbar-button ${editor.isActive('underline') ? 'toolbar-button-active' : ''}`}
        title="Underline (⌘U)"
      >
        <UnderlineIcon className="w-4 h-4" />
      </button>
      <button
        onClick={() => editor.chain().focus().toggleStrike().run()}
        className={`toolbar-button ${editor.isActive('strike') ? 'toolbar-button-active' : ''}`}
        title="Strikethrough"
      >
        <Strikethrough className="w-4 h-4" />
      </button>

      {/* Divider */}
      <div className="toolbar-divider" />

      {/* Link */}
      <button
        onClick={onInsertLink}
        className={`toolbar-button ${editor.isActive('link') ? 'toolbar-button-active' : ''}`}
        title="Link (⌘K)"
      >
        <LinkIcon className="w-4 h-4" />
      </button>

      {/* Divider */}
      <div className="toolbar-divider" />

      {/* Lists */}
      <button
        onClick={() => editor.chain().focus().toggleOrderedList().run()}
        className={`toolbar-button ${editor.isActive('orderedList') ? 'toolbar-button-active' : ''}`}
        title="Numbered List"
      >
        <ListOrdered className="w-4 h-4" />
      </button>
      <button
        onClick={() => editor.chain().focus().toggleBulletList().run()}
        className={`toolbar-button ${editor.isActive('bulletList') ? 'toolbar-button-active' : ''}`}
        title="Bullet List"
      >
        <List className="w-4 h-4" />
      </button>

      {/* Divider */}
      <div className="toolbar-divider" />

      {/* Quote */}
      <button
        onClick={() => editor.chain().focus().toggleBlockquote().run()}
        className={`toolbar-button ${editor.isActive('blockquote') ? 'toolbar-button-active' : ''}`}
        title="Quote"
      >
        <Quote className="w-4 h-4" />
      </button>

      {/* Code */}
      <button
        onClick={() => editor.chain().focus().toggleCode().run()}
        className={`toolbar-button ${editor.isActive('code') ? 'toolbar-button-active' : ''}`}
        title="Inline Code"
      >
        <Code className="w-4 h-4" />
      </button>
      <button
        onClick={() => editor.chain().focus().toggleCodeBlock().run()}
        className={`toolbar-button ${editor.isActive('codeBlock') ? 'toolbar-button-active' : ''}`}
        title="Code Block"
      >
        <Braces className="w-4 h-4" />
      </button>
    </div>
  );
}

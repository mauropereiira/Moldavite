import { useEffect, useRef, useState } from 'react';
import type { Editor } from '@tiptap/react';
import { BubbleMenuPlugin } from '@tiptap/extension-bubble-menu';
import { formatShortcut } from '@/lib/shortcuts';

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

          // Don't show in code blocks or when image is selected
          if (e.isActive('codeBlock') || e.isActive('image')) {
            setIsVisible(false);
            return false;
          }

          setIsVisible(true);
          return true;
        } catch (error) {
          console.error('[SelectionToolbar] shouldShow error:', error);
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
      console.error('[SelectionToolbar] registerPlugin error:', error);
    }

    return () => {
      isCleanedUp = true;
      setIsVisible(false);
      try {
        if (editor && !editor.isDestroyed) {
          editor.unregisterPlugin('selectionToolbar');
        }
      } catch (error) {
        console.error('[SelectionToolbar] cleanup error:', error);
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
        title={`Bold (${formatShortcut('⌘B')})`}
        aria-label="Bold"
      >
        <span className="toolbar-label-bold">B</span>
      </button>
      <button
        onClick={() => editor.chain().focus().toggleItalic().run()}
        className={`toolbar-button ${editor.isActive('italic') ? 'toolbar-button-active' : ''}`}
        title={`Italic (${formatShortcut('⌘I')})`}
        aria-label="Italic"
      >
        <span className="toolbar-label-italic">I</span>
      </button>
      <button
        onClick={() => editor.chain().focus().toggleUnderline().run()}
        className={`toolbar-button ${editor.isActive('underline') ? 'toolbar-button-active' : ''}`}
        title={`Underline (${formatShortcut('⌘U')})`}
        aria-label="Underline"
      >
        <span className="toolbar-label-underline">U</span>
      </button>
      <button
        onClick={() => editor.chain().focus().toggleStrike().run()}
        className={`toolbar-button ${editor.isActive('strike') ? 'toolbar-button-active' : ''}`}
        title="Strikethrough"
        aria-label="Strikethrough"
      >
        <span className="toolbar-label-strike">S</span>
      </button>

      {/* Divider */}
      <div className="toolbar-divider" />

      {/* Link */}
      <button
        onClick={onInsertLink}
        className={`toolbar-button ${editor.isActive('link') ? 'toolbar-button-active' : ''}`}
        title={`Link (${formatShortcut('⌘K')})`}
        aria-label="Link"
      >
        Link
      </button>

      {/* Divider */}
      <div className="toolbar-divider" />

      {/* Lists */}
      <button
        onClick={() => editor.chain().focus().toggleOrderedList().run()}
        className={`toolbar-button ${editor.isActive('orderedList') ? 'toolbar-button-active' : ''}`}
        title="Numbered List"
        aria-label="Numbered list"
      >
        1.
      </button>
      <button
        onClick={() => editor.chain().focus().toggleBulletList().run()}
        className={`toolbar-button ${editor.isActive('bulletList') ? 'toolbar-button-active' : ''}`}
        title="Bullet List"
        aria-label="Bullet list"
      >
        List
      </button>

      {/* Divider */}
      <div className="toolbar-divider" />

      {/* Quote */}
      <button
        onClick={() => editor.chain().focus().toggleBlockquote().run()}
        className={`toolbar-button ${editor.isActive('blockquote') ? 'toolbar-button-active' : ''}`}
        title="Quote"
        aria-label="Quote"
      >
        Quote
      </button>

      {/* Code */}
      <button
        onClick={() => editor.chain().focus().toggleCode().run()}
        className={`toolbar-button ${editor.isActive('code') ? 'toolbar-button-active' : ''}`}
        title="Inline Code"
        aria-label="Inline code"
      >
        Code
      </button>
      <button
        onClick={() => editor.chain().focus().toggleCodeBlock().run()}
        className={`toolbar-button ${editor.isActive('codeBlock') ? 'toolbar-button-active' : ''}`}
        title="Code Block"
        aria-label="Code block"
      >
        Block
      </button>

      {/* Divider */}
      <div className="toolbar-divider" />

      {/* Text Alignment */}
      <button
        onClick={() => editor.chain().focus().setTextAlign('left').run()}
        className={`toolbar-button ${editor.isActive({ textAlign: 'left' }) ? 'toolbar-button-active' : ''}`}
        title="Align Left"
        aria-label="Align left"
      >
        Left
      </button>
      <button
        onClick={() => editor.chain().focus().setTextAlign('center').run()}
        className={`toolbar-button ${editor.isActive({ textAlign: 'center' }) ? 'toolbar-button-active' : ''}`}
        title="Align Center"
        aria-label="Align center"
      >
        Centre
      </button>
      <button
        onClick={() => editor.chain().focus().setTextAlign('right').run()}
        className={`toolbar-button ${editor.isActive({ textAlign: 'right' }) ? 'toolbar-button-active' : ''}`}
        title="Align Right"
        aria-label="Align right"
      >
        Right
      </button>
    </div>
  );
}

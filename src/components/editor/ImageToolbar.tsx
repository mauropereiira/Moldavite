import { useEffect, useRef, useState, useCallback } from 'react';
import type { Editor } from '@tiptap/react';
import {
  AlignLeft,
  AlignCenter,
  AlignRight,
  Trash2,
} from 'lucide-react';
import type { ImageAlignment } from './extensions/ResizableImage';

interface ImageToolbarProps {
  editor: Editor;
}

/**
 * Floating toolbar that appears when an image is selected in the editor.
 * Provides alignment options and delete functionality.
 */
export function ImageToolbar({ editor }: ImageToolbarProps) {
  const toolbarRef = useRef<HTMLDivElement>(null);
  const [isVisible, setIsVisible] = useState(false);
  const [position, setPosition] = useState({ top: 0, left: 0 });
  const [currentAlignment, setCurrentAlignment] = useState<ImageAlignment>('center');

  const updatePosition = useCallback(() => {
    if (!editor || editor.isDestroyed) return;

    const { state } = editor;
    const { selection } = state;
    const node = state.doc.nodeAt(selection.from);

    // Check if an image is selected
    if (node?.type.name === 'image') {
      setIsVisible(true);
      setCurrentAlignment(node.attrs.alignment || 'center');

      // Find the image element in the DOM
      const domNode = editor.view.nodeDOM(selection.from);
      if (domNode && domNode instanceof HTMLElement) {
        const rect = domNode.getBoundingClientRect();
        const editorRect = editor.view.dom.getBoundingClientRect();

        // Position toolbar above the image, centered
        const toolbarWidth = 160; // approximate width
        const left = rect.left + (rect.width / 2) - (toolbarWidth / 2) - editorRect.left;
        const top = rect.top - editorRect.top - 48; // 48px above image

        setPosition({
          top: Math.max(8, top),
          left: Math.max(8, Math.min(left, editorRect.width - toolbarWidth - 8)),
        });
      }
    } else {
      setIsVisible(false);
    }
  }, [editor]);

  useEffect(() => {
    if (!editor || editor.isDestroyed) return;

    // Listen for selection changes
    editor.on('selectionUpdate', updatePosition);
    editor.on('transaction', updatePosition);

    // Initial check
    updatePosition();

    return () => {
      editor.off('selectionUpdate', updatePosition);
      editor.off('transaction', updatePosition);
    };
  }, [editor, updatePosition]);

  const setAlignment = (alignment: ImageAlignment) => {
    editor.chain().focus().setImageAlignment(alignment).run();
    setCurrentAlignment(alignment);
  };

  const deleteImage = () => {
    editor.chain().focus().deleteSelection().run();
  };

  if (!isVisible) return null;

  return (
    <div
      ref={toolbarRef}
      className="image-toolbar"
      style={{
        top: `${position.top}px`,
        left: `${position.left}px`,
      }}
    >
      {/* Alignment buttons */}
      <button
        onClick={() => setAlignment('left')}
        className={`toolbar-button ${currentAlignment === 'left' ? 'toolbar-button-active' : ''}`}
        title="Align left"
      >
        <AlignLeft className="w-4 h-4" />
      </button>
      <button
        onClick={() => setAlignment('center')}
        className={`toolbar-button ${currentAlignment === 'center' ? 'toolbar-button-active' : ''}`}
        title="Align center"
      >
        <AlignCenter className="w-4 h-4" />
      </button>
      <button
        onClick={() => setAlignment('right')}
        className={`toolbar-button ${currentAlignment === 'right' ? 'toolbar-button-active' : ''}`}
        title="Align right"
      >
        <AlignRight className="w-4 h-4" />
      </button>

      {/* Divider */}
      <div className="toolbar-divider" />

      {/* Delete button */}
      <button
        onClick={deleteImage}
        className="toolbar-button toolbar-button-danger"
        title="Delete image"
      >
        <Trash2 className="w-4 h-4" />
      </button>
    </div>
  );
}

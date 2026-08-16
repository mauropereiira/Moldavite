import { Node, mergeAttributes } from '@tiptap/core';
import { NodeViewWrapper, ReactNodeViewRenderer, NodeViewProps } from '@tiptap/react';
import React, { useCallback, useEffect, useRef, useState } from 'react';

export type ImageAlignment = 'left' | 'center' | 'right';

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    image: {
      setImage: (options: {
        src: string;
        alt?: string;
        title?: string;
        width?: number;
        alignment?: ImageAlignment;
      }) => ReturnType;
      setImageAlignment: (alignment: ImageAlignment) => ReturnType;
    };
  }
}

/**
 * How wide an image is drawn when nobody has resized it.
 *
 * The attribute defaults to null, which rendered every picture at its natural
 * size — a phone screenshot arrived several thousand pixels wide and pushed the
 * note's text out of the way. This is a rendering default only: it is not
 * written to the note, so resizing still stores a real width and images already
 * in your notes keep whatever they had.
 */
const DEFAULT_IMAGE_WIDTH = 420;

function ImageNodeView({ node, updateAttributes, selected }: NodeViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  const [isResizing, setIsResizing] = useState(false);
  const [initialWidth, setInitialWidth] = useState(0);
  const [initialX, setInitialX] = useState(0);
  const [resizeDirection, setResizeDirection] = useState<'left' | 'right' | null>(null);

  const { src, alt, width, alignment = 'center' } = node.attrs;

  // Get current width (use stored width or natural width)
  const currentWidth = width
    ? typeof width === 'number'
      ? width
      : parseInt(width, 10)
    : undefined;

  const handleMouseDown = useCallback((e: React.MouseEvent, direction: 'left' | 'right') => {
    e.preventDefault();
    e.stopPropagation();

    if (imageRef.current) {
      setIsResizing(true);
      setInitialWidth(imageRef.current.offsetWidth);
      setInitialX(e.clientX);
      setResizeDirection(direction);
    }
  }, []);

  useEffect(() => {
    if (!isResizing) return;

    const handleMouseMove = (e: MouseEvent) => {
      if (!isResizing || !imageRef.current) return;

      const deltaX = e.clientX - initialX;
      const multiplier = resizeDirection === 'left' ? -1 : 1;
      let newWidth = initialWidth + deltaX * multiplier;

      // Minimum and maximum width constraints
      newWidth = Math.max(100, Math.min(newWidth, 1200));

      // Update the image width in real-time
      imageRef.current.style.width = `${newWidth}px`;
    };

    const handleMouseUp = () => {
      if (isResizing && imageRef.current) {
        const finalWidth = imageRef.current.offsetWidth;
        updateAttributes({ width: finalWidth });
      }
      setIsResizing(false);
      setResizeDirection(null);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isResizing, initialWidth, initialX, resizeDirection, updateAttributes]);

  // Get alignment style
  const alignmentStyle: React.CSSProperties = {
    display: 'block',
    textAlign: alignment as 'left' | 'center' | 'right',
  };

  return (
    <NodeViewWrapper className="resizable-image-wrapper" style={alignmentStyle}>
      <div
        ref={containerRef}
        className={`resizable-image-container ${selected ? 'selected' : ''} ${isResizing ? 'resizing' : ''}`}
      >
        <img
          ref={imageRef}
          src={src}
          alt={alt || ''}
          style={{ width: `${currentWidth || DEFAULT_IMAGE_WIDTH}px`, maxWidth: '100%' }}
          className="resizable-image"
          draggable={false}
        />

        {/* Resize handles - only show when selected */}
        {selected && (
          <>
            <div
              className="resize-handle resize-handle-left"
              onMouseDown={(e) => handleMouseDown(e, 'left')}
            />
            <div
              className="resize-handle resize-handle-right"
              onMouseDown={(e) => handleMouseDown(e, 'right')}
            />
          </>
        )}
      </div>
    </NodeViewWrapper>
  );
}

export const ResizableImage = Node.create({
  name: 'image',

  addOptions() {
    return {
      inline: false,
      allowBase64: true,
      HTMLAttributes: {},
    };
  },

  inline() {
    return this.options.inline;
  },

  group() {
    return this.options.inline ? 'inline' : 'block';
  },

  draggable: true,

  addAttributes() {
    return {
      src: {
        default: null,
      },
      alt: {
        default: null,
      },
      title: {
        default: null,
      },
      width: {
        default: null,
      },
      height: {
        default: null,
      },
      alignment: {
        default: 'center',
        parseHTML: (element) => element.getAttribute('data-alignment') || 'center',
        renderHTML: (attributes) => {
          if (!attributes.alignment) {
            return {};
          }
          return { 'data-alignment': attributes.alignment };
        },
      },
    };
  },

  parseHTML() {
    return [
      {
        tag: 'img[src]',
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    return ['img', mergeAttributes(this.options.HTMLAttributes, HTMLAttributes)];
  },

  addNodeView() {
    return ReactNodeViewRenderer(ImageNodeView);
  },

  addCommands() {
    return {
      setImage:
        (options: {
          src: string;
          alt?: string;
          title?: string;
          width?: number;
          alignment?: ImageAlignment;
        }) =>
        ({ commands }) => {
          return commands.insertContent({
            type: this.name,
            attrs: options,
          });
        },
      setImageAlignment:
        (alignment: ImageAlignment) =>
        ({ tr, state, dispatch }) => {
          const { selection } = state;
          const node = state.doc.nodeAt(selection.from);
          if (node?.type.name === 'image' && dispatch) {
            tr.setNodeMarkup(selection.from, undefined, {
              ...node.attrs,
              alignment,
            });
            dispatch(tr);
            return true;
          }
          return false;
        },
    };
  },
});

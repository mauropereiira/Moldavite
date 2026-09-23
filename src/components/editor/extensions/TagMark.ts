import { Mark, mergeAttributes } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';

export interface TagMarkOptions {
  HTMLAttributes: Record<string, unknown>;
  onTagClick: (tag: string) => void;
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    tagMark: {
      setTag: () => ReturnType;
      unsetTag: () => ReturnType;
    };
  }
}

/**
 * TipTap extension for hashtag styling.
 * Detects #tagname patterns and applies visual styling.
 * Tags are clickable to filter notes by tag.
 */
export const TagMark = Mark.create<TagMarkOptions>({
  name: 'tagMark',

  addOptions() {
    return {
      HTMLAttributes: {},
      onTagClick: () => {},
    };
  },

  addAttributes() {
    return {
      'data-tag': {
        default: null,
        parseHTML: (element) => element.getAttribute('data-tag'),
        renderHTML: (attributes) => {
          if (!attributes['data-tag']) {
            return {};
          }
          return { 'data-tag': attributes['data-tag'] };
        },
      },
    };
  },

  parseHTML() {
    return [
      {
        tag: 'span[data-tag]',
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      'span',
      mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, {
        class: 'tag-mark',
      }),
      0,
    ];
  },

  addCommands() {
    return {
      setTag:
        () =>
        ({ commands }) => {
          return commands.setMark(this.name);
        },
      unsetTag:
        () =>
        ({ commands }) => {
          return commands.unsetMark(this.name);
        },
    };
  },

  addProseMirrorPlugins() {
    const { onTagClick } = this.options;
    // A finger's tap on a tag in text that is not being edited only places the
    // caret on iOS; WebKit sends no click for it. The tap is read from the
    // pointer events instead, and the click that may still follow is ignored.
    let touchStart: { x: number; y: number; tag: Element } | null = null;
    let tappedAt = 0;

    return [
      new Plugin({
        key: new PluginKey('tagMarkClickHandler'),
        props: {
          handleDOMEvents: {
            pointerdown: (_view, event) => {
              const tag = (event.target as HTMLElement).closest?.('.tag-mark');
              touchStart =
                event.pointerType === 'touch' && tag
                  ? { x: event.clientX, y: event.clientY, tag }
                  : null;
              return false;
            },
            pointerup: (_view, event) => {
              const start = touchStart;
              touchStart = null;
              if (!start || event.pointerType !== 'touch') return false;
              if (Math.hypot(event.clientX - start.x, event.clientY - start.y) > 10) return false;
              const tag = start.tag.getAttribute('data-tag');
              if (!tag || !onTagClick) return false;
              event.preventDefault();
              tappedAt = event.timeStamp;
              onTagClick(tag);
              return true;
            },
            click: (_view, event) => {
              if (tappedAt && event.timeStamp - tappedAt < 800) {
                tappedAt = 0;
                event.preventDefault();
                return true;
              }
              const target = event.target as HTMLElement;
              const tagElement = target.closest('.tag-mark');

              if (tagElement) {
                const tag = tagElement.getAttribute('data-tag');
                if (tag && onTagClick) {
                  event.preventDefault();
                  event.stopPropagation();
                  onTagClick(tag);
                  return true;
                }
              }

              return false;
            },
          },
        },
      }),
      new Plugin({
        key: new PluginKey('tagMarkDecorator'),
        props: {
          decorations: (state) => {
            const { doc } = state;
            const decorations: Decoration[] = [];

            const tagRegex = /#([a-zA-Z][a-zA-Z0-9-]*)/g;
            const urlPattern = /https?:\/\/|www\./i;

            doc.descendants((node, pos) => {
              if (!node.isText || !node.text) return;

              if (node.marks.some((mark) => mark.type.name === 'link')) return;

              const text = node.text;

              if (urlPattern.test(text)) return;

              let match;

              while ((match = tagRegex.exec(text)) !== null) {
                const textBefore = text.slice(0, match.index);
                if (textBefore.includes('://') || textBefore.includes('www.')) {
                  continue;
                }

                const start = pos + match.index;
                const end = start + match[0].length;
                const tagName = match[1].toLowerCase();

                decorations.push(
                  Decoration.inline(start, end, {
                    class: 'tag-mark',
                    'data-tag': tagName,
                  })
                );
              }

              tagRegex.lastIndex = 0;
            });

            return DecorationSet.create(doc, decorations);
          },
        },
      }),
    ];
  },
});

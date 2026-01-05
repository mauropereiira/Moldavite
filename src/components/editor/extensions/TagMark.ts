import { Mark, mergeAttributes } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';

export interface TagMarkOptions {
  HTMLAttributes: Record<string, any>;
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

    return [
      // Click handler for tags
      new Plugin({
        key: new PluginKey('tagMarkClickHandler'),
        props: {
          handleDOMEvents: {
            click: (_view, event) => {
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
      // Decoration plugin to auto-detect and style tags
      new Plugin({
        key: new PluginKey('tagMarkDecorator'),
        props: {
          decorations: (state) => {
            const { doc } = state;
            const decorations: Decoration[] = [];

            // Regex to match hashtags
            const tagRegex = /#([a-zA-Z][a-zA-Z0-9-]*)/g;
            // Regex to detect if text looks like a URL
            const urlPattern = /https?:\/\/|www\./i;

            doc.descendants((node, pos) => {
              if (!node.isText || !node.text) return;

              // Skip if node has a link mark (it's inside a hyperlink)
              if (node.marks.some(mark => mark.type.name === 'link')) return;

              const text = node.text;

              // Skip if the text looks like it's part of a URL
              if (urlPattern.test(text)) return;

              let match;

              while ((match = tagRegex.exec(text)) !== null) {
                // Check if this hashtag is part of a URL fragment
                // Look backwards from the match to see if there's a URL pattern
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

              // Reset regex
              tagRegex.lastIndex = 0;
            });

            return DecorationSet.create(doc, decorations);
          },
        },
      }),
    ];
  },
});

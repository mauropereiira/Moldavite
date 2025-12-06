import { Node, mergeAttributes } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';

export interface WikiLinkOptions {
  HTMLAttributes: Record<string, any>;
  onLinkClick: (target: string) => void;
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    wikiLink: {
      setWikiLink: (attrs: { target: string; label: string }) => ReturnType;
    };
  }
}

/**
 * TipTap extension for wiki-style links with [[Note Name]] syntax.
 * Supports clickable links that navigate between notes and visual feedback for link existence.
 */
export const WikiLink = Node.create<WikiLinkOptions>({
  name: 'wikiLink',

  group: 'inline',

  inline: true,

  atom: true,

  addOptions() {
    return {
      HTMLAttributes: {},
      onLinkClick: () => {},
    };
  },

  addAttributes() {
    return {
      'data-target': {
        default: null,
        parseHTML: (element) => element.getAttribute('data-target'),
      },
      'data-label': {
        default: null,
        parseHTML: (element) => element.getAttribute('data-label') || element.textContent || '',
      },
      'data-exists': {
        default: 'unknown',
        parseHTML: (element) => element.getAttribute('data-exists') || 'unknown',
      },
    };
  },

  parseHTML() {
    return [
      {
        tag: 'wiki-link[data-target]',
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    const label = HTMLAttributes['data-label'] || '';
    const exists = HTMLAttributes['data-exists'];

    return [
      'wiki-link',
      mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, {
        class: exists === 'true' ? 'wiki-link-exists' : 'wiki-link-missing',
        'data-wiki-link': 'true',
      }),
      label,
    ];
  },

  renderText({ node }) {
    const label = node.attrs['data-label'] || '';
    return `[[${label}]]`;
  },

  addCommands() {
    return {
      setWikiLink:
        (attrs) =>
        ({ commands }) => {
          return commands.insertContent([
            {
              type: this.name,
              attrs: {
                'data-target': attrs.target,
                'data-label': attrs.label,
                'data-exists': 'true',
              },
            },
            { type: 'text', text: ' ' },
          ]);
        },
    };
  },

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey('wikiLinkClickHandler'),
        props: {
          handleDOMEvents: {
            click: (_view, event) => {
              const target = event.target as HTMLElement;
              const wikiLink = target.closest('wiki-link');

              if (wikiLink) {
                const dataTarget = wikiLink.getAttribute('data-target');

                if (dataTarget && this.options.onLinkClick) {
                  event.preventDefault();
                  event.stopPropagation();
                  this.options.onLinkClick(dataTarget);
                  return true;
                }
              }

              return false;
            },
          },
        },
      }),
    ];
  },
});

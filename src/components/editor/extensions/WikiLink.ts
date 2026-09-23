import { InputRule, Node, mergeAttributes } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { noteNameToFilename } from '@/lib/fileSystem';

export interface WikiLinkOptions {
  HTMLAttributes: Record<string, unknown>;
  onLinkClick: (target: string) => void;
  /** Whether a `data-target` names a note in the Forge, for links typed in full. */
  noteExists: (target: string) => boolean;
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    wikiLink: {
      setWikiLink: (attrs: { target: string; label: string; exists?: boolean }) => ReturnType;
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
      noteExists: () => false,
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
      'data-raw-target': {
        default: null,
        parseHTML: (element) => element.getAttribute('data-raw-target'),
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
    const rawTarget = node.attrs['data-raw-target'];
    return rawTarget ? `[[${label}|${rawTarget}]]` : `[[${label}]]`;
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
                'data-exists': attrs.exists === false ? 'false' : 'true',
              },
            },
            { type: 'text', text: ' ' },
          ]);
        },
    };
  },

  /** `[[Name]]` or `[[Label|Name]]` typed out in full becomes a link, as it does when read from disk. */
  addInputRules() {
    return [
      new InputRule({
        find: /\[\[([^[\]|]+)(?:\|([^[\]]+))?\]\]$/,
        handler: ({ state, range, match }) => {
          const label = match[1].trim();
          if (!label) return null;
          const rawTarget = match[2]?.trim() || null;
          const target = noteNameToFilename(rawTarget ?? label);
          state.tr.replaceWith(
            range.from,
            range.to,
            this.type.create({
              'data-target': target,
              'data-label': label,
              'data-raw-target': rawTarget,
              'data-exists': this.options.noteExists(target) ? 'true' : 'false',
            })
          );
        },
      }),
    ];
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

import { Extension, InputRule, Node, mergeAttributes } from '@tiptap/core';

/**
 * Markdown the editor cannot model (a footnote definition, a `<details>` block,
 * an HTML comment), held as its exact source in an editable plain-text block.
 * Turndown writes the text back as it stands, so an untouched block saves
 * byte for byte.
 */
export const RawMarkdown = Node.create({
  name: 'rawMarkdown',
  group: 'block',
  content: 'text*',
  marks: '',
  code: true,
  defining: true,

  parseHTML() {
    return [{ tag: 'pre[data-type="raw-markdown"]', preserveWhitespace: 'full', priority: 60 }];
  },

  renderHTML() {
    return ['pre', { 'data-type': 'raw-markdown', class: 'raw-markdown' }, 0];
  },
});

/** `[^label]`: shown as its label, saved as written. */
export const FootnoteRef = Node.create({
  name: 'footnoteRef',
  group: 'inline',
  inline: true,
  atom: true,

  addAttributes() {
    return {
      label: {
        default: '',
        parseHTML: (element) => element.getAttribute('data-label') ?? '',
        renderHTML: (attributes) => ({ 'data-label': attributes.label }),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'span[data-type="footnote-ref"]' }];
  },

  renderHTML({ node, HTMLAttributes }) {
    return [
      'span',
      mergeAttributes(HTMLAttributes, { 'data-type': 'footnote-ref', class: 'footnote-ref' }),
      node.attrs.label,
    ];
  },

  renderText({ node }) {
    return `[^${node.attrs.label}]`;
  },

  addInputRules() {
    return [
      new InputRule({
        find: /\[\^([^\s\]]+)\]$/,
        handler: ({ state, range, match }) => {
          state.tr.replaceWith(range.from, range.to, this.type.create({ label: match[1] }));
        },
      }),
    ];
  },
});

/** Where a list item had blank lines, read by Turndown; an item made in the editor has none. */
export const ListItemSpacing = Extension.create({
  name: 'listItemSpacing',

  addGlobalAttributes() {
    const flag = (name: string) => ({
      default: false,
      parseHTML: (element: HTMLElement) => element.getAttribute(name) === 'true',
      renderHTML: (attributes: Record<string, unknown>) =>
        attributes[name] ? { [name]: 'true' } : {},
    });
    return [
      {
        types: ['listItem', 'taskItem'],
        attributes: {
          'data-gap-after': flag('data-gap-after'),
          'data-gap-inside': flag('data-gap-inside'),
        },
      },
    ];
  },
});

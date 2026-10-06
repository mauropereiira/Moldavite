import { Extension, InputRule, Node, mergeAttributes } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { withoutMarkdownSources } from '@/lib/fileSystem';

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

  renderHTML({ HTMLAttributes }) {
    return [
      'pre',
      mergeAttributes(HTMLAttributes, { 'data-type': 'raw-markdown', class: 'raw-markdown' }),
      0,
    ];
  },
});

/** Inline HTML the editor cannot show (a comment, an unknown tag): shown and saved as written. */
export const RawInline = Node.create({
  name: 'rawInline',
  group: 'inline',
  inline: true,
  atom: true,

  addAttributes() {
    return {
      // Held as the element's text: DOMPurify drops an attribute holding `-->`.
      source: {
        default: '',
        parseHTML: (element) => element.textContent ?? '',
        renderHTML: () => ({}),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'span[data-type="raw-inline"]' }];
  },

  renderHTML({ node, HTMLAttributes }) {
    return [
      'span',
      mergeAttributes(HTMLAttributes, { 'data-type': 'raw-inline', class: 'raw-inline' }),
      node.attrs.source,
    ];
  },

  renderText({ node }) {
    return node.attrs.source;
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

const SOURCE_BLOCKS = [
  'paragraph',
  'heading',
  'blockquote',
  'bulletList',
  'orderedList',
  'taskList',
  'codeBlock',
  'horizontalRule',
  'table',
  'image',
  'rawMarkdown',
];

function sourceAttribute(name: string) {
  return {
    default: null,
    keepOnSplit: false,
    parseHTML: (element: HTMLElement) => element.getAttribute(name),
    renderHTML: (attributes: Record<string, unknown>) =>
      (attributes[name] ?? null) === null ? {} : { [name]: attributes[name] },
  };
}

/**
 * The Markdown each top-level block was loaded from, which `htmlToMarkdown`
 * writes back while the block is unchanged, and how the note spelled its list
 * markers. Pasted HTML loses them: a block's saved bytes must come from this
 * note's own file, never from a page that only looks the same.
 */
export const MarkdownSourceMap = Extension.create({
  name: 'markdownSourceMap',

  addGlobalAttributes() {
    return [
      {
        types: SOURCE_BLOCKS,
        attributes: Object.fromEntries(
          ['data-md-id', 'data-md-source', 'data-md-fresh', 'data-md-gap'].map((name) => [
            name,
            sourceAttribute(name),
          ])
        ),
      },
      {
        types: ['bulletList', 'orderedList', 'taskList'],
        attributes: { 'data-md-marker': sourceAttribute('data-md-marker') },
      },
    ];
  },

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey('markdownSourceMap'),
        props: { transformPastedHTML: withoutMarkdownSources },
      }),
    ];
  },
});

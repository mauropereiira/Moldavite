import { InputRule } from '@tiptap/core';
import { Fragment, type Node as PMNode } from '@tiptap/pm/model';
import { Plugin, PluginKey, TextSelection, type Transaction } from '@tiptap/pm/state';
import StarterKit from '@tiptap/starter-kit';
import Link from '@tiptap/extension-link';
import Underline from '@tiptap/extension-underline';
import TextAlign from '@tiptap/extension-text-align';
import Highlight from '@tiptap/extension-highlight';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import { NoteTables } from './extensions/NoteTables';
import { ResizableImage } from './extensions/ResizableImage';
import { WikiLink, type WikiLinkOptions } from './extensions/WikiLink';
import { TagMark, type TagMarkOptions } from './extensions/TagMark';
import {
  FootnoteRef,
  ListItemSpacing,
  MarkdownSourceMap,
  RawInline,
  RawMarkdown,
} from './extensions/MarkdownSource';

// The spelling of a bare or `<...>` URL when its text alone cannot give it back.
const NoteLink = Link.extend({
  addAttributes() {
    return { ...this.parent?.(), 'data-source': { default: null } };
  },
});

const isNumberedList = (node: PMNode) =>
  node.type.name === 'orderedList' || (node.type.name === 'taskList' && node.attrs.start !== null);

const listDelimiter = (node: PMNode) =>
  String(node.attrs['data-md-marker'] ?? '').startsWith(')') ? ')' : '.';

/**
 * Numbered to-dos among numbered items are one list in Markdown but a row of
 * lists here, so each one counts on from the one before it as items come and go.
 */
function renumberRuns(parent: PMNode, offset: number, tr: Transaction): void {
  let previous: { node: PMNode; start: number } | null = null;
  let pos = offset;
  for (let index = 0; index < parent.childCount; index++) {
    const child = parent.child(index);
    let run: { node: PMNode; start: number } | null = null;
    if (isNumberedList(child)) {
      run = { node: child, start: Number(child.attrs.start ?? 1) };
      const carriesOn =
        previous !== null &&
        (child.type.name === 'taskList' || previous.node.type.name === 'taskList') &&
        listDelimiter(child) === listDelimiter(previous.node);
      if (previous !== null && carriesOn) {
        const expected = previous.start + previous.node.childCount;
        if (expected !== run.start) tr.setNodeAttribute(pos, 'start', expected);
        run.start = expected;
      }
    }
    previous = run;
    if (!child.isTextblock && !child.isLeaf) renumberRuns(child, pos + 1, tr);
    pos += child.nodeSize;
  }
}

/**
 * A numbered to-do list (`1. [ ] item`) is a task list that knows the number
 * it starts at, so it keeps its checkboxes and saves its numbers.
 */
const NoteTaskList = TaskList.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      start: {
        default: null,
        parseHTML: (element: HTMLElement) => {
          const start = Number(element.getAttribute('start') ?? NaN);
          return Number.isInteger(start) ? start : null;
        },
        renderHTML: (attributes: Record<string, unknown>) =>
          typeof attributes.start === 'number'
            ? {
                start: attributes.start,
                style: `counter-reset: task-number ${attributes.start - 1}`,
              }
            : {},
      },
    };
  },

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey('numberedTaskRuns'),
        appendTransaction: (transactions, _oldState, newState) => {
          if (!transactions.some((transaction) => transaction.docChanged)) return null;
          const tr = newState.tr;
          renumberRuns(newState.doc, 0, tr);
          return tr.docChanged ? tr : null;
        },
      }),
    ];
  },

  // Typing `[ ] ` at the start of a numbered item turns that item into a
  // numbered to-do; the items around it stay a numbered list.
  addInputRules() {
    return [
      new InputRule({
        find: /^\[([ xX]?)\]\s$/,
        handler: ({ state, range, match }) => {
          const { tr, schema } = state;
          const $from = tr.doc.resolve(range.from);
          if ($from.depth < 3 || $from.index(-1) !== 0) return null;
          const paragraph = $from.parent;
          const item = $from.node(-1);
          const list = $from.node(-2);
          if (item.type.name !== 'listItem' || list.type.name !== 'orderedList') return null;

          const index = $from.index(-2);
          const first = Number(list.attrs.start ?? 1);
          const marker = { 'data-md-marker': list.attrs['data-md-marker'] ?? null };
          const items: PMNode[] = [];
          list.forEach((child) => items.push(child));
          const task = schema.nodes.taskItem.create({ checked: /x/i.test(match[1]) }, [
            paragraph.copy(paragraph.content.cut(range.to - $from.start())),
            ...item.content.cut(paragraph.nodeSize).content,
          ]);
          const before = index > 0 ? list.copy(Fragment.from(items.slice(0, index))) : null;
          const parts = [
            ...(before ? [before] : []),
            this.type.create({ ...marker, start: first + index }, task),
            ...(index < items.length - 1
              ? [list.type.create({ ...marker, start: first + index + 1 }, items.slice(index + 1))]
              : []),
          ];
          const at = $from.before(-2);
          tr.replaceWith(at, at + list.nodeSize, parts);
          tr.setSelection(TextSelection.create(tr.doc, at + (before?.nodeSize ?? 0) + 3));
        },
      }),
    ];
  },
});

const NoteHighlight = Highlight.extend({
  addKeyboardShortcuts() {
    return { 'Mod-Shift-h': () => this.editor.commands.toggleHighlight() };
  },
}).configure({ multicolor: false });

export function createNoteExtensions(
  tagsEnabled = true,
  options: { wikiLink?: Partial<WikiLinkOptions>; tagMark?: Partial<TagMarkOptions> } = {}
) {
  return [
    StarterKit.configure({
      heading: {
        levels: [1, 2, 3, 4, 5, 6],
      },
      link: false,
      underline: false,
    }),
    ResizableImage.configure({
      inline: false,
      allowBase64: true,
    }),
    NoteLink.configure({
      // Tauri WebViews hand link clicks to the system browser in Editor.
      openOnClick: false,
      autolink: true,
      protocols: ['http', 'https', 'mailto'],
      HTMLAttributes: {
        rel: 'noopener noreferrer nofollow',
        target: '_blank',
      },
      validate: (href) => /^(https?:|mailto:)/i.test(href),
    }),
    Underline,
    TextAlign.configure({
      types: ['heading', 'paragraph'],
    }),
    NoteHighlight,
    NoteTaskList,
    TaskItem.configure({
      nested: true,
    }),
    ...NoteTables,
    WikiLink.configure(options.wikiLink),
    RawMarkdown,
    RawInline,
    FootnoteRef,
    ListItemSpacing,
    MarkdownSourceMap,
    ...(tagsEnabled ? [TagMark.configure(options.tagMark)] : []),
  ];
}

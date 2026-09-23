/**
 * Tables as GFM can store them: every cell holds paragraphs and nothing else.
 *
 * A list, heading, code block, quote, image or nested table inside a cell has
 * no pipe-table form and was mangled on save, so the schema refuses them. That
 * alone is not enough, because ProseMirror places a block that does not fit
 * by closing the cell and the table around it, splitting the table in two.
 * Blocks therefore degrade to paragraphs wherever HTML enters a cell (parsing
 * a note, pasting), block inserts made from a cell land after the table, and
 * any other edit that would split a table from inside it is refused.
 */
import { Extension, type Editor, type JSONContent } from '@tiptap/core';
import { Table, TableCell, TableHeader, TableRow, createTable } from '@tiptap/extension-table';
import { DOMParser as ProseMirrorDOMParser, Fragment, Slice } from '@tiptap/pm/model';
import type { Node as ProseMirrorNode, Schema } from '@tiptap/pm/model';
import { Plugin, PluginKey, type EditorState, type Transaction } from '@tiptap/pm/state';

/** Marks a block insert that deliberately lands beside a table. */
export const TABLE_BLOCK_INSERT = 'noteTableBlockInsert';

function collectParagraphs(fragment: Fragment, schema: Schema, out: ProseMirrorNode[]): void {
  const paragraph = schema.nodes.paragraph;
  let inline: ProseMirrorNode[] = [];
  const flush = () => {
    if (inline.length) out.push(paragraph.create(null, inline));
    inline = [];
  };
  fragment.forEach((child) => {
    if (child.isInline) {
      inline.push(child);
      return;
    }
    flush();
    if (child.type.spec.code) {
      for (const line of child.textContent.split('\n')) {
        out.push(paragraph.create(null, line ? schema.text(line) : null));
      }
    } else if (child.isTextblock) {
      out.push(paragraph.create(null, child.content));
    } else {
      collectParagraphs(child.content, schema, out);
    }
  });
  flush();
}

/** Block content flattened to the paragraphs a table cell can hold. */
export function cellParagraphs(fragment: Fragment, schema: Schema): Fragment {
  const out: ProseMirrorNode[] = [];
  collectParagraphs(fragment, schema, out);
  return Fragment.from(out.length ? out : [schema.nodes.paragraph.create()]);
}

function parseCell(node: Node, schema: Schema): Fragment {
  return cellParagraphs(ProseMirrorDOMParser.fromSchema(schema).parseSlice(node).content, schema);
}

const ParagraphCell = TableCell.extend({
  content: 'paragraph+',
  parseHTML() {
    return [{ tag: 'td', getContent: parseCell }];
  },
});

const ParagraphHeader = TableHeader.extend({
  content: 'paragraph+',
  parseHTML() {
    return [{ tag: 'th', getContent: parseCell }];
  },
});

function enclosingTableDepth(state: EditorState): number | null {
  const { $from } = state.selection;
  for (let depth = $from.depth; depth > 0; depth--) {
    if ($from.node(depth).type.name === 'table') return depth;
  }
  return null;
}

/** Where a block inserted from the cursor should go: after the table it is in, if any. */
export function afterEnclosingTable(state: EditorState): number | null {
  const depth = enclosingTableDepth(state);
  return depth === null ? null : state.selection.$from.after(depth);
}

/** Inserts a block at the cursor, or right after the table when the cursor is in one. */
export function insertBlock(editor: Editor, content: JSONContent): boolean {
  const after = afterEnclosingTable(editor.state);
  if (after === null) return editor.chain().focus().insertContent(content).run();
  return editor
    .chain()
    .focus()
    .insertContentAt(after, content)
    .setMeta(TABLE_BLOCK_INSERT, true)
    .run();
}

export function insertNoteTable(editor: Editor): boolean {
  const after = afterEnclosingTable(editor.state);
  if (after === null) {
    return editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run();
  }
  const table = createTable(editor.schema, 3, 3, true);
  return editor
    .chain()
    .focus()
    .insertContentAt(after, table.toJSON())
    .setMeta(TABLE_BLOCK_INSERT, true)
    .setTextSelection(after + 4)
    .run();
}

/**
 * True for an edit made entirely inside a table that leaves more blocks beside
 * it than before, which is ProseMirror splitting the table around a block it
 * could not fit in a cell. Edits that reach outside the table, such as undo
 * or reloading the note, are never judged.
 */
function wouldSplitTable(tr: Transaction, state: EditorState): boolean {
  if (!tr.docChanged || tr.getMeta(TABLE_BLOCK_INSERT)) return false;
  const depth = enclosingTableDepth(state);
  if (depth === null) return false;
  const { $from } = state.selection;
  let start = $from.before(depth);
  let end = $from.after(depth);
  for (const step of tr.steps) {
    const { from, to } = step as unknown as { from?: number; to?: number };
    if (typeof from !== 'number' || typeof to !== 'number' || from <= start || to >= end) {
      return false;
    }
    const map = step.getMap();
    start = map.map(start, -1);
    end = map.map(end, 1);
  }
  const siblingsBefore = $from.node(depth - 1).childCount;
  const $table = tr.doc.resolve(tr.mapping.map($from.before(depth)));
  return $table.parent.childCount > siblingsBefore;
}

const TableGuard = Extension.create({
  name: 'noteTableGuard',
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey('noteTableGuard'),
        filterTransaction: (tr, state) => !wouldSplitTable(tr, state),
        props: {
          transformPasted: (slice, view) => {
            if (enclosingTableDepth(view.state) === null) return slice;
            const only = slice.content.childCount === 1 ? slice.content.firstChild : null;
            if (only?.type.spec.tableRole) return slice;
            let hasBlocks = false;
            slice.content.descendants((node) => {
              if (node.isBlock && node.type.name !== 'paragraph') hasBlocks = true;
              return !hasBlocks;
            });
            if (!hasBlocks) return slice;
            return new Slice(cellParagraphs(slice.content, view.state.schema), 1, 1);
          },
        },
      }),
    ];
  },
});

export const NoteTables = [Table, TableRow, ParagraphHeader, ParagraphCell, TableGuard];

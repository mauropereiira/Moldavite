/**
 * The desktop writing toolbar: block type, inline styles and Link above the
 * block the caret is in, and a + in the left gutter that opens the slash menu.
 *
 * Like the WordPress block editor it steps aside while you type and comes back
 * when the pointer moves or the caret is moved with the keyboard, so it is
 * never in the way of the words. Alt+F10 moves focus into it. A selection gets
 * the selection toolbar instead, so the two never show at once.
 *
 * It sits inside the note's scroll container, positioned from the block's own
 * box, so it scrolls with the text rather than chasing it.
 */

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { useEditorState, type Editor } from '@tiptap/react';
import type { PluginKey } from '@tiptap/pm/state';
import { Plus } from 'lucide-react';
import { formatShortcut } from '@/lib/shortcuts';
import { BlockTypeMenu } from './BlockTypeMenu';
import { insertBlockWithMenu } from './blockTypes';
import { slashCommandsPluginKey } from './extensions/SlashCommands';
import { tagSuggestionPluginKey } from './extensions/TagSuggestion';
import { wikiLinkSuggestionPluginKey } from './extensions/WikiLinkSuggestion';

const SUGGESTIONS: PluginKey[] = [
  slashCommandsPluginKey,
  tagSuggestionPluginKey,
  wikiLinkSuggestionPluginKey,
];

/** Keys that move the caret rather than write: the toolbar comes back for them. */
const NAVIGATION = new Set([
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'Home',
  'End',
  'PageUp',
  'PageDown',
]);

const MODIFIERS = new Set(['Shift', 'Alt', 'Meta', 'Control', 'CapsLock', 'Escape']);

const TOOLBAR_HEIGHT = 34;
const GAP = 6;
const PLUS_SIZE = 24;

interface Placement {
  top: number;
  left: number;
  /** The top-level block's left edge, so + sits in the gutter, not on a list bullet. */
  gutter: number;
  height: number;
  lineHeight: number;
}

export function WritingToolbar({
  editor,
  onInsertLink,
}: {
  editor: Editor;
  onInsertLink: () => void;
}) {
  const [typing, setTyping] = useState(false);
  const [focusInside, setFocusInside] = useState(false);
  const [placement, setPlacement] = useState<Placement | null>(null);
  const toolbarRef = useRef<HTMLDivElement>(null);

  const state = useEditorState({
    editor,
    selector: ({ editor: current }) => {
      const { selection, doc } = current.state;
      const { $from } = selection;
      return {
        focused: current.isFocused,
        collapsed: selection.empty,
        inTable: current.isActive('table'),
        blockPos: $from.depth > 0 ? $from.before($from.depth) : null,
        topPos: $from.depth > 0 ? $from.before(1) : null,
        emptyLine: $from.parent.type.name === 'paragraph' && $from.parent.content.size === 0,
        suggesting: SUGGESTIONS.some(
          (key) => (key.getState(current.state) as { active?: boolean } | undefined)?.active
        ),
        // Edits above the block move it; the size is a cheap stand-in for that.
        docSize: doc.content.size,
        bold: current.isActive('bold'),
        italic: current.isActive('italic'),
        underline: current.isActive('underline'),
        strike: current.isActive('strike'),
        link: current.isActive('link'),
      };
    },
  });

  const engaged = (state.focused || focusInside) && !state.inTable && !state.suggesting;
  const showToolbar = engaged && state.collapsed && !typing;
  const showPlus = engaged && state.collapsed && (state.emptyLine || !typing);

  useEffect(() => {
    const dom = editor.view.dom;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.altKey && event.key === 'F10') {
        event.preventDefault();
        setTyping(false);
        requestAnimationFrame(() => toolbarRef.current?.querySelector('button')?.focus());
        return;
      }
      if (NAVIGATION.has(event.key)) setTyping(false);
      else if (!event.metaKey && !event.ctrlKey && !MODIFIERS.has(event.key)) setTyping(true);
    };
    const onPointerMove = () => setTyping(false);
    dom.addEventListener('keydown', onKeyDown);
    window.addEventListener('mousemove', onPointerMove);
    return () => {
      dom.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('mousemove', onPointerMove);
    };
  }, [editor]);

  const { blockPos, topPos, docSize } = state;
  useLayoutEffect(() => {
    const container = editor.view.dom.closest<HTMLElement>('.editor-paper');
    if (!container || blockPos === null || topPos === null || !(showToolbar || showPlus)) return;
    // Re-measured on resize as well: a narrower window rewraps the lines above.
    const measure = () => {
      const block = editor.view.nodeDOM(blockPos);
      const top = editor.view.nodeDOM(topPos);
      if (!(block instanceof HTMLElement) || !(top instanceof HTMLElement)) return;
      const box = container.getBoundingClientRect();
      const rect = block.getBoundingClientRect();
      const lineHeight = parseFloat(getComputedStyle(block).lineHeight) || PLUS_SIZE;
      const next = {
        top: rect.top - box.top + container.scrollTop,
        left: rect.left - box.left + container.scrollLeft,
        gutter: top.getBoundingClientRect().left - box.left + container.scrollLeft,
        height: rect.height,
        lineHeight,
      };
      setPlacement((previous) =>
        previous &&
        previous.top === next.top &&
        previous.left === next.left &&
        previous.gutter === next.gutter &&
        previous.height === next.height &&
        previous.lineHeight === next.lineHeight
          ? previous
          : next
      );
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [editor, blockPos, topPos, docSize, showToolbar, showPlus]);

  if (!placement || !(showToolbar || showPlus)) return null;

  // Above the block, or below it when the block is the first thing on the page.
  const above = placement.top - TOOLBAR_HEIGHT - GAP;
  const toolbarTop = above >= 0 ? above : placement.top + placement.height + GAP;
  const mark = (name: string, active: boolean, label: ReactNode, run: () => void) => (
    <button
      type="button"
      className={`toolbar-button${active ? ' toolbar-button-active' : ''}`}
      aria-pressed={active}
      aria-label={name}
      title={name}
      onClick={run}
    >
      {label}
    </button>
  );

  return (
    <div
      onMouseDown={(event) => {
        // Keep the caret, and the editor's focus, where the writer left them.
        event.preventDefault();
      }}
      onFocus={() => setFocusInside(true)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
          setFocusInside(false);
        }
      }}
      onKeyDown={(event) => {
        if (event.key !== 'Escape') return;
        event.preventDefault();
        editor.commands.focus();
      }}
    >
      {showPlus && (
        <button
          type="button"
          className="writing-plus"
          aria-label="Insert a block"
          title="Insert a block (or type / )"
          style={{
            top: placement.top + (placement.lineHeight - PLUS_SIZE) / 2,
            left: Math.max(2, placement.gutter - PLUS_SIZE - 8),
          }}
          onClick={() => insertBlockWithMenu(editor)}
        >
          <Plus className="w-4 h-4" strokeWidth={1.25} aria-hidden="true" />
        </button>
      )}
      {showToolbar && (
        <div
          ref={toolbarRef}
          className="selection-toolbar writing-toolbar"
          role="toolbar"
          aria-label="Formatting"
          style={{ top: toolbarTop, left: Math.max(0, placement.left - 6) }}
        >
          <BlockTypeMenu editor={editor} />
          <div className="toolbar-divider" />
          {mark(
            `Bold (${formatShortcut('⌘B')})`,
            state.bold,
            <span className="toolbar-label-bold">B</span>,
            () => editor.chain().focus().toggleBold().run()
          )}
          {mark(
            `Italic (${formatShortcut('⌘I')})`,
            state.italic,
            <span className="toolbar-label-italic">I</span>,
            () => editor.chain().focus().toggleItalic().run()
          )}
          {mark(
            `Underline (${formatShortcut('⌘U')})`,
            state.underline,
            <span className="toolbar-label-underline">U</span>,
            () => editor.chain().focus().toggleUnderline().run()
          )}
          {mark(
            'Strikethrough',
            state.strike,
            <span className="toolbar-label-strike">S</span>,
            () => editor.chain().focus().toggleStrike().run()
          )}
          <div className="toolbar-divider" />
          {mark(`Link (${formatShortcut('⌘K')})`, state.link, 'Link', onInsertLink)}
        </div>
      )}
    </div>
  );
}

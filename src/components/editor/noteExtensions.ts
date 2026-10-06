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
    TaskList,
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

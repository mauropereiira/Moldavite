import { forwardRef, useEffect, useImperativeHandle, useState, useCallback } from 'react';
import type { Editor } from '@tiptap/react';

export interface SlashCommandItem {
  title: string;
  description: string;
  mark: string;
  command: (editor: Editor) => void;
  keywords?: string[];
}

export interface SlashCommandListProps {
  items: SlashCommandItem[];
  command: (item: SlashCommandItem) => void;
  editor: Editor;
}

export interface SlashCommandListRef {
  onKeyDown: (event: KeyboardEvent) => boolean;
}

/**
 * All available slash commands
 */
export const slashCommands: SlashCommandItem[] = [
  {
    title: 'Heading 1',
    description: 'Large section heading',
    mark: 'H1',
    keywords: ['h1', 'title', 'big'],
    command: (editor) => {
      editor.chain().focus().toggleHeading({ level: 1 }).run();
    },
  },
  {
    title: 'Heading 2',
    description: 'Medium section heading',
    mark: 'H2',
    keywords: ['h2', 'subtitle'],
    command: (editor) => {
      editor.chain().focus().toggleHeading({ level: 2 }).run();
    },
  },
  {
    title: 'Heading 3',
    description: 'Small section heading',
    mark: 'H3',
    keywords: ['h3', 'small'],
    command: (editor) => {
      editor.chain().focus().toggleHeading({ level: 3 }).run();
    },
  },
  {
    title: 'Bullet List',
    description: 'Unordered list with bullets',
    mark: 'List',
    keywords: ['ul', 'unordered', 'bullets'],
    command: (editor) => {
      editor.chain().focus().toggleBulletList().run();
    },
  },
  {
    title: 'Numbered List',
    description: 'Ordered list with numbers',
    mark: '1.',
    keywords: ['ol', 'ordered', 'numbers'],
    command: (editor) => {
      editor.chain().focus().toggleOrderedList().run();
    },
  },
  {
    title: 'Task List',
    description: 'Checklist with checkboxes',
    mark: 'Task',
    keywords: ['todo', 'checkbox', 'check', 'tasks'],
    command: (editor) => {
      editor.chain().focus().toggleTaskList().run();
    },
  },
  {
    title: 'Quote',
    description: 'Blockquote for citations',
    mark: 'Quote',
    keywords: ['blockquote', 'cite'],
    command: (editor) => {
      editor.chain().focus().toggleBlockquote().run();
    },
  },
  {
    title: 'Code Block',
    description: 'Code with syntax highlighting',
    mark: 'Code',
    keywords: ['pre', 'syntax', 'programming'],
    command: (editor) => {
      editor.chain().focus().toggleCodeBlock().run();
    },
  },
  {
    title: 'Divider',
    description: 'Horizontal line separator',
    mark: 'Rule',
    keywords: ['hr', 'horizontal', 'rule', 'line', 'separator'],
    command: (editor) => {
      editor.chain().focus().setHorizontalRule().run();
    },
  },
  {
    title: 'Image',
    description: 'Insert an image',
    mark: 'Image',
    keywords: ['picture', 'photo', 'img'],
    command: () => {
      // Hand off to the Insert Image dialog rather than doing it here.
      //
      // This used to read the file with `readAsDataURL` and insert the base64
      // straight into the document, so it never touched `save_image`: the
      // picture ended up embedded in the note's Markdown as a multi-megabyte
      // data URL instead of a file in the Forge's `images/` folder with a link
      // to it. The dialog already does it properly, so there is one way to
      // insert an image rather than two that disagree.
      window.dispatchEvent(new window.CustomEvent('moldavite:open-image-dialog'));
    },
  },
];

/**
 * Filter commands based on search query
 */
export function filterCommands(query: string): SlashCommandItem[] {
  if (!query) return slashCommands;

  const lowerQuery = query.toLowerCase();
  return slashCommands.filter((item) => {
    const titleMatch = item.title.toLowerCase().includes(lowerQuery);
    const descMatch = item.description.toLowerCase().includes(lowerQuery);
    const keywordMatch = item.keywords?.some((k) => k.includes(lowerQuery));
    return titleMatch || descMatch || keywordMatch;
  });
}

/**
 * Adapt a registered plugin command into a slash-menu item. Runs the plugin
 * handler (which manages its own editor access via the PluginAPI); the editor
 * arg is ignored so plugin commands stay decoupled from the editor instance.
 */
export function pluginSlashItem(entry: {
  id: string;
  label: string;
  handler: () => void | Promise<void>;
}): SlashCommandItem {
  return {
    title: entry.label,
    description: 'Plugin command',
    mark: 'Plugin',
    command: () => {
      void entry.handler();
    },
    keywords: ['plugin'],
  };
}

export const SlashCommandList = forwardRef<SlashCommandListRef, SlashCommandListProps>(
  (props, ref) => {
    const [selectedIndex, setSelectedIndex] = useState(0);

    useEffect(() => {
      setSelectedIndex(0);
    }, [props.items]);

    const selectItem = useCallback(
      (index: number) => {
        const item = props.items[index];
        if (item && props.command) {
          props.command(item);
        }
      },
      [props]
    );

    const upHandler = useCallback(() => {
      setSelectedIndex((prev) => (prev + props.items.length - 1) % props.items.length);
    }, [props.items.length]);

    const downHandler = useCallback(() => {
      setSelectedIndex((prev) => (prev + 1) % props.items.length);
    }, [props.items.length]);

    const enterHandler = useCallback(() => {
      selectItem(selectedIndex);
    }, [selectItem, selectedIndex]);

    useImperativeHandle(ref, () => ({
      onKeyDown: (event: KeyboardEvent) => {
        // Nothing to navigate or choose when the filter matched no commands —
        // swallowing Enter here would stop the user starting a new line.
        if (!props.items.length) return false;

        if (event.key === 'ArrowUp') {
          upHandler();
          return true;
        }

        if (event.key === 'ArrowDown') {
          downHandler();
          return true;
        }

        if (event.key === 'Enter') {
          enterHandler();
          return true;
        }

        return false;
      },
    }));

    if (props.items.length === 0) {
      return (
        <div className="slash-command-menu">
          <div className="slash-command-empty">No commands found</div>
        </div>
      );
    }

    return (
      <div className="slash-command-menu">
        <div className="slash-command-header">Commands</div>
        {props.items.map((item, index) => {
          return (
            <button
              key={item.title}
              className={`slash-command-item ${index === selectedIndex ? 'selected' : ''}`}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => selectItem(index)}
              onMouseEnter={() => setSelectedIndex(index)}
            >
              <div className="slash-command-mark" aria-hidden="true">
                {item.mark}
              </div>
              <div className="slash-command-content">
                <div className="slash-command-title">{item.title}</div>
                <div className="slash-command-description">{item.description}</div>
              </div>
            </button>
          );
        })}
      </div>
    );
  }
);

SlashCommandList.displayName = 'SlashCommandList';

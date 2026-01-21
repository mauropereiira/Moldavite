import { forwardRef, useEffect, useImperativeHandle, useState, useCallback } from 'react';
import {
  Heading1,
  Heading2,
  Heading3,
  List,
  ListOrdered,
  CheckSquare,
  Quote,
  Code,
  Minus,
  Image,
  type LucideIcon,
} from 'lucide-react';
import type { Editor } from '@tiptap/react';

export interface SlashCommandItem {
  title: string;
  description: string;
  icon: LucideIcon;
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
    icon: Heading1,
    keywords: ['h1', 'title', 'big'],
    command: (editor) => {
      editor.chain().focus().toggleHeading({ level: 1 }).run();
    },
  },
  {
    title: 'Heading 2',
    description: 'Medium section heading',
    icon: Heading2,
    keywords: ['h2', 'subtitle'],
    command: (editor) => {
      editor.chain().focus().toggleHeading({ level: 2 }).run();
    },
  },
  {
    title: 'Heading 3',
    description: 'Small section heading',
    icon: Heading3,
    keywords: ['h3', 'small'],
    command: (editor) => {
      editor.chain().focus().toggleHeading({ level: 3 }).run();
    },
  },
  {
    title: 'Bullet List',
    description: 'Unordered list with bullets',
    icon: List,
    keywords: ['ul', 'unordered', 'bullets'],
    command: (editor) => {
      editor.chain().focus().toggleBulletList().run();
    },
  },
  {
    title: 'Numbered List',
    description: 'Ordered list with numbers',
    icon: ListOrdered,
    keywords: ['ol', 'ordered', 'numbers'],
    command: (editor) => {
      editor.chain().focus().toggleOrderedList().run();
    },
  },
  {
    title: 'Task List',
    description: 'Checklist with checkboxes',
    icon: CheckSquare,
    keywords: ['todo', 'checkbox', 'check', 'tasks'],
    command: (editor) => {
      editor.chain().focus().toggleTaskList().run();
    },
  },
  {
    title: 'Quote',
    description: 'Blockquote for citations',
    icon: Quote,
    keywords: ['blockquote', 'cite'],
    command: (editor) => {
      editor.chain().focus().toggleBlockquote().run();
    },
  },
  {
    title: 'Code Block',
    description: 'Code with syntax highlighting',
    icon: Code,
    keywords: ['pre', 'syntax', 'programming'],
    command: (editor) => {
      editor.chain().focus().toggleCodeBlock().run();
    },
  },
  {
    title: 'Divider',
    description: 'Horizontal line separator',
    icon: Minus,
    keywords: ['hr', 'horizontal', 'rule', 'line', 'separator'],
    command: (editor) => {
      editor.chain().focus().setHorizontalRule().run();
    },
  },
  {
    title: 'Image',
    description: 'Insert an image',
    icon: Image,
    keywords: ['picture', 'photo', 'img'],
    command: (editor) => {
      // Trigger image upload dialog
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'image/*';
      input.onchange = async (e) => {
        const file = (e.target as HTMLInputElement).files?.[0];
        if (file) {
          const reader = new FileReader();
          reader.onload = () => {
            const src = reader.result as string;
            editor.chain().focus().setImage({ src }).run();
          };
          reader.readAsDataURL(file);
        }
      };
      input.click();
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
          const Icon = item.icon;
          return (
            <button
              key={item.title}
              className={`slash-command-item ${index === selectedIndex ? 'selected' : ''}`}
              onClick={() => selectItem(index)}
              onMouseEnter={() => setSelectedIndex(index)}
            >
              <div className="slash-command-icon">
                <Icon className="w-4 h-4" />
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

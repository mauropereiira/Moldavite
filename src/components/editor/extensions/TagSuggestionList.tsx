import { forwardRef, useEffect, useImperativeHandle, useState } from 'react';
import { Hash } from 'lucide-react';

export interface TagItem {
  name: string;
  count: number;
}

export interface TagSuggestionListProps {
  items: TagItem[];
  command: (item: TagItem) => void;
}

export interface TagSuggestionListRef {
  onKeyDown: (event: KeyboardEvent) => boolean;
}

export const TagSuggestionList = forwardRef<
  TagSuggestionListRef,
  TagSuggestionListProps
>((props, ref) => {
  const [selectedIndex, setSelectedIndex] = useState(0);

  useEffect(() => {
    setSelectedIndex(0);
  }, [props.items]);

  const selectItem = (index: number) => {
    const item = props.items[index];
    if (item && props.command) {
      props.command(item);
    }
  };

  const upHandler = () => {
    setSelectedIndex((selectedIndex + props.items.length - 1) % props.items.length);
  };

  const downHandler = () => {
    setSelectedIndex((selectedIndex + 1) % props.items.length);
  };

  const enterHandler = () => {
    selectItem(selectedIndex);
  };

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
      <div className="wiki-link-suggestions">
        <div className="wiki-link-suggestion-empty">
          No tags yet
        </div>
      </div>
    );
  }

  return (
    <div className="wiki-link-suggestions">
      {props.items.map((item, index) => (
        <button
          key={item.name}
          className={`wiki-link-suggestion-item ${
            index === selectedIndex ? 'selected' : ''
          }`}
          onClick={() => selectItem(index)}
        >
          <div className="wiki-link-suggestion-icon">
            <Hash className="w-4 h-4" />
          </div>
          <div className="wiki-link-suggestion-text">
            <div className="wiki-link-suggestion-title">
              {item.name}
            </div>
            <div className="wiki-link-suggestion-date">
              {item.count} {item.count === 1 ? 'note' : 'notes'}
            </div>
          </div>
        </button>
      ))}
    </div>
  );
});

TagSuggestionList.displayName = 'TagSuggestionList';

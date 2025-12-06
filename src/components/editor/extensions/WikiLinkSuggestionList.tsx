import { forwardRef, useEffect, useImperativeHandle, useState } from 'react';
import { FileText, Calendar } from 'lucide-react';
import type { NoteFile } from '@/types';

export interface WikiLinkSuggestionListProps {
  items: NoteFile[];
  command: (item: NoteFile) => void;
}

export interface WikiLinkSuggestionListRef {
  onKeyDown: (event: KeyboardEvent) => boolean;
}

export const WikiLinkSuggestionList = forwardRef<
  WikiLinkSuggestionListRef,
  WikiLinkSuggestionListProps
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
          No notes found
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
            {item.isDaily ? (
              <Calendar className="w-4 h-4" />
            ) : (
              <FileText className="w-4 h-4" />
            )}
          </div>
          <div className="wiki-link-suggestion-text">
            <div className="wiki-link-suggestion-title">
              {item.name.replace('.md', '')}
            </div>
            {item.isDaily && (
              <div className="wiki-link-suggestion-date">
                Daily note
              </div>
            )}
          </div>
        </button>
      ))}
    </div>
  );
});

WikiLinkSuggestionList.displayName = 'WikiLinkSuggestionList';

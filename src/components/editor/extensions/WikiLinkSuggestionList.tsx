import { forwardRef, useImperativeHandle, useState } from 'react';
import type { NoteFile } from '@/types';
import { slugifyNoteName } from '@/lib/fileSystem';

/** A note to link to, or a note the link will create. */
export type WikiLinkSuggestionItem = { note: NoteFile } | { create: string };

/**
 * The notes whose names contain `query`, then a row to create `query` as a new
 * note when no note already has that name. A phone has no Escape key, so with
 * nothing to link to the list still offers something to tap.
 */
export function wikiLinkSuggestionItems(
  notes: NoteFile[],
  query: string
): WikiLinkSuggestionItem[] {
  const needle = query.toLowerCase();
  const matches = notes
    .filter((note) => note.name.replace('.md', '').toLowerCase().includes(needle))
    .slice(0, 10)
    .map((note) => ({ note }));
  const name = query.trim();
  if (!name || /[[\]|]/.test(name)) return matches;
  const slug = slugifyNoteName(name);
  const taken = notes.some((note) => slugifyNoteName(note.name) === slug);
  return taken ? matches : [...matches, { create: name }];
}

export interface WikiLinkSuggestionListProps {
  items: WikiLinkSuggestionItem[];
  command: (item: WikiLinkSuggestionItem) => void;
}

export interface WikiLinkSuggestionListRef {
  onKeyDown: (event: KeyboardEvent) => boolean;
}

export const WikiLinkSuggestionList = forwardRef<
  WikiLinkSuggestionListRef,
  WikiLinkSuggestionListProps
>((props, ref) => {
  const [selectedIndex, setSelectedIndex] = useState(0);

  // Reset the highlight when the filter yields a new item list. Adjusted
  // during render rather than in an effect, so the first render of the new
  // list never highlights — or lets Enter choose — a row from the old one.
  const [renderedItems, setRenderedItems] = useState<WikiLinkSuggestionItem[]>(props.items);
  if (renderedItems !== props.items) {
    setRenderedItems(props.items);
    setSelectedIndex(0);
  }

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

  /** True when Enter actually selected something, so the caller knows whether
   *  to swallow the key. With no matches the editor must still get its
   *  newline. */
  const enterHandler = () => {
    if (!props.items.length) return false;
    selectItem(selectedIndex);
    return true;
  };

  useImperativeHandle(ref, () => ({
    onKeyDown: (event: KeyboardEvent) => {
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
        return enterHandler();
      }

      return false;
    },
  }));

  if (props.items.length === 0) {
    return (
      <div className="wiki-link-suggestions">
        <div className="wiki-link-suggestion-empty">No notes found</div>
      </div>
    );
  }

  return (
    <div className="wiki-link-suggestions">
      {props.items.map((item, index) => (
        <button
          key={'note' in item ? item.note.name : `create:${item.create}`}
          className={`wiki-link-suggestion-item ${index === selectedIndex ? 'selected' : ''}`}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => selectItem(index)}
        >
          {'note' in item ? (
            <div className="wiki-link-suggestion-text">
              <div className="wiki-link-suggestion-title">{item.note.name.replace('.md', '')}</div>
              {item.note.isDaily && <div className="wiki-link-suggestion-date">Daily note</div>}
            </div>
          ) : (
            <div className="wiki-link-suggestion-text">
              <div className="wiki-link-suggestion-title">Create “{item.create}”</div>
              <div className="wiki-link-suggestion-date">New note</div>
            </div>
          )}
        </button>
      ))}
    </div>
  );
});

WikiLinkSuggestionList.displayName = 'WikiLinkSuggestionList';

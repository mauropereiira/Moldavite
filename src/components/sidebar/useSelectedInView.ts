import { useEffect, useRef } from 'react';

/**
 * Keep the selected option of a listbox in view as the arrow keys move it.
 * The list scrolls inside its own area, so the browser will not follow a
 * selection that never takes focus.
 */
export function useSelectedInView<T extends HTMLElement>(selectedIndex: number) {
  const listRef = useRef<T>(null);
  useEffect(() => {
    listRef.current
      ?.querySelector<HTMLElement>('[aria-selected="true"]')
      ?.scrollIntoView?.({ block: 'nearest' });
  }, [selectedIndex]);
  return listRef;
}

/**
 * Track one element's rendered width.
 *
 * The editor column's width is what decides whether its footer fits, and that
 * width has nothing to do with the window's: the sidebar and right panel are
 * both resizable and both dismissible, so the same window can leave the editor
 * anywhere from a few hundred pixels to the whole screen. A media query would
 * be asking the wrong question.
 */

import { useEffect, useState } from 'react';

/**
 * @param element The node to measure, or `null` before it mounts. Pair it with
 *   a ref callback (`ref={setNode}`) rather than a `useRef` — the state update
 *   is what re-runs the observer when the node changes.
 * @returns Its content-box width, or `null` until the first measurement. Hold
 *   off on a layout decision while it is `null` instead of guessing and
 *   flashing the wrong one.
 */
export function useElementWidth(element: HTMLElement | null): number | null {
  const [width, setWidth] = useState<number | null>(null);

  useEffect(() => {
    if (!element || typeof ResizeObserver === 'undefined') return;
    // ResizeObserver fires once on observe, so the first measurement arrives
    // through the same path as every later one — no separate initial read, and
    // nothing set synchronously during the effect.
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    observer.observe(element);
    return () => observer.disconnect();
  }, [element]);

  return width;
}

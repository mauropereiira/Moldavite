/**
 * Which top-bar tabs fit in the strip and which fold into the Open tabs menu.
 *
 * Tabs are taken in bar order (pinned first) while they fit, so pins keep
 * their place before open tabs. The active tab always stays: when it would
 * fold, tabs before it fold instead, from the end, until it fits. It is kept
 * even when it alone is wider than the strip, since it then shrinks to fit.
 */

export interface FitItem {
  id: string;
  width: number;
  pinned: boolean;
}

export interface FitOptions {
  /** Width of the strip the tabs share. */
  available: number;
  /** Flex gap between tabs. */
  gap: number;
  /** Width of the hairline between the pinned and open groups, gaps included. */
  divider: number;
  activeId: string | null;
}

export interface FitResult {
  visible: string[];
  folded: string[];
}

function rowWidth(items: FitItem[], gap: number, divider: number): number {
  if (items.length === 0) return 0;
  const tabs = items.reduce((sum, item) => sum + item.width, 0) + gap * (items.length - 1);
  const split = items.some((item) => item.pinned) && items.some((item) => !item.pinned);
  return tabs + (split ? divider : 0);
}

export function fitTabs(items: FitItem[], options: FitOptions): FitResult {
  const { available, gap, divider, activeId } = options;
  const shown: FitItem[] = [];
  for (const item of items) {
    if (rowWidth([...shown, item], gap, divider) > available) break;
    shown.push(item);
  }

  const active = items.find((item) => item.id === activeId);
  if (active && !shown.includes(active)) {
    while (shown.length > 0 && rowWidth([...shown, active], gap, divider) > available) {
      shown.pop();
    }
    shown.push(active);
  }

  const visible = new Set(shown.map((item) => item.id));
  return {
    visible: items.filter((item) => visible.has(item.id)).map((item) => item.id),
    folded: items.filter((item) => !visible.has(item.id)).map((item) => item.id),
  };
}

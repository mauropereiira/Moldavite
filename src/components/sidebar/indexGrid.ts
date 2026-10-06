/**
 * Layout of the Index's cards. The Index is fixed to the window: the cards
 * share its height and each list scrolls inside its own card, so the grid's
 * columns and rows are worked out from the measured width rather than left to
 * grow with the longest list.
 */

export const INDEX_CARD_MIN_WIDTH = 240;
/** Matches `.app-index-grid` gap in index.css. */
export const INDEX_GRID_GAP = 24;

/** How many cards fit side by side, never more than there are cards. */
export function indexColumns(width: number, cards: number): number {
  const fit = Math.floor((width + INDEX_GRID_GAP) / (INDEX_CARD_MIN_WIDTH + INDEX_GRID_GAP));
  return Math.max(1, Math.min(fit, cards));
}

/**
 * One track per row of cards. A row whose cards are all folded is only as
 * tall as their bands; the other rows share what is left.
 */
export function indexRows(collapsed: readonly boolean[], columns: number): string {
  const rows: string[] = [];
  for (let start = 0; start < collapsed.length; start += columns) {
    const row = collapsed.slice(start, start + columns);
    rows.push(row.every(Boolean) ? 'auto' : 'minmax(var(--index-card-min-height), 1fr)');
  }
  return rows.join(' ');
}

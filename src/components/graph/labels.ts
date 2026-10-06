/**
 * Greedy label placement on a coarse screen grid: a label is accepted only if
 * its box overlaps no label accepted before it, so callers offer labels in
 * priority order. Each check touches the few cells the box covers, which keeps
 * a frame with hundreds of candidates well under a millisecond.
 */
export function createLabelPlacer(cellSize = 96) {
  const cells = new Map<number, number[]>();
  const boxes: number[] = [];

  const keyOf = (cellX: number, cellY: number) => (cellX + 4_096) * 8_192 + (cellY + 4_096);

  return {
    reset() {
      cells.clear();
      boxes.length = 0;
    },
    /** Accept the box at (x, y) of `width` by `height` unless it overlaps an accepted one. */
    place(x: number, y: number, width: number, height: number): boolean {
      const right = x + width;
      const bottom = y + height;
      const minCellX = Math.floor(x / cellSize);
      const maxCellX = Math.floor(right / cellSize);
      const minCellY = Math.floor(y / cellSize);
      const maxCellY = Math.floor(bottom / cellSize);
      for (let cellX = minCellX; cellX <= maxCellX; cellX++) {
        for (let cellY = minCellY; cellY <= maxCellY; cellY++) {
          const bucket = cells.get(keyOf(cellX, cellY));
          if (!bucket) continue;
          for (const offset of bucket) {
            if (
              x < boxes[offset + 2] &&
              right > boxes[offset] &&
              y < boxes[offset + 3] &&
              bottom > boxes[offset + 1]
            ) {
              return false;
            }
          }
        }
      }
      const offset = boxes.length;
      boxes.push(x, y, right, bottom);
      for (let cellX = minCellX; cellX <= maxCellX; cellX++) {
        for (let cellY = minCellY; cellY <= maxCellY; cellY++) {
          const key = keyOf(cellX, cellY);
          const bucket = cells.get(key);
          if (bucket) bucket.push(offset);
          else cells.set(key, [offset]);
        }
      }
      return true;
    },
  };
}

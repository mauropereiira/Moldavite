import { describe, expect, it } from 'vitest';
import { collisionRadius, initLayout, runLayout, type GraphNode } from './layout';

const nodes = (count: number): GraphNode[] =>
  Array.from({ length: count }, (_, index) => ({
    id: `notes/note-${index}.md`,
    name: `note-${index}`,
  }));

describe('graph layout', () => {
  it('uses a deterministic initial layout', () => {
    expect(initLayout(nodes(20), { seed: 42 })).toEqual(initLayout(nodes(20), { seed: 42 }));
    expect(initLayout(nodes(20), { seed: 42 })).not.toEqual(initLayout(nodes(20), { seed: 7 }));
  });

  it('keeps a stress-vault layout finite and inside its bounds', () => {
    const layout = runLayout(nodes(1_000), [], 50, {
      width: 3_200,
      height: 3_200,
      optimalDistance: 64,
    });
    for (const node of layout) {
      expect(Number.isFinite(node.x)).toBe(true);
      expect(Number.isFinite(node.y)).toBe(true);
      const margin = collisionRadius(node);
      expect(Math.abs(node.x)).toBeLessThanOrEqual(1_600 - margin + 0.001);
      expect(Math.abs(node.y)).toBeLessThanOrEqual(1_600 - margin + 0.001);
    }
  });

  it('separates labels in a typical vault', () => {
    const layout = runLayout(nodes(40), [], 70, {
      width: 1_200,
      height: 1_200,
      optimalDistance: 72,
    });
    for (let index = 0; index < layout.length; index++) {
      for (let otherIndex = index + 1; otherIndex < layout.length; otherIndex++) {
        const a = layout[index];
        const b = layout[otherIndex];
        const distance = Math.hypot(a.x - b.x, a.y - b.y);
        expect(distance).toBeGreaterThanOrEqual((collisionRadius(a) + collisionRadius(b)) * 0.88);
      }
    }
  });
});

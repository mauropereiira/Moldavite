import { describe, expect, it } from 'vitest';
import {
  collisionRadius,
  initLayout,
  runLayout,
  type GraphEdge,
  type GraphNode,
  type LayoutNode,
} from './layout';

const nodes = (count: number): GraphNode[] =>
  Array.from({ length: count }, (_, index) => ({
    id: `notes/note-${index}.md`,
    name: `note-${index}`,
  }));

const meanDistance = (pairs: Array<[LayoutNode, LayoutNode]>): number =>
  pairs.reduce((sum, [a, b]) => sum + Math.hypot(a.x - b.x, a.y - b.y), 0) / pairs.length;

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

  it('coheres linked clusters and keeps orphans at the periphery', () => {
    const clusterCount = 3;
    const clusterSize = 16;
    const orphanCount = 12;
    const fixtureNodes: GraphNode[] = [];
    const edges: GraphEdge[] = [];

    for (let cluster = 0; cluster < clusterCount; cluster++) {
      for (let index = 0; index < clusterSize; index++) {
        fixtureNodes.push({
          id: `cluster-${cluster}/note-${index}.md`,
          name: `Cluster ${cluster + 1} note ${index + 1}`,
        });
        if (index > 0) {
          edges.push({
            source: `cluster-${cluster}/note-${index - 1}.md`,
            target: `cluster-${cluster}/note-${index}.md`,
          });
        }
        if (index >= 3 && index % 3 === 0) {
          edges.push({
            source: `cluster-${cluster}/note-0.md`,
            target: `cluster-${cluster}/note-${index}.md`,
          });
        }
      }
    }
    for (let index = 0; index < orphanCount; index++) {
      fixtureNodes.push({ id: `orphan-${index}.md`, name: `Unlinked note ${index + 1}` });
    }

    const layout = runLayout(fixtureNodes, edges, 180, {
      width: 900,
      height: 900,
      optimalDistance: 72,
    });
    const byId = new Map(layout.map((node) => [node.id, node]));
    const intraPairs: Array<[LayoutNode, LayoutNode]> = [];
    const interPairs: Array<[LayoutNode, LayoutNode]> = [];

    for (let cluster = 0; cluster < clusterCount; cluster++) {
      for (let left = 0; left < clusterSize; left++) {
        for (let right = left + 1; right < clusterSize; right++) {
          intraPairs.push([
            byId.get(`cluster-${cluster}/note-${left}.md`) as LayoutNode,
            byId.get(`cluster-${cluster}/note-${right}.md`) as LayoutNode,
          ]);
        }
      }
    }
    for (let first = 0; first < clusterCount; first++) {
      for (let second = first + 1; second < clusterCount; second++) {
        for (let left = 0; left < clusterSize; left++) {
          for (let right = 0; right < clusterSize; right++) {
            interPairs.push([
              byId.get(`cluster-${first}/note-${left}.md`) as LayoutNode,
              byId.get(`cluster-${second}/note-${right}.md`) as LayoutNode,
            ]);
          }
        }
      }
    }

    const meanIntraClusterDistance = meanDistance(intraPairs);
    const meanInterClusterDistance = meanDistance(interPairs);
    const meanLinkedRadius =
      layout
        .slice(0, clusterCount * clusterSize)
        .reduce((sum, node) => sum + Math.hypot(node.x, node.y), 0) /
      (clusterCount * clusterSize);
    const meanOrphanRadius =
      layout
        .slice(clusterCount * clusterSize)
        .reduce((sum, node) => sum + Math.hypot(node.x, node.y), 0) / orphanCount;

    expect(meanIntraClusterDistance).toBeLessThan(meanInterClusterDistance * 0.55);
    expect(meanOrphanRadius).toBeGreaterThan(meanLinkedRadius * 1.45);
  });
});

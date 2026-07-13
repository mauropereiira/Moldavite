/**
 * Deterministic, bounded force-directed layout for the graph canvas.
 *
 * Linked components start in separate inner regions and are held together by
 * edge springs plus light component gravity. Unlinked notes receive stable
 * targets in the outer annulus. A spatial grid limits repulsion and label
 * collision work to nearby nodes, keeping each iteration close to O(V + E).
 */

export interface GraphNode {
  id: string;
  name: string;
  isMissing?: boolean;
}

export interface GraphEdge {
  source: string;
  target: string;
}

export interface LayoutNode extends GraphNode {
  x: number;
  y: number;
  vx: number;
  vy: number;
}

export interface LayoutOptions {
  width?: number;
  height?: number;
  optimalDistance?: number;
  initialTemperature?: number;
  cooling?: number;
  seed?: number;
}

export interface LayoutStepOptions {
  /** Keep this node under the pointer while its forces continue affecting peers. */
  pinnedNodeId?: string | null;
}

export const FORCE_CONSTANTS = {
  springStrength: 0.085,
  repulsionStrength: 180,
  repulsionRangeMultiplier: 3.2,
  collisionStrength: 0.24,
  componentGravity: 0.014,
  componentAnchorStrength: 0.0025,
  orphanAnchorStrength: 0.055,
  velocityDamping: 0.72,
} as const;

const DEFAULTS: Required<LayoutOptions> = {
  width: 1000,
  height: 1000,
  optimalDistance: 72,
  initialTemperature: 28,
  cooling: 0.965,
  seed: 1,
};

interface ComponentTopology {
  indices: number[];
  anchorX: number;
  anchorY: number;
}

interface NodeTopology {
  componentIndex: number | null;
  targetX: number;
  targetY: number;
}

interface LayoutTopology {
  components: ComponentTopology[];
  nodes: NodeTopology[];
}

const topologyCache = new WeakMap<LayoutNode[], LayoutTopology>();
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

/** Approximate half-width occupied by a node and its 11px canvas label. */
export function collisionRadius(node: Pick<GraphNode, 'name'>): number {
  return Math.min(90, Math.max(16, 10 + node.name.length * 2.8));
}

function componentAnchors(
  count: number,
  options: Required<LayoutOptions>
): Array<{ x: number; y: number }> {
  if (count <= 1) return [{ x: 0, y: 0 }].slice(0, count);
  const phase = (options.seed % 360) * (Math.PI / 180);
  const radius = Math.min(
    Math.min(options.width, options.height) * 0.23,
    options.optimalDistance * Math.max(1.7, count * 0.85)
  );
  return Array.from({ length: count }, (_, index) => {
    const angle = phase + (index * Math.PI * 2) / count;
    return { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius };
  });
}

function orphanTargets(
  orphanIndices: number[],
  nodes: GraphNode[],
  options: Required<LayoutOptions>
): Map<number, { x: number; y: number }> {
  const targets = new Map<number, { x: number; y: number }>();
  if (orphanIndices.length === 0) return targets;

  const maxRadius = Math.max(...orphanIndices.map((index) => collisionRadius(nodes[index])));
  const outerRadius = Math.max(
    options.optimalDistance,
    Math.min(options.width, options.height) / 2 - maxRadius - 20
  );
  const spacing = options.optimalDistance * 1.12;
  const phase = (options.seed % 360) * (Math.PI / 180);
  let assigned = 0;
  let ring = 0;

  while (assigned < orphanIndices.length) {
    const radius = Math.max(options.optimalDistance, outerRadius - ring * spacing);
    const capacity = Math.max(1, Math.floor((Math.PI * 2 * radius) / spacing));
    const count = Math.min(capacity, orphanIndices.length - assigned);
    for (let slot = 0; slot < count; slot++) {
      const angle = phase + (slot * Math.PI * 2) / count + ring * GOLDEN_ANGLE;
      targets.set(orphanIndices[assigned + slot], {
        x: Math.cos(angle) * radius,
        y: Math.sin(angle) * radius,
      });
    }
    assigned += count;
    ring += 1;
  }
  return targets;
}

function buildTopology(
  nodes: GraphNode[],
  edges: GraphEdge[],
  options: Required<LayoutOptions>
): LayoutTopology {
  const indexById = new Map(nodes.map((node, index) => [node.id, index]));
  const adjacency = Array.from({ length: nodes.length }, () => [] as number[]);
  for (const edge of edges) {
    const source = indexById.get(edge.source);
    const target = indexById.get(edge.target);
    if (source === undefined || target === undefined || source === target) continue;
    adjacency[source].push(target);
    adjacency[target].push(source);
  }

  const componentIndices: number[][] = [];
  const orphanIndices: number[] = [];
  const visited = new Set<number>();
  for (let index = 0; index < nodes.length; index++) {
    if (visited.has(index)) continue;
    if (adjacency[index].length === 0) {
      visited.add(index);
      orphanIndices.push(index);
      continue;
    }
    const component: number[] = [];
    const stack = [index];
    visited.add(index);
    while (stack.length > 0) {
      const current = stack.pop() as number;
      component.push(current);
      for (const neighbor of adjacency[current]) {
        if (visited.has(neighbor)) continue;
        visited.add(neighbor);
        stack.push(neighbor);
      }
    }
    componentIndices.push(component);
  }

  const anchors = componentAnchors(componentIndices.length, options);
  const components = componentIndices.map((indices, index) => ({
    indices,
    anchorX: anchors[index].x,
    anchorY: anchors[index].y,
  }));
  const orphanTargetByIndex = orphanTargets(orphanIndices, nodes, options);
  const nodeTopology: NodeTopology[] = nodes.map(() => ({
    componentIndex: null,
    targetX: 0,
    targetY: 0,
  }));

  components.forEach((component, componentIndex) => {
    for (const index of component.indices) {
      nodeTopology[index] = {
        componentIndex,
        targetX: component.anchorX,
        targetY: component.anchorY,
      };
    }
  });
  for (const [index, target] of orphanTargetByIndex) {
    nodeTopology[index] = { componentIndex: null, targetX: target.x, targetY: target.y };
  }

  return { components, nodes: nodeTopology };
}

/**
 * Place linked components deterministically in the center and true orphans in
 * the outer annulus. The optional edge list should match later layout steps.
 */
export function initLayout(
  nodes: GraphNode[],
  options: LayoutOptions = {},
  edges: GraphEdge[] = []
): LayoutNode[] {
  const opts = { ...DEFAULTS, ...options };
  if (nodes.length === 0) return [];
  const topology = buildTopology(nodes, edges, opts);
  const phase = (opts.seed % 360) * (Math.PI / 180);
  const localIndex = new Map<number, number>();
  for (const component of topology.components) {
    component.indices.forEach((nodeIndex, index) => localIndex.set(nodeIndex, index));
  }

  const layoutNodes = nodes.map((node, index) => {
    const nodeTopology = topology.nodes[index];
    if (nodeTopology.componentIndex === null) {
      return {
        ...node,
        x: nodeTopology.targetX,
        y: nodeTopology.targetY,
        vx: 0,
        vy: 0,
      };
    }

    const memberIndex = localIndex.get(index) ?? 0;
    const component = topology.components[nodeTopology.componentIndex];
    if (component.indices.length === 1) {
      return { ...node, x: component.anchorX, y: component.anchorY, vx: 0, vy: 0 };
    }
    const radius = opts.optimalDistance * 0.42 * Math.sqrt(memberIndex + 0.35);
    const angle = phase + memberIndex * GOLDEN_ANGLE;
    return {
      ...node,
      x: component.anchorX + Math.cos(angle) * radius,
      y: component.anchorY + Math.sin(angle) * radius,
      vx: 0,
      vy: 0,
    };
  });
  topologyCache.set(layoutNodes, topology);
  return layoutNodes;
}

/**
 * Run one in-place force iteration. Repulsion and label collisions only inspect
 * nearby spatial-grid cells; springs are evaluated once per graph edge.
 */
export function stepLayout(
  layoutNodes: LayoutNode[],
  edges: GraphEdge[],
  temperature: number,
  options: LayoutOptions = {},
  stepOptions: LayoutStepOptions = {}
): void {
  if (layoutNodes.length === 0) return;
  const opts = { ...DEFAULTS, ...options };
  let topology = topologyCache.get(layoutNodes);
  if (!topology) {
    topology = buildTopology(layoutNodes, edges, opts);
    topologyCache.set(layoutNodes, topology);
  }

  const forces = layoutNodes.map(() => ({ x: 0, y: 0 }));
  const byId = new Map<string, number>();
  const repulsionRange = opts.optimalDistance * FORCE_CONSTANTS.repulsionRangeMultiplier;
  const cellSize = repulsionRange;
  const grid = new Map<string, number[]>();

  for (let index = 0; index < layoutNodes.length; index++) {
    const node = layoutNodes[index];
    byId.set(node.id, index);
    const key = `${Math.floor(node.x / cellSize)},${Math.floor(node.y / cellSize)}`;
    const bucket = grid.get(key);
    if (bucket) bucket.push(index);
    else grid.set(key, [index]);
  }

  for (let index = 0; index < layoutNodes.length; index++) {
    const node = layoutNodes[index];
    const cellX = Math.floor(node.x / cellSize);
    const cellY = Math.floor(node.y / cellSize);
    for (let offsetX = -1; offsetX <= 1; offsetX++) {
      for (let offsetY = -1; offsetY <= 1; offsetY++) {
        const bucket = grid.get(`${cellX + offsetX},${cellY + offsetY}`);
        if (!bucket) continue;
        for (const otherIndex of bucket) {
          if (otherIndex <= index) continue;
          const other = layoutNodes[otherIndex];
          let dx = node.x - other.x;
          let dy = node.y - other.y;
          let distance = Math.hypot(dx, dy);
          if (distance < 0.001) {
            const angle = ((index + 1) * 97 + (otherIndex + 1) * 53) % 360;
            dx = Math.cos((angle * Math.PI) / 180);
            dy = Math.sin((angle * Math.PI) / 180);
            distance = 1;
          }
          if (distance > repulsionRange) continue;

          const minimum = collisionRadius(node) + collisionRadius(other);
          const repulsion = FORCE_CONSTANTS.repulsionStrength / Math.max(distance, 12);
          const collision =
            distance < minimum ? (minimum - distance) * FORCE_CONSTANTS.collisionStrength + 0.8 : 0;
          const force = repulsion + collision;
          const fx = (dx / distance) * force;
          const fy = (dy / distance) * force;
          forces[index].x += fx;
          forces[index].y += fy;
          forces[otherIndex].x -= fx;
          forces[otherIndex].y -= fy;
        }
      }
    }
  }

  for (const edge of edges) {
    const sourceIndex = byId.get(edge.source);
    const targetIndex = byId.get(edge.target);
    if (sourceIndex === undefined || targetIndex === undefined || sourceIndex === targetIndex) {
      continue;
    }
    const source = layoutNodes[sourceIndex];
    const target = layoutNodes[targetIndex];
    const dx = target.x - source.x;
    const dy = target.y - source.y;
    const distance = Math.max(0.001, Math.hypot(dx, dy));
    const force = (distance - opts.optimalDistance) * FORCE_CONSTANTS.springStrength;
    const fx = (dx / distance) * force;
    const fy = (dy / distance) * force;
    forces[sourceIndex].x += fx;
    forces[sourceIndex].y += fy;
    forces[targetIndex].x -= fx;
    forces[targetIndex].y -= fy;
  }

  for (const component of topology.components) {
    let centerX = 0;
    let centerY = 0;
    for (const index of component.indices) {
      centerX += layoutNodes[index].x;
      centerY += layoutNodes[index].y;
    }
    centerX /= component.indices.length;
    centerY /= component.indices.length;
    for (const index of component.indices) {
      const node = layoutNodes[index];
      forces[index].x += (centerX - node.x) * FORCE_CONSTANTS.componentGravity;
      forces[index].y += (centerY - node.y) * FORCE_CONSTANTS.componentGravity;
      forces[index].x += (component.anchorX - centerX) * FORCE_CONSTANTS.componentAnchorStrength;
      forces[index].y += (component.anchorY - centerY) * FORCE_CONSTANTS.componentAnchorStrength;
    }
  }

  for (let index = 0; index < layoutNodes.length; index++) {
    const nodeTopology = topology.nodes[index];
    if (nodeTopology.componentIndex !== null) continue;
    const node = layoutNodes[index];
    forces[index].x += (nodeTopology.targetX - node.x) * FORCE_CONSTANTS.orphanAnchorStrength;
    forces[index].y += (nodeTopology.targetY - node.y) * FORCE_CONSTANTS.orphanAnchorStrength;
  }

  const halfWidth = opts.width / 2;
  const halfHeight = opts.height / 2;
  for (let index = 0; index < layoutNodes.length; index++) {
    const node = layoutNodes[index];
    if (node.id === stepOptions.pinnedNodeId) {
      node.vx = 0;
      node.vy = 0;
      continue;
    }
    node.vx = (node.vx + forces[index].x) * FORCE_CONSTANTS.velocityDamping;
    node.vy = (node.vy + forces[index].y) * FORCE_CONSTANTS.velocityDamping;
    const speed = Math.hypot(node.vx, node.vy);
    if (speed > temperature && speed > 0) {
      node.vx = (node.vx / speed) * temperature;
      node.vy = (node.vy / speed) * temperature;
    }
    node.x += node.vx;
    node.y += node.vy;

    const margin = collisionRadius(node);
    const minX = -halfWidth + margin;
    const maxX = halfWidth - margin;
    const minY = -halfHeight + margin;
    const maxY = halfHeight - margin;
    if (node.x < minX || node.x > maxX) node.vx = 0;
    if (node.y < minY || node.y > maxY) node.vy = 0;
    node.x = Math.max(minX, Math.min(maxX, node.x));
    node.y = Math.max(minY, Math.min(maxY, node.y));
  }
}

export function runLayout(
  nodes: GraphNode[],
  edges: GraphEdge[],
  iterations: number,
  options: LayoutOptions = {}
): LayoutNode[] {
  const opts = { ...DEFAULTS, ...options };
  const layoutNodes = initLayout(nodes, opts, edges);
  let temperature = opts.initialTemperature;
  for (let index = 0; index < iterations; index++) {
    stepLayout(layoutNodes, edges, temperature, opts);
    temperature *= opts.cooling;
  }
  return layoutNodes;
}

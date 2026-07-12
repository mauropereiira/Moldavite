/**
 * Deterministic, bounded force layout for the graph canvas.
 *
 * Nodes start on a golden-angle spiral instead of at random positions. Each
 * step uses a spatial grid for label collision, making repulsion near-linear
 * rather than O(n²) at stress-vault scale.
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

const DEFAULTS: Required<LayoutOptions> = {
  width: 1000,
  height: 1000,
  optimalDistance: 72,
  initialTemperature: 28,
  cooling: 0.9,
  seed: 1,
};

const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

/** Approximate half-width occupied by a node and its 11px canvas label. */
export function collisionRadius(node: Pick<GraphNode, 'name'>): number {
  return Math.min(90, Math.max(16, 10 + node.name.length * 2.8));
}

export function initLayout(nodes: GraphNode[], options: LayoutOptions = {}): LayoutNode[] {
  const opts = { ...DEFAULTS, ...options };
  if (nodes.length === 0) return [];

  const availableRadius = Math.max(
    opts.optimalDistance,
    Math.min(opts.width, opts.height) / 2 - opts.optimalDistance
  );
  const desiredRadius = Math.min(
    availableRadius,
    Math.max(opts.optimalDistance, Math.sqrt(nodes.length) * opts.optimalDistance * 0.65)
  );
  const phase = (opts.seed % 360) * (Math.PI / 180);

  return nodes.map((node, index) => {
    if (nodes.length === 1) return { ...node, x: 0, y: 0, vx: 0, vy: 0 };
    const radius = desiredRadius * Math.sqrt((index + 0.5) / nodes.length);
    const angle = phase + index * GOLDEN_ANGLE;
    return {
      ...node,
      x: Math.cos(angle) * radius,
      y: Math.sin(angle) * radius,
      vx: 0,
      vy: 0,
    };
  });
}

/**
 * Run one in-place force iteration. Label collisions are limited to nearby
 * spatial-grid cells, while springs are evaluated once per graph edge.
 */
export function stepLayout(
  layoutNodes: LayoutNode[],
  edges: GraphEdge[],
  temperature: number,
  options: LayoutOptions = {}
): void {
  if (layoutNodes.length === 0) return;
  const opts = { ...DEFAULTS, ...options };
  const cellSize = 180;
  const grid = new Map<string, number[]>();
  const byId = new Map<string, LayoutNode>();

  for (let index = 0; index < layoutNodes.length; index++) {
    const node = layoutNodes[index];
    node.vx = -node.x * 0.006;
    node.vy = -node.y * 0.006;
    byId.set(node.id, node);
    const cellX = Math.floor(node.x / cellSize);
    const cellY = Math.floor(node.y / cellSize);
    const key = `${cellX},${cellY}`;
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
          const minimum = collisionRadius(node) + collisionRadius(other);
          if (distance >= minimum) continue;
          const force = (minimum - distance) * 0.35 + 0.5;
          const fx = (dx / distance) * force;
          const fy = (dy / distance) * force;
          node.vx += fx;
          node.vy += fy;
          other.vx -= fx;
          other.vy -= fy;
        }
      }
    }
  }

  for (const edge of edges) {
    const source = byId.get(edge.source);
    const target = byId.get(edge.target);
    if (!source || !target) continue;
    const dx = target.x - source.x;
    const dy = target.y - source.y;
    const distance = Math.max(0.001, Math.hypot(dx, dy));
    const force = (distance - opts.optimalDistance) * 0.025;
    const fx = (dx / distance) * force;
    const fy = (dy / distance) * force;
    source.vx += fx;
    source.vy += fy;
    target.vx -= fx;
    target.vy -= fy;
  }

  const halfWidth = opts.width / 2;
  const halfHeight = opts.height / 2;
  for (const node of layoutNodes) {
    const magnitude = Math.hypot(node.vx, node.vy);
    if (magnitude > 0) {
      const displacement = Math.min(magnitude, temperature);
      node.x += (node.vx / magnitude) * displacement;
      node.y += (node.vy / magnitude) * displacement;
    }
    const margin = collisionRadius(node);
    node.x = Math.max(-halfWidth + margin, Math.min(halfWidth - margin, node.x));
    node.y = Math.max(-halfHeight + margin, Math.min(halfHeight - margin, node.y));
  }
}

export function runLayout(
  nodes: GraphNode[],
  edges: GraphEdge[],
  iterations: number,
  options: LayoutOptions = {}
): LayoutNode[] {
  const opts = { ...DEFAULTS, ...options };
  const layoutNodes = initLayout(nodes, opts);
  let temperature = opts.initialTemperature;
  for (let index = 0; index < iterations; index++) {
    stepLayout(layoutNodes, edges, temperature, opts);
    temperature *= opts.cooling;
  }
  return layoutNodes;
}

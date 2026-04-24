/**
 * Minimal Fruchterman–Reingold-style force-directed layout.
 *
 * No external graph library — this is ~100 LoC of vanilla math that runs
 * a fixed number of simulation iterations (or you can step it frame by
 * frame). Good enough for graphs up to a few thousand nodes; larger
 * graphs would need a quadtree approximation.
 *
 * Coordinate system: the simulation runs in an arbitrary unit box; the
 * caller is responsible for panning / zooming when rendering.
 */

export interface GraphNode {
  id: string;
  name: string;
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
  /** Bounds of the simulation box (logical units, not pixels). */
  width?: number;
  height?: number;
  /** Optimal edge length; drives both attraction and repulsion scales. */
  optimalDistance?: number;
  /** Initial temperature (max per-tick displacement). */
  initialTemperature?: number;
  /** Multiplier applied to temperature each tick (cooling schedule). */
  cooling?: number;
  /** RNG seed for deterministic initial placement. */
  seed?: number;
}

const DEFAULTS: Required<LayoutOptions> = {
  width: 1000,
  height: 1000,
  optimalDistance: 80,
  initialTemperature: 100,
  cooling: 0.95,
  seed: 1,
};

/**
 * Tiny seeded PRNG (mulberry32). We only need reproducible placement, not
 * crypto-quality randomness, so this is fine.
 */
function makeRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function initLayout(
  nodes: GraphNode[],
  options: LayoutOptions = {},
): LayoutNode[] {
  const opts = { ...DEFAULTS, ...options };
  const rng = makeRng(opts.seed);
  return nodes.map((n) => ({
    ...n,
    x: rng() * opts.width - opts.width / 2,
    y: rng() * opts.height - opts.height / 2,
    vx: 0,
    vy: 0,
  }));
}

/**
 * Run a single Fruchterman–Reingold iteration in place. Repulsion is
 * pairwise O(n²); attraction is O(|E|). The caller should call this once
 * per animation frame with a monotonically decreasing `temperature`.
 */
export function stepLayout(
  layoutNodes: LayoutNode[],
  edges: GraphEdge[],
  temperature: number,
  options: LayoutOptions = {},
): void {
  const opts = { ...DEFAULTS, ...options };
  const k = opts.optimalDistance;
  const kSq = k * k;

  // Repulsion: every node pushes every other node apart.
  for (let i = 0; i < layoutNodes.length; i++) {
    const a = layoutNodes[i];
    a.vx = 0;
    a.vy = 0;
    for (let j = 0; j < layoutNodes.length; j++) {
      if (i === j) continue;
      const b = layoutNodes[j];
      let dx = a.x - b.x;
      let dy = a.y - b.y;
      let distSq = dx * dx + dy * dy;
      if (distSq < 0.01) {
        // Coincident — nudge slightly so the force is defined.
        dx = (Math.random() - 0.5) * 0.1;
        dy = (Math.random() - 0.5) * 0.1;
        distSq = dx * dx + dy * dy;
      }
      const dist = Math.sqrt(distSq);
      const force = kSq / dist;
      a.vx += (dx / dist) * force;
      a.vy += (dy / dist) * force;
    }
  }

  // Attraction: endpoints of each edge pull together.
  const byId = new Map<string, LayoutNode>();
  for (const n of layoutNodes) byId.set(n.id, n);
  for (const edge of edges) {
    const a = byId.get(edge.source);
    const b = byId.get(edge.target);
    if (!a || !b) continue;
    const dx = a.x - b.x;
    const dy = a.y - b.y;
    const distSq = dx * dx + dy * dy;
    if (distSq < 0.01) continue;
    const dist = Math.sqrt(distSq);
    const force = (dist * dist) / k;
    const fx = (dx / dist) * force;
    const fy = (dy / dist) * force;
    a.vx -= fx;
    a.vy -= fy;
    b.vx += fx;
    b.vy += fy;
  }

  // Apply velocities clamped to temperature.
  for (const n of layoutNodes) {
    const mag = Math.sqrt(n.vx * n.vx + n.vy * n.vy) || 1;
    const capped = Math.min(mag, temperature);
    n.x += (n.vx / mag) * capped;
    n.y += (n.vy / mag) * capped;
    // Clamp to the bounding box with soft margin so nothing flies off.
    const w2 = opts.width / 2;
    const h2 = opts.height / 2;
    n.x = Math.max(-w2, Math.min(w2, n.x));
    n.y = Math.max(-h2, Math.min(h2, n.y));
  }
}

/**
 * Convenience wrapper — runs `iterations` simulation steps with an
 * exponential cooling schedule. Useful for one-shot layout without an
 * animation loop (e.g. in tests).
 */
export function runLayout(
  nodes: GraphNode[],
  edges: GraphEdge[],
  iterations: number,
  options: LayoutOptions = {},
): LayoutNode[] {
  const opts = { ...DEFAULTS, ...options };
  const layoutNodes = initLayout(nodes, opts);
  let temperature = opts.initialTemperature;
  for (let i = 0; i < iterations; i++) {
    stepLayout(layoutNodes, edges, temperature, opts);
    temperature *= opts.cooling;
  }
  return layoutNodes;
}

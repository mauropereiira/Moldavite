/**
 * Canvas-level behaviour tests for the graph view.
 *
 * jsdom has no 2D context, so a recording stub stands in for one: every frame's
 * `arc()` calls are the stars, every `moveTo`/`lineTo` pair is a link and every
 * `fillText` a label. Stars are filled in batches, so each arc also records the
 * opacity it was filled at. That makes the drawn viewport observable, which is
 * the only way to assert on panning, fitting, hover and the entrance from the
 * outside.
 */
import { Profiler } from 'react';
import { act, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useGraphStore, useNoteStore, useOverlayStore } from '@/stores';
import type { GraphEdge, GraphNode } from './layout';
import { GraphView } from './GraphView';

const fixture = vi.hoisted(() => {
  const nodes = [
    { id: 'notes/hub.md', name: 'Hub' },
    { id: 'notes/a.md', name: 'A' },
    { id: 'notes/b.md', name: 'B' },
    { id: 'notes/c.md', name: 'C' },
    { id: 'notes/d.md', name: 'D' },
    { id: 'notes/e.md', name: 'E' },
  ];
  const small = {
    nodes,
    edges: nodes.slice(1).map((node) => ({ source: 'notes/hub.md', target: node.id })),
  };
  return { small, graph: small as { nodes: GraphNode[]; edges: GraphEdge[] } };
});

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(async (command: string) => {
    if (command === 'get_note_graph') return fixture.graph;
    if (command === 'list_notes') return [];
    return undefined;
  }),
}));

const VIEWPORT = { width: 1200, height: 800 };

interface Point {
  x: number;
  y: number;
}
interface Star extends Point {
  r: number;
  alpha?: number;
}
interface Label extends Point {
  text: string;
  alpha: number;
}

let arcs: Star[] = [];
let points: Point[] = [];
let labels: Label[] = [];
let fills = 0;
let pathArcs: Star[] = [];
let frames = new Map<number, (time: number) => void>();
let nextFrameId = 1;
let clock = 0;

const context = {
  setTransform: vi.fn(),
  clearRect: vi.fn(),
  beginPath: vi.fn(() => {
    pathArcs = [];
  }),
  moveTo: vi.fn((x: number, y: number) => points.push({ x, y })),
  lineTo: vi.fn((x: number, y: number) => points.push({ x, y })),
  stroke: vi.fn(() => {
    for (const star of pathArcs) star.alpha = context.globalAlpha;
  }),
  fill: vi.fn(() => {
    fills++;
    for (const star of pathArcs) star.alpha = context.globalAlpha;
  }),
  arc: vi.fn((x: number, y: number, r: number) => {
    const star = { x, y, r };
    arcs.push(star);
    pathArcs.push(star);
  }),
  fillText: vi.fn((text: string, x: number, y: number) =>
    labels.push({ text, x, y, alpha: context.globalAlpha })
  ),
  strokeText: vi.fn(),
  measureText: vi.fn((text: string) => ({ width: text.length * 6 })),
  font: '',
  fillStyle: '',
  strokeStyle: '',
  lineWidth: 1,
  lineJoin: '',
  globalAlpha: 1,
  textBaseline: '',
};

// jsdom implements neither pointer capture nor canvas.
Object.assign(HTMLElement.prototype, {
  setPointerCapture: () => undefined,
  releasePointerCapture: () => undefined,
  hasPointerCapture: () => false,
});

function setReducedMotion(matches: boolean) {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));
}

/** Run `count` animation frames at a fixed 16ms cadence. */
function runFrames(count: number) {
  for (let index = 0; index < count; index++) {
    const pending = [...frames.values()];
    frames.clear();
    clock += 16;
    act(() => {
      for (const callback of pending) callback(clock);
    });
  }
}

/** Run frames until the view stops asking for them; returns how many it took. */
function runUntilIdle(limit = 600) {
  let ran = 0;
  while (frames.size > 0 && ran < limit) {
    runFrames(1);
    ran++;
  }
  return ran;
}

interface Frame {
  arcs: Star[];
  points: Point[];
  labels: Label[];
  fills: number;
}

/**
 * Draw exactly one frame and return what was painted. A still graph requests
 * no frames, so then a resize stands in: it repaints synchronously.
 */
function drawFrame(): Frame {
  arcs = [];
  points = [];
  labels = [];
  fills = 0;
  const idle = frames.size === 0;
  if (idle) act(() => void window.dispatchEvent(new Event('resize')));
  if (!idle || arcs.length === 0) runFrames(1);
  const frame = { arcs: [...arcs], points: [...points], labels: [...labels], fills };
  if (idle) runUntilIdle();
  return frame;
}

async function openGraph(wrap: (view: React.ReactElement) => React.ReactElement = (v) => v) {
  clock = 0;
  useGraphStore.getState().open();
  const view = render(wrap(<GraphView />));
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
  const canvas = view.container.querySelector('canvas') as HTMLCanvasElement;
  return { ...view, canvas };
}

/** Settle the force layout, then re-frame so each case starts from the same view. */
function settleAndFit(view: { container: HTMLElement }) {
  runFrames(200);
  const fit = view.container.querySelector('button[title^="Fit"]') as HTMLButtonElement;
  fireEvent.click(fit);
  runUntilIdle();
}

function pan(canvas: HTMLCanvasElement, deltaX: number, deltaY: number) {
  fireEvent.pointerDown(canvas, { pointerId: 1, button: 0, clientX: 60, clientY: 60 });
  fireEvent.pointerMove(canvas, { pointerId: 1, clientX: 60 + deltaX, clientY: 60 + deltaY });
  fireEvent.pointerUp(canvas, { pointerId: 1 });
}

const byPosition = (stars: Star[]) =>
  stars.map(({ x, y }) => ({ x, y })).sort((a, b) => a.x - b.x || a.y - b.y);

function nearest(stars: Star[], to: Point): Star {
  return stars.reduce((best, star) =>
    Math.hypot(star.x - to.x, star.y - to.y) < Math.hypot(best.x - to.x, best.y - to.y)
      ? star
      : best
  );
}

/** Each named star's painted position, found from its label beside it. */
function starsByName(frame: Frame): Map<string, Star> {
  const result = new Map<string, Star>();
  for (const label of frame.labels) {
    const candidates = frame.arcs.filter(
      (star) => Math.abs(star.y - label.y) < 0.01 && star.x < label.x
    );
    if (candidates.length > 0) result.set(label.text, nearest(candidates, label));
  }
  return result;
}

function hover(canvas: HTMLCanvasElement, at: Point) {
  fireEvent.pointerMove(canvas, { pointerId: 9, clientX: at.x, clientY: at.y });
}

function largeGraph(count: number): { nodes: GraphNode[]; edges: GraphEdge[] } {
  const nodes = Array.from({ length: count }, (_, index) => ({
    id: `notes/n${index}.md`,
    name: `Note number ${index}`,
  }));
  const edges: GraphEdge[] = [];
  for (let index = 1; index < count * 0.9; index++) {
    edges.push({ source: nodes[index].id, target: nodes[index % 50].id });
    if (index % 3 === 0) edges.push({ source: nodes[index].id, target: nodes[index - 1].id });
  }
  return { nodes, edges };
}

describe('GraphView canvas', () => {
  beforeEach(() => {
    setReducedMotion(false);
    fixture.graph = fixture.small;
    arcs = [];
    points = [];
    labels = [];
    frames = new Map();
    nextFrameId = 1;
    clock = 0;
    useNoteStore.setState({ notes: [], currentNote: null });
    vi.stubGlobal('requestAnimationFrame', (callback: (time: number) => void) => {
      const id = nextFrameId++;
      frames.set(id, callback);
      return id;
    });
    vi.stubGlobal('cancelAnimationFrame', (id: number) => {
      frames.delete(id);
    });
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(
      context as unknown as CanvasRenderingContext2D
    );
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      ...VIEWPORT,
      top: 0,
      left: 0,
      right: VIEWPORT.width,
      bottom: VIEWPORT.height,
      x: 0,
      y: 0,
      toJSON: () => undefined,
    } as DOMRect);
  });

  afterEach(() => {
    useOverlayStore.setState({ activeOverlay: null });
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  // The icon rail sits in normal flow at z-10000, so a `fixed inset-0`
  // surface is painted underneath it and loses its first 48px — which is how
  // the heading shipped reading ".ph" in 2.0.0. The offsets have to come from
  // the rail insets rather than a hardcoded 48, or the graph leaves a dead
  // strip when the rail is switched off, hidden by focus mode, or on the
  // other edge.
  it('starts clear of the icon rail, and reclaims the space when it is gone', async () => {
    const view = await openGraph();
    const surface = view.container.querySelector('[aria-labelledby="graph-view-title"]');
    expect(surface).not.toBeNull();
    expect((surface as HTMLElement).style.left).toBe('var(--rail-inset-left)');
    expect((surface as HTMLElement).style.right).toBe('var(--rail-inset-right)');
  });

  it('pans freely past the old visible-margin clamp', async () => {
    const view = await openGraph();
    settleAndFit(view);

    const before = drawFrame();
    expect(before.points.length).toBeGreaterThan(0);
    pan(view.canvas, 3_000, 2_000);
    const after = drawFrame();

    // The old clamp capped the pan at roughly half a viewport plus the layout
    // bounds, so the field could never leave the screen.
    expect(after.points[0].x - before.points[0].x).toBeCloseTo(3_000, 0);
    expect(after.points[0].y - before.points[0].y).toBeCloseTo(2_000, 0);
  });

  it('does not re-fit the view when only the hovered node changes', async () => {
    const view = await openGraph();
    settleAndFit(view);
    pan(view.canvas, 300, 200);

    const before = drawFrame();
    expect(before.arcs.length).toBeGreaterThan(0);

    hover(view.canvas, before.arcs[0]);
    const after = drawFrame();

    expect(byPosition(after.arcs)).toEqual(byPosition(before.arcs));
    // …and the hover really did land, so the assertion above is not vacuous.
    expect(nearest(after.arcs, before.arcs[0]).r).toBeGreaterThan(before.arcs[0].r);
  });

  // The flicker Mauro reported. Hover lived in React state, so every star the
  // pointer crossed re-rendered the view, tore down its frame loop and reset
  // the canvas bitmap before drawing the next frame.
  it('hovers without re-rendering, clearing the canvas or reheating the layout', async () => {
    let commits = 0;
    const view = await openGraph((graph) => (
      <Profiler id="graph" onRender={() => commits++}>
        {graph}
      </Profiler>
    ));
    settleAndFit(view);
    let resets = 0;
    for (const dimension of ['width', 'height'] as const) {
      const native = Object.getOwnPropertyDescriptor(HTMLCanvasElement.prototype, dimension);
      Object.defineProperty(view.canvas, dimension, {
        configurable: true,
        get() {
          return native?.get?.call(this);
        },
        set(value) {
          resets++;
          native?.set?.call(this, value);
        },
      });
    }
    const before = drawFrame();
    commits = 0;

    for (const star of before.arcs) {
      hover(view.canvas, star);
      runFrames(2);
    }
    hover(view.canvas, { x: 2, y: 2 });
    const ran = runUntilIdle();
    const after = drawFrame();

    expect(commits).toBe(0);
    expect(resets).toBe(0);
    expect(byPosition(after.arcs)).toEqual(byPosition(before.arcs));
    // The fade settles and the loop stops: nothing reheated the simulation.
    expect(ran).toBeLessThan(60);
    expect(frames.size).toBe(0);
  });

  it('keeps the field dimmed while the pointer crosses the gap between two stars', async () => {
    const view = await openGraph();
    settleAndFit(view);
    const stars = starsByName(drawFrame());
    const [a, b, c] = ['A', 'B', 'C'].map((name) => stars.get(name) as Star);
    expect(a && b && c).toBeTruthy();

    hover(view.canvas, a);
    const first = nearest(drawFrame().arcs, c).alpha as number;
    runUntilIdle();
    const dimmed = nearest(drawFrame().arcs, c).alpha as number;
    // Eased: the first frame is part-way between lit and dimmed, not a jump.
    expect(first).toBeGreaterThan(dimmed);
    expect(first).toBeLessThan(c.alpha as number);

    // Off A into empty sky, then onto B. C is linked to neither.
    hover(view.canvas, { x: (a.x + b.x) / 2 + 40, y: (a.y + b.y) / 2 + 40 });
    const crossing: number[] = [];
    for (let index = 0; index < 4; index++) crossing.push(nearest(drawFrame().arcs, c).alpha ?? 0);
    hover(view.canvas, b);
    for (let index = 0; index < 20; index++) crossing.push(nearest(drawFrame().arcs, c).alpha ?? 0);

    for (const alpha of crossing) expect(alpha).toBeCloseTo(dimmed, 5);
  });

  it('names a star on the first tap of a finger and opens it on the second', async () => {
    useNoteStore.setState({
      notes: fixture.small.nodes.map((node) => ({
        name: `${node.name}.md`,
        path: node.id,
        isDaily: false,
        isWeekly: false,
        isLocked: false,
      })),
    });
    const view = await openGraph();
    settleAndFit(view);
    const star = drawFrame().arcs[0];
    const tap = (pointerType: string) => {
      const at = { pointerId: 3, button: 0, clientX: star.x, clientY: star.y, pointerType };
      fireEvent.pointerDown(view.canvas, at);
      fireEvent.pointerUp(view.canvas, at);
    };

    tap('touch');
    expect(useGraphStore.getState().isOpen).toBe(true);
    const named = drawFrame();
    expect(nearest(named.arcs, star).r).toBeGreaterThan(star.r);

    tap('touch');
    expect(useGraphStore.getState().isOpen).toBe(true);
    fireEvent.click(view.canvas);
    expect(useGraphStore.getState().isOpen).toBe(false);
  });

  it('opens a star on the first click of a mouse', async () => {
    useNoteStore.setState({
      notes: fixture.small.nodes.map((node) => ({
        name: `${node.name}.md`,
        path: node.id,
        isDaily: false,
        isWeekly: false,
        isLocked: false,
      })),
    });
    const view = await openGraph();
    settleAndFit(view);
    const star = drawFrame().arcs[0];
    const at = { pointerId: 4, button: 0, clientX: star.x, clientY: star.y, pointerType: 'mouse' };
    fireEvent.pointerDown(view.canvas, at);
    fireEvent.pointerUp(view.canvas, at);

    expect(useGraphStore.getState().isOpen).toBe(false);
  });

  it('zooms in and out with a pinch of two fingers', async () => {
    const view = await openGraph();
    settleAndFit(view);
    const spread = (frame: Frame) => {
      const xs = frame.arcs.map((star) => star.x);
      return Math.max(...xs) - Math.min(...xs);
    };
    const before = spread(drawFrame());
    const finger = (id: number, x: number) => ({
      pointerId: id,
      button: 0,
      clientX: x,
      clientY: 400,
      pointerType: 'touch',
    });
    fireEvent.pointerDown(view.canvas, finger(1, 500));
    fireEvent.pointerDown(view.canvas, finger(2, 700));
    fireEvent.pointerMove(view.canvas, finger(1, 550));
    fireEvent.pointerMove(view.canvas, finger(2, 650));
    const pinched = spread(drawFrame());
    fireEvent.pointerUp(view.canvas, finger(1, 550));
    fireEvent.pointerUp(view.canvas, finger(2, 650));

    // Fingers twice as close together: the field at half the size.
    expect(pinched / before).toBeCloseTo(0.5, 2);
    // A pinch is never a tap: the graph is still open and nothing was named.
    expect(useGraphStore.getState().isOpen).toBe(true);
  });

  it('glides to Fit view and stops once it lands', async () => {
    const view = await openGraph();
    settleAndFit(view);
    const fitted = byPosition(drawFrame().arcs);
    pan(view.canvas, 400, 0);
    const panned = byPosition(drawFrame().arcs);

    fireEvent.click(view.container.querySelector('button[title^="Fit"]') as HTMLButtonElement);
    drawFrame();
    const midway = byPosition(drawFrame().arcs);
    expect(midway[0].x).toBeLessThan(panned[0].x);
    expect(midway[0].x).toBeGreaterThan(fitted[0].x);

    runUntilIdle();
    expect(frames.size).toBe(0);
    const landed = byPosition(drawFrame().arcs);
    landed.forEach((star, index) => expect(star.x).toBeCloseTo(fitted[index].x, 3));
  });

  it('moves between notes with the arrow keys and opens one with Enter', async () => {
    useNoteStore.setState({
      notes: fixture.small.nodes.map((node) => ({
        name: `${node.name}.md`,
        path: node.id,
        isDaily: false,
        isWeekly: false,
        isLocked: false,
      })),
    });
    const view = await openGraph();
    settleAndFit(view);
    const plain = drawFrame();
    view.canvas.focus();
    const announced = view.container.querySelector('[aria-live="polite"]') as HTMLElement;

    fireEvent.keyDown(view.canvas, { key: 'ArrowRight' });
    const first = announced.textContent;
    expect(first).toMatch(/^\w+, \d links?$/);
    const ringed = drawFrame();
    // The keyboard star carries a focus ring: one arc more than there are stars.
    expect(ringed.arcs.length).toBe(plain.arcs.length + 1);

    fireEvent.keyDown(view.canvas, { key: 'ArrowLeft' });
    expect(announced.textContent).not.toBe(first);

    fireEvent.keyDown(view.canvas, { key: 'Enter' });
    expect(useGraphStore.getState().isOpen).toBe(false);
  });

  describe('under prefers-reduced-motion', () => {
    it('skips the galaxy entrance', async () => {
      setReducedMotion(false);
      const animated = await openGraph();
      const animatedFirst = drawFrame();
      runFrames(99);
      const animatedLater = drawFrame();
      animated.unmount();

      setReducedMotion(true);
      const reduced = await openGraph();
      const reducedFirst = drawFrame();
      runFrames(99);
      const reducedLater = drawFrame();
      reduced.unmount();

      // Reduced motion draws the laid-out positions on the very first frame.
      expect(animatedFirst.arcs).not.toEqual(reducedFirst.arcs);
      // Both runs stepped the same deterministic layout, so once the entrance has
      // finished they must agree exactly: nothing is left stranded.
      expect(animatedLater.arcs).toEqual(reducedLater.arcs);
      expect(reducedLater.arcs.length).toBeGreaterThan(0);
    });

    it('lights a hover, fits the view and stops without easing', async () => {
      setReducedMotion(true);
      const view = await openGraph();
      settleAndFit(view);
      const stars = starsByName(drawFrame());
      const a = stars.get('A') as Star;
      const c = stars.get('C') as Star;

      hover(view.canvas, a);
      const first = nearest(drawFrame().arcs, c).alpha;
      runUntilIdle();
      expect(nearest(drawFrame().arcs, c).alpha).toBe(first);
      expect(first).toBeLessThan(c.alpha as number);

      const fitted = byPosition(drawFrame().arcs);
      pan(view.canvas, 400, 0);
      fireEvent.click(view.container.querySelector('button[title^="Fit"]') as HTMLButtonElement);
      expect(byPosition(drawFrame().arcs)).toEqual(fitted);
      // No idle motion: once still, the loop does not run at all.
      runUntilIdle();
      expect(frames.size).toBe(0);
    });
  });

  describe('with 5,000 notes', () => {
    it('settles, then draws in batches with a bounded, non-overlapping set of labels', async () => {
      fixture.graph = largeGraph(5_000);
      const view = await openGraph();
      const ran = runUntilIdle(800);
      expect(frames.size).toBe(0);
      expect(ran).toBeLessThan(800);
      fireEvent.click(view.container.querySelector('button[title^="Fit"]') as HTMLButtonElement);
      runUntilIdle();

      const fitted = drawFrame();
      expect(fitted.arcs.length).toBeGreaterThan(4_000);
      // One fill per opacity step, not one per star.
      expect(fitted.fills).toBeLessThanOrEqual(33);

      for (let index = 0; index < 8; index++) {
        fireEvent.wheel(view.canvas, { deltaY: -400, clientX: 600, clientY: 400 });
      }
      runUntilIdle();
      const zoomed = drawFrame();
      expect(zoomed.labels.length).toBeGreaterThan(10);
      expect(zoomed.labels.length).toBeLessThanOrEqual(240);
      const boxes = zoomed.labels.map((label) => ({
        left: label.x,
        right: label.x + label.text.length * 6,
        top: label.y - 7,
        bottom: label.y + 7,
      }));
      for (let index = 0; index < boxes.length; index++) {
        for (let other = index + 1; other < boxes.length; other++) {
          const overlap =
            boxes[index].left < boxes[other].right &&
            boxes[other].left < boxes[index].right &&
            boxes[index].top < boxes[other].bottom &&
            boxes[other].top < boxes[index].bottom;
          expect(overlap).toBe(false);
        }
      }
    }, 60_000);
  });
});

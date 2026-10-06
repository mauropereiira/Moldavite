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
  font: string;
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
    labels.push({ text, x, y, alpha: context.globalAlpha, font: context.font })
  ),
  strokeText: vi.fn(),
  roundRect: vi.fn(),
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
  // The stars sway behind a pan and settle; measure where they come to rest.
  runUntilIdle();
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

/** jsdom queues a 0 ms timer when the close button takes focus; clear it so only the graph's remain. */
function flushFocusTimer() {
  act(() => void vi.advanceTimersByTime(1));
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

  it('shows only the hovered name and its neighbours, then eases the rest back', async () => {
    const view = await openGraph();
    settleAndFit(view);
    const rest = drawFrame();
    const names = rest.labels.map((label) => label.text).sort();
    expect(names).toEqual(['A', 'B', 'C', 'D', 'E', 'Hub']);
    const a = starsByName(rest).get('A') as Star;

    hover(view.canvas, a);
    const first = drawFrame();
    const fading = first.labels.find((label) => label.text === 'C') as Label;
    // Eased: part-way out on the first frame, not snapped off.
    expect(fading.alpha).toBeGreaterThan(0.05);
    expect(fading.alpha).toBeLessThan(0.95);

    runUntilIdle();
    const focused = drawFrame();
    // A links only to Hub. Every other name is gone, not merely dimmed.
    expect(focused.labels.map((label) => label.text).sort()).toEqual(['A', 'Hub']);
    const own = focused.labels.find((label) => label.text === 'A') as Label;
    expect(own.font).toMatch(/^600 /);
    expect(own.alpha).toBe(1);
    expect(context.roundRect).toHaveBeenCalled();
    // The hovered star's own links are drawn again, brighter, over the field.
    expect(focused.points.length).toBeGreaterThan(rest.points.length);

    hover(view.canvas, { x: 2, y: 2 });
    runUntilIdle();
    const restored = drawFrame();
    expect(restored.labels.map((label) => label.text).sort()).toEqual(names);
    for (const label of restored.labels) expect(label.font).not.toMatch(/^600 /);
    expect(frames.size).toBe(0);
  });

  it('sways the stars behind a pan, with depth, and settles exactly', async () => {
    const view = await openGraph();
    settleAndFit(view);
    const before = byPosition(drawFrame().arcs);
    fireEvent.pointerDown(view.canvas, { pointerId: 1, button: 0, clientX: 60, clientY: 60 });
    fireEvent.pointerMove(view.canvas, { pointerId: 1, clientX: 260, clientY: 60 });
    const swaying = byPosition(drawFrame().arcs);
    const shifts = swaying.map((star, index) => star.x - before[index].x);
    // Every star trails the pan by a different amount, and none by more than the cap.
    for (const shift of shifts) {
      expect(shift).toBeGreaterThan(200 - 21);
      expect(shift).toBeLessThan(200);
    }
    expect(Math.max(...shifts) - Math.min(...shifts)).toBeGreaterThan(2);

    fireEvent.pointerUp(view.canvas, { pointerId: 1 });
    const ran = runUntilIdle();
    expect(ran).toBeLessThan(120);
    expect(frames.size).toBe(0);
    byPosition(drawFrame().arcs).forEach((star, index) =>
      expect(star.x - before[index].x).toBeCloseTo(200, 3)
    );
  });

  it('pulls a dragged star’s neighbours along on springs, then lets them settle', async () => {
    const view = await openGraph();
    settleAndFit(view);
    const stars = starsByName(drawFrame());
    const a = stars.get('A') as Star;
    const hub = stars.get('Hub') as Star;
    fireEvent.pointerDown(view.canvas, { pointerId: 2, button: 0, clientX: a.x, clientY: a.y });
    fireEvent.pointerMove(view.canvas, { pointerId: 2, clientX: a.x + 150, clientY: a.y });
    const first = nearest(drawFrame().arcs, hub);
    runFrames(12);
    const later = drawFrame();
    const followed = later.arcs.reduce((best, star) =>
      Math.abs(star.y - hub.y) + Math.abs(star.x - hub.x - 60) <
      Math.abs(best.y - hub.y) + Math.abs(best.x - hub.x - 60)
        ? star
        : best
    );
    // The dragged star is under the pointer at once; its neighbour lags, then follows.
    expect(nearest(later.arcs, { x: a.x + 150, y: a.y }).x).toBeCloseTo(a.x + 150, 0);
    // Carried part of the way on the very first frame (springs alone managed
    // under 10px here), but held back from the full 42% share on its own spring.
    expect(first.x - hub.x).toBeGreaterThan(15);
    expect(first.x - hub.x).toBeLessThan(150 * 0.42);
    expect(first.x - hub.x).toBeLessThan(followed.x - hub.x);
    expect(followed.x - hub.x).toBeGreaterThan(30);

    fireEvent.pointerUp(view.canvas, { pointerId: 2, clientX: a.x + 150, clientY: a.y });
    runUntilIdle();
    expect(frames.size).toBe(0);
  });

  it('drifts on a slow timer while idle, never every frame, and stops after a while', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] });
    try {
      const view = await openGraph();
      settleAndFit(view);
      flushFocusTimer();
      expect(frames.size).toBe(0);
      expect(vi.getTimerCount()).toBe(1);
      const still = byPosition(drawFrame().arcs);

      const drifted: Point[][] = [];
      for (let tick = 0; tick < 50; tick++) {
        act(() => void vi.advanceTimersByTime(66));
        // The timer asks for one frame at a time; nothing else runs in between.
        expect(frames.size).toBe(1);
        arcs = [];
        runFrames(1);
        drifted.push(byPosition(arcs));
      }
      const moved = drifted[drifted.length - 1];
      const offsets = moved.map((star, index) =>
        Math.hypot(star.x - still[index].x, star.y - still[index].y)
      );
      expect(Math.max(...offsets)).toBeGreaterThan(0.3);
      expect(Math.max(...offsets)).toBeLessThan(5);

      // An idle minute later it has stopped asking for frames.
      act(() => void vi.advanceTimersByTime(61_000));
      runUntilIdle();
      act(() => void vi.advanceTimersByTime(1_000));
      expect(vi.getTimerCount()).toBe(0);
      expect(frames.size).toBe(0);
      // Any input wakes it again.
      hover(view.canvas, { x: 3, y: 3 });
      expect(frames.size + vi.getTimerCount()).toBeGreaterThan(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('stops every frame and timer while the window is hidden', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] });
    const hidden = vi.spyOn(document, 'hidden', 'get').mockReturnValue(false);
    try {
      const view = await openGraph();
      runFrames(3);
      flushFocusTimer();
      expect(frames.size).toBe(1);

      hidden.mockReturnValue(true);
      act(() => void document.dispatchEvent(new Event('visibilitychange')));
      expect(frames.size).toBe(0);
      expect(vi.getTimerCount()).toBe(0);
      // Hovering or zooming asks for nothing while hidden.
      hover(view.canvas, { x: 600, y: 400 });
      fireEvent.wheel(view.canvas, { deltaY: -400, clientX: 600, clientY: 400 });
      act(() => void vi.advanceTimersByTime(5_000));
      expect(frames.size).toBe(0);

      hidden.mockReturnValue(false);
      act(() => void document.dispatchEvent(new Event('visibilitychange')));
      expect(frames.size).toBe(1);
    } finally {
      vi.useRealTimers();
    }
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
    runUntilIdle();
    const named = drawFrame();
    expect(nearest(named.arcs, star).r).toBeGreaterThan(star.r);
    // A tap focuses like a hover: only the star's own name and its neighbours' remain.
    const tapped = named.labels.find((label) => /bold|600/.test(label.font));
    expect(tapped).toBeDefined();
    const neighbours = tapped?.text === 'Hub' ? ['A', 'B', 'C', 'D', 'E'] : ['Hub'];
    expect(named.labels.map((label) => label.text).sort()).toEqual(
      [tapped?.text, ...neighbours].sort()
    );

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
    runUntilIdle();
    const pinched = spread(drawFrame());
    fireEvent.pointerUp(view.canvas, finger(1, 550));
    fireEvent.pointerUp(view.canvas, finger(2, 650));

    // Fingers twice as close together: the field at half the size.
    expect(pinched / before).toBeCloseTo(0.5, 2);
    // A pinch is never a tap: the graph is still open and nothing was named.
    expect(useGraphStore.getState().isOpen).toBe(true);
  });

  it('glides to Fit view and stops once it lands', async () => {
    // A pan's flick speed comes from the wall clock; frozen, the pan below never
    // turns into a glide, whatever the gap between the synthetic pointer events.
    vi.useFakeTimers({ toFake: ['performance'] });
    try {
      await fitGlide();
    } finally {
      vi.useRealTimers();
    }
  });

  async function fitGlide() {
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
  }

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

    it('neither drifts nor sways', async () => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] });
      try {
        setReducedMotion(true);
        const view = await openGraph();
        settleAndFit(view);
        flushFocusTimer();
        expect(vi.getTimerCount()).toBe(0);
        const still = byPosition(drawFrame().arcs);
        act(() => void vi.advanceTimersByTime(10_000));
        expect(frames.size).toBe(0);
        expect(byPosition(drawFrame().arcs)).toEqual(still);

        fireEvent.pointerDown(view.canvas, { pointerId: 1, button: 0, clientX: 60, clientY: 60 });
        fireEvent.pointerMove(view.canvas, { pointerId: 1, clientX: 260, clientY: 60 });
        const panned = byPosition(drawFrame().arcs);
        panned.forEach((star, index) => expect(star.x - still[index].x).toBeCloseTo(200, 3));
        fireEvent.pointerUp(view.canvas, { pointerId: 1 });
      } finally {
        vi.useRealTimers();
      }
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

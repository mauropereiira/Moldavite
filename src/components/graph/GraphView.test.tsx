/**
 * Canvas-level behaviour tests for the graph view.
 *
 * jsdom has no 2D context, so a recording stub stands in for one: every frame's
 * `arc()` calls are the stars and every `moveTo`/`lineTo` pair is a link. That
 * makes the drawn viewport observable, which is the only way to assert on
 * panning, auto-fit and the entrance animation from the outside.
 */
import { act, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useGraphStore, useNoteStore, useOverlayStore } from '@/stores';
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
  return {
    graph: {
      nodes,
      edges: nodes.slice(1).map((node) => ({ source: 'notes/hub.md', target: node.id })),
    },
  };
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
}

let arcs: Star[] = [];
let points: Point[] = [];
let frames = new Map<number, (time: number) => void>();
let nextFrameId = 1;
let clock = 0;

const context = {
  setTransform: vi.fn(),
  clearRect: vi.fn(),
  beginPath: vi.fn(),
  moveTo: vi.fn((x: number, y: number) => points.push({ x, y })),
  lineTo: vi.fn((x: number, y: number) => points.push({ x, y })),
  stroke: vi.fn(),
  fill: vi.fn(),
  arc: vi.fn((x: number, y: number, r: number) => arcs.push({ x, y, r })),
  fillText: vi.fn(),
  font: '',
  fillStyle: '',
  strokeStyle: '',
  lineWidth: 1,
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

/** Draw exactly one frame and return what was painted. */
function drawFrame(): { arcs: Star[]; points: Point[] } {
  arcs = [];
  points = [];
  runFrames(1);
  return { arcs: [...arcs], points: [...points] };
}

async function openGraph() {
  clock = 0;
  useGraphStore.getState().open();
  const view = render(<GraphView />);
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
}

function pan(canvas: HTMLCanvasElement, deltaX: number, deltaY: number) {
  fireEvent.pointerDown(canvas, { pointerId: 1, button: 0, clientX: 60, clientY: 60 });
  fireEvent.pointerMove(canvas, { pointerId: 1, clientX: 60 + deltaX, clientY: 60 + deltaY });
  fireEvent.pointerUp(canvas, { pointerId: 1 });
}

describe('GraphView canvas', () => {
  beforeEach(() => {
    setReducedMotion(false);
    arcs = [];
    points = [];
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
  // the heading shipped reading ".ph" in 2.0.0. The offset has to come from
  // --rail-width rather than a hardcoded 48, or the graph leaves a dead strip
  // when the rail is switched off or hidden by focus mode.
  it('starts clear of the icon rail, and reclaims the space when it is gone', async () => {
    const view = await openGraph();
    const surface = view.container.querySelector('[aria-labelledby="graph-view-title"]');
    expect(surface).not.toBeNull();
    expect((surface as HTMLElement).style.left).toBe('var(--rail-width)');
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

    fireEvent.pointerMove(view.canvas, {
      pointerId: 2,
      clientX: before.arcs[0].x,
      clientY: before.arcs[0].y,
    });
    const after = drawFrame();

    const positions = (stars: Star[]) => stars.map(({ x, y }) => ({ x, y }));
    expect(positions(after.arcs)).toEqual(positions(before.arcs));
    // …and the hover really did land, so the assertion above is not vacuous.
    expect(after.arcs.some((star, index) => star.r !== before.arcs[index].r)).toBe(true);
  });

  it('skips the galaxy entrance under prefers-reduced-motion', async () => {
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
    // finished they must agree exactly — nothing is left stranded.
    expect(animatedLater.arcs).toEqual(reducedLater.arcs);
    expect(reducedLater.arcs.length).toBeGreaterThan(0);
  });
});

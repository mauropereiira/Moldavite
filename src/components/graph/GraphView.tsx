import { type CSSProperties, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { EmptyGraphEmptyState } from '@/components/ui';
import { safeInvoke } from '@/lib/ipc';
import { isMobilePlatform } from '@/lib/platform';
import { useGraphStore, useNoteStore } from '@/stores';
import { useNotes } from '@/hooks';
import { noteForGraphNode } from './addressing';
import { createLabelPlacer } from './labels';
import {
  collisionRadius,
  initLayout,
  stepLayout,
  type GraphEdge,
  type GraphNode,
  type LayoutNode,
  type LayoutOptions,
} from './layout';
import { CloseButton } from '@/components/ui/CloseButton';
import { approach, clamp01, easeOutCubic, viewAt, type View, type ViewTween } from './motion';

interface NoteGraphResponse {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

interface PointerInteraction {
  mode: 'pan' | 'node' | 'pinch';
  pointerId: number;
  /** Index of the dragged star, or -1. */
  node: number;
  startX: number;
  startY: number;
  lastX: number;
  lastY: number;
  moved: boolean;
  /** Pan velocity in px/ms, for the glide after release. */
  velocityX: number;
  velocityY: number;
  sampledAt: number;
  pendingX: number;
  pendingY: number;
}

interface Pinch {
  distance: number;
  zoom: number;
  logicalX: number;
  logicalY: number;
}

/** Drawn size and brightness of one star, derived from its link count. */
interface StarStyle {
  radius: number;
  alpha: number;
}

/** Where a star begins the entrance, and how long it waits before travelling. */
interface EntranceOrigin {
  x: number;
  y: number;
  delay: number;
}

/**
 * Live state of the galaxy entrance. `x`/`y`/`t` are rewritten every frame and
 * are the only positions anything reads while it runs — the layout itself is
 * never touched, so dropping this object leaves every star exactly where the
 * force layout put it.
 */
interface Entrance {
  /** Timestamp of the first drawn frame. */
  start: number | null;
  progress: number;
  origins: EntranceOrigin[];
  x: Float64Array;
  y: Float64Array;
  t: Float64Array;
}

/** What only changes when the graph is refetched, indexed like `graph.nodes`. */
interface GraphScene {
  neighbors: number[][];
  styles: StarStyle[];
  /** The zoom at which a note's label is first offered: hubs before leaves. */
  labelZoom: Float32Array;
  /** Most-linked first, the order labels claim space in. */
  labelOrder: number[];
  labelText: string[];
  edgeSource: Int32Array;
  edgeTarget: Int32Array;
  /** How much of a view move each star takes through its spring: hubs least, so the field has depth. */
  swayLag: Float32Array;
  /** Per star, x then y: the ambient drift's angular rate (rad/ms) and phase. */
  driftRate: Float32Array;
  driftPhase: Float32Array;
}

/**
 * Hover, view and glide state shared by the pointer handlers and the frame
 * loop. It lives outside React on purpose: hovering was React state, so every
 * star crossed re-rendered the view, tore the loop down and reset the canvas.
 */
interface Motion {
  /** Index of the highlighted star, or -1. */
  hover: number;
  fromKeyboard: boolean;
  /** The pointer has left the star; the highlight holds for a moment first. */
  leaving: boolean;
  leaveStart: number | null;
  /** Eased highlight of each star that is lit or still fading, 0 to 1. */
  focus: Map<number, number>;
  /** Eased dimming of everything outside the highlight, 0 to 1. */
  dim: number;
  tween: ViewTween | null;
  zoomTarget: { zoom: number; anchorX: number; anchorY: number } | null;
  inertia: { vx: number; vy: number } | null;
  /** The user has panned or zoomed, so the automatic fit after settling must not move the view. */
  viewTouched: boolean;
  /** `performance.now()` of the last pointer, wheel or key input: ambient drift stops a while after it. */
  lastInput: number;
  /** How far the dragged star moved since the last frame, in layout units, for its neighbours to follow. */
  pull: { x: number; y: number };
}

// Stars. Radius and brightness both rise with a note's link count, mirroring
// how stellar magnitude sizes the welcome screen's constellations.
const STAR_RADIUS_MIN = 1.9;
const STAR_RADIUS_MAX = 5;
const STAR_HOVER_GROWTH = 1.8;
const STAR_ALPHA_MIN = 0.55;
const STAR_ALPHA_MAX = 1;
const STAR_DIMMED_ALPHA = 0.14;
/** Stars are filled in batches of equal opacity, one path per step. */
const ALPHA_STEPS = 32;
/** Thin ring around the star of the note currently open behind the graph. */
const CURRENT_RING_GAP = 4;
const KEYBOARD_RING_GAP = 6;

// Constellation lines: hairlines, never gradients or glow.
const EDGE_ALPHA = 0.42;
const EDGE_ALPHA_DIMMED = 0.12;
const EDGE_ALPHA_ACTIVE = 0.75;

const LABEL_SIZE_PX = 11;
const LABEL_VISIBILITY_THRESHOLD = 0.62;
/** Zoom at which the best-linked notes are labelled; others follow as you zoom in. */
const HUB_LABEL_ZOOM = 0.22;
/** The highlighted note's name sits on a pill this far past its text. */
const PILL_PAD_X = 6;
const PILL_HEIGHT = 19;
const LABEL_ENTRY_PAD = 6;
const LABEL_MAX_CHARS = 32;
/** Placement stops after this many labels, which bounds text work at any zoom. */
const MAX_LABELS = 240;
const MAX_RENDERED_EDGES = 12_000;
const MIN_ZOOM = 0.15;
const MAX_ZOOM = 3;
const SETTLED_TEMPERATURE = 0.35;
/** Dragging warms the layout only enough for neighbours to follow the star. */
const DRAG_TEMPERATURE = 5;
/**
 * Panning is free. The field may still travel this many viewport-widths past
 * the edge before it stops — far enough to scroll away from the graph
 * completely, close enough that Fit view is a recovery rather than a rescue.
 */
const PAN_SLACK_VIEWPORTS = 3;

// Galaxy entrance: the field starts scattered outward and rotated back, then
// unwinds into place. Centre stars arrive first so it resolves outward.
const ENTRANCE_TRAVEL_MS = 820;
const ENTRANCE_STAGGER_MS = 320;
const ENTRANCE_SCATTER = 1.55;
const ENTRANCE_SCATTER_FLOOR = 40;
const ENTRANCE_TWIST = 0.5;
/** Fraction of the entrance that passes before links and labels fade in. */
const ENTRANCE_REVEAL_LEAD = 0.55;

// Motion. Time constants, so each fade is frame-rate independent.
const HOVER_FADE_MS = 110;
const LABEL_FADE_MS = 90;
const WHEEL_ZOOM_MS = 70;
const PAN_FRICTION_MS = 280;
const FIT_MS = 520;
/**
 * The highlight holds this long after the pointer leaves a star. Moving
 * between two stars crosses empty sky, and without the hold the whole field
 * flashed from dimmed to lit and back on every crossing (measured: six full
 * reversals in a 130px sweep across 16 stars).
 */
const HOVER_GRACE_MS = 140;
const HOVER_REACH_PX = 12;
/** A lit star stays lit until the pointer is this much further away than it took to light it. */
const HOVER_KEEP_FACTOR = 1.6;
/** How far from a star a fingertip still picks it. */
const TOUCH_REACH_PX = 24;
/** A wheel event this large is a mouse notch, which glides; trackpad deltas apply directly. */
const WHEEL_NOTCH_PX = 50;
const WHEEL_ZOOM_RATE = 0.0015;
const PINCH_ZOOM_RATE = 0.01;
const KEY_ZOOM_STEP = 1.25;
const FRAME_MS = 16;
const MAX_FRAME_STEP_MS = 64;

// Sway. Each star is drawn on a soft spring behind its true position, so
// moving the view or a star makes the field trail, overshoot a little (about
// 12%) and settle within a second.
const SWAY_RATE = 9;
const SWAY_DAMPING = 0.55;
const SWAY_MAX_PX = 20;
/** Zooming moves far stars hundreds of px a frame; only this share of it sways. */
const SWAY_ZOOM_SHARE = 0.4;
const SWAY_REST_PX = 0.05;
/** How much of a dragged star's move its neighbours take, one and two links away. */
const DRAG_PULL = [0.42, 0.16];
const DRAG_PULL_MAX_NODES = 400;
/** Neighbours may trail a dragged star further than the field trails a pan: that is the elastic. */
const DRAG_SWAY_MAX_PX = 40;

// Ambient drift: each star wanders a couple of px on a slow, unique orbit
// while the graph sits idle. It paints at 15 fps from a timer rather than
// every frame (measured in WebKit at 500 notes: about 6% of one core, against
// 0.1% when still), stops a minute after the last input, while the window is
// hidden and under reduced motion, and never runs on very large graphs.
const DRIFT_PX = 2.4;
const DRIFT_FRAME_MS = 66;
const DRIFT_RAMP_MS = 1500;
const DRIFT_IDLE_MS = 60_000;
const DRIFT_MAX_NODES = 2_000;

const ARROW_DIRECTIONS: Record<string, { x: number; y: number }> = {
  ArrowRight: { x: 1, y: 0 },
  ArrowLeft: { x: -1, y: 0 },
  ArrowDown: { x: 0, y: 1 },
  ArrowUp: { x: 0, y: -1 },
};

/**
 * Zoom and pan survive close → reopen for the life of the session, so returning
 * to the graph resumes where you left it. `fitted` records that this session
 * has had its one automatic fit; every later re-centre is a deliberate Fit view
 * or a double-click on empty canvas.
 */
const sessionView = { zoom: 1, pan: { x: 0, y: 0 }, fitted: false };

function readCssVar(name: string, fallback: string): string {
  if (typeof window === 'undefined') return fallback;
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
}

function readColors() {
  return {
    edge: readCssVar('--border-strong', '#b8b09c'),
    star: readCssVar('--text-primary', '#0e0d0a'),
    missing: readCssVar('--text-muted', '#9a8268'),
    label: readCssVar('--text-secondary', '#5a4530'),
    halo: readCssVar('--bg-base', '#f4efe2'),
    pill: readCssVar('--bg-elevated', '#fffdf6'),
    pillBorder: readCssVar('--border-default', '#d8d0bc'),
    focus: readCssVar('--focus-ring', '#0e0d0a'),
  };
}

/** A stable pseudo-random 0 to 1 per star, so the motion is the same every time the graph opens. */
function unitHash(index: number, salt: number): number {
  const value = Math.sin(index * 12.9898 + salt * 78.233) * 43758.5453;
  return value - Math.floor(value);
}

function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

function clampZoom(zoom: number): number {
  return Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, zoom));
}

function optionsForNodeCount(count: number): Required<LayoutOptions> {
  const side = Math.max(720, Math.ceil(Math.sqrt(Math.max(1, count))) * 104);
  return {
    width: side,
    height: side,
    optimalDistance: 72,
    initialTemperature: 28,
    cooling: 0.965,
    seed: 1,
  };
}

function layoutBounds(nodes: LayoutNode[]) {
  if (nodes.length === 0) return { minX: -1, maxX: 1, minY: -1, maxY: 1 };
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const node of nodes) {
    const margin = collisionRadius(node);
    minX = Math.min(minX, node.x - margin);
    maxX = Math.max(maxX, node.x + margin);
    minY = Math.min(minY, node.y - 12);
    maxY = Math.max(maxY, node.y + 12);
  }
  return { minX, maxX, minY, maxY };
}

/**
 * Scatter the field outward from centre and rotate it back, so the entrance
 * unwinds into the laid-out positions instead of flying in from off-screen.
 */
function entranceFor(nodes: LayoutNode[]): Entrance {
  let maxRadius = 1;
  for (const node of nodes) maxRadius = Math.max(maxRadius, Math.hypot(node.x, node.y));
  const origins = nodes.map((node) => {
    const radius = Math.hypot(node.x, node.y);
    const angle = Math.atan2(node.y, node.x) - ENTRANCE_TWIST;
    const scattered = radius * ENTRANCE_SCATTER + ENTRANCE_SCATTER_FLOOR;
    return {
      x: Math.cos(angle) * scattered,
      y: Math.sin(angle) * scattered,
      delay: (radius / maxRadius) * ENTRANCE_STAGGER_MS,
    };
  });
  return {
    start: null,
    progress: 0,
    origins,
    x: Float64Array.from(origins, (origin) => origin.x),
    y: Float64Array.from(origins, (origin) => origin.y),
    t: new Float64Array(origins.length),
  };
}

function buildScene(graph: NoteGraphResponse): GraphScene {
  const indexById = new Map(graph.nodes.map((node, index) => [node.id, index]));
  const linked = graph.nodes.map(() => new Set<number>());
  const edgeSource: number[] = [];
  const edgeTarget: number[] = [];
  const stride =
    graph.edges.length > MAX_RENDERED_EDGES
      ? Math.ceil(graph.edges.length / MAX_RENDERED_EDGES)
      : 1;
  graph.edges.forEach((edge, index) => {
    const source = indexById.get(edge.source);
    const target = indexById.get(edge.target);
    if (source === undefined || target === undefined) return;
    if (source !== target) {
      linked[source].add(target);
      linked[target].add(source);
    }
    if (index % stride === 0) {
      edgeSource.push(source);
      edgeTarget.push(target);
    }
  });
  const neighbors = linked.map((set) => [...set]);
  const maxDegree = neighbors.reduce((max, list) => Math.max(max, list.length), 0);
  const magnitude = neighbors.map((list) =>
    maxDegree > 0 ? Math.sqrt(list.length / maxDegree) : 0
  );
  return {
    neighbors,
    // Hubs read as brighter, larger stars; a note with no links is the faintest.
    styles: magnitude.map((value) => ({
      radius: STAR_RADIUS_MIN + (STAR_RADIUS_MAX - STAR_RADIUS_MIN) * value,
      alpha: STAR_ALPHA_MIN + (STAR_ALPHA_MAX - STAR_ALPHA_MIN) * value,
    })),
    labelZoom: Float32Array.from(
      magnitude,
      (value) => LABEL_VISIBILITY_THRESHOLD - (LABEL_VISIBILITY_THRESHOLD - HUB_LABEL_ZOOM) * value
    ),
    labelOrder: graph.nodes
      .map((_, index) => index)
      .sort((a, b) => neighbors[b].length - neighbors[a].length || a - b),
    labelText: graph.nodes.map((node) =>
      node.name.length > LABEL_MAX_CHARS ? `${node.name.slice(0, LABEL_MAX_CHARS - 1)}…` : node.name
    ),
    edgeSource: Int32Array.from(edgeSource),
    edgeTarget: Int32Array.from(edgeTarget),
    swayLag: Float32Array.from(
      magnitude,
      (value, index) => (0.35 + 0.65 * unitHash(index, 1)) * (1 - 0.5 * value)
    ),
    driftRate: Float32Array.from(
      { length: magnitude.length * 2 },
      (_, slot) => (Math.PI * 2) / (7_000 + 6_000 * unitHash(slot, 2))
    ),
    driftPhase: Float32Array.from(
      { length: magnitude.length * 2 },
      (_, slot) => Math.PI * 2 * unitHash(slot, 3)
    ),
  };
}

function newMotion(): Motion {
  return {
    hover: -1,
    fromKeyboard: false,
    leaving: false,
    leaveStart: null,
    focus: new Map(),
    dim: 0,
    tween: null,
    zoomTarget: null,
    inertia: null,
    viewTouched: false,
    lastInput: window.performance.now(),
    pull: { x: 0, y: 0 },
  };
}

const editorialLabel: CSSProperties = {
  color: 'var(--text-muted)',
  fontFamily: 'var(--font-display)',
  fontSize: '10px',
  letterSpacing: '0.14em',
  lineHeight: 1,
  textTransform: 'uppercase',
  whiteSpace: 'nowrap',
};

function isTouch(event: React.PointerEvent): boolean {
  return event.pointerType === 'touch' || event.pointerType === 'pen';
}

/** Full-screen, path-addressed note graph rendered on a Canvas 2D surface. */
export function GraphView() {
  const isOpen = useGraphStore((state) => state.isOpen);
  const close = useGraphStore((state) => state.close);
  const notes = useNoteStore((state) => state.notes);
  const currentNoteId = useNoteStore((state) => state.currentNote?.id ?? null);
  const { loadNote } = useNotes();

  const [graph, setGraph] = useState<NoteGraphResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const ringRef = useRef<HTMLDivElement | null>(null);
  const announceRef = useRef<HTMLDivElement | null>(null);
  const closeBtnRef = useRef<HTMLButtonElement | null>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const layoutRef = useRef<LayoutNode[]>([]);
  const layoutOptionsRef = useRef<Required<LayoutOptions>>(optionsForNodeCount(0));
  const temperatureRef = useRef(0);
  const zoomRef = useRef(1);
  const panRef = useRef({ x: 0, y: 0 });
  const entranceRef = useRef<Entrance | null>(null);
  const initialFitRef = useRef(false);
  const interactionRef = useRef<PointerInteraction | null>(null);
  const pointersRef = useRef(new Map<number, { x: number; y: number }>());
  const pinchRef = useRef<Pinch | null>(null);
  const openOnClickRef = useRef<string | null>(null);
  const scheduleDrawRef = useRef<() => void>(() => undefined);
  const motionRef = useRef<Motion>(newMotion());
  /** Where each star was last painted, in canvas px: what hit-testing reads. */
  const screenRef = useRef({ x: new Float32Array(0), y: new Float32Array(0), painted: false });
  const currentNoteRef = useRef<string | null>(currentNoteId);

  const scene = useMemo(() => (graph ? buildScene(graph) : null), [graph]);

  useEffect(() => {
    currentNoteRef.current = currentNoteId;
    scheduleDrawRef.current();
  }, [currentNoteId]);

  /**
   * Free panning with a very loose backstop. The graph is allowed to leave the
   * viewport entirely; the only thing this prevents is panning so far that Fit
   * view feels like teleporting back from nowhere.
   */
  const clampPan = useCallback(() => {
    const container = containerRef.current;
    if (!container || layoutRef.current.length === 0) return;
    const rect = container.getBoundingClientRect();
    const bounds = layoutBounds(layoutRef.current);
    const zoom = zoomRef.current;
    const slackX = rect.width * PAN_SLACK_VIEWPORTS;
    const slackY = rect.height * PAN_SLACK_VIEWPORTS;
    const minPanX = -rect.width / 2 - bounds.maxX * zoom - slackX;
    const maxPanX = rect.width / 2 - bounds.minX * zoom + slackX;
    const minPanY = -rect.height / 2 - bounds.maxY * zoom - slackY;
    const maxPanY = rect.height / 2 - bounds.minY * zoom + slackY;
    panRef.current = {
      x: Math.max(minPanX, Math.min(maxPanX, panRef.current.x)),
      y: Math.max(minPanY, Math.min(maxPanY, panRef.current.y)),
    };
  }, []);

  const fitTarget = useCallback((): View | null => {
    const container = containerRef.current;
    if (!container || layoutRef.current.length === 0) return null;
    const rect = container.getBoundingClientRect();
    const bounds = layoutBounds(layoutRef.current);
    const availableWidth = Math.max(1, rect.width - 80);
    const availableHeight = Math.max(1, rect.height - 80);
    const zoom = clampZoom(
      Math.min(
        availableWidth / Math.max(1, bounds.maxX - bounds.minX),
        availableHeight / Math.max(1, bounds.maxY - bounds.minY)
      )
    );
    return {
      zoom,
      x: -((bounds.minX + bounds.maxX) / 2) * zoom,
      y: -((bounds.minY + bounds.maxY) / 2) * zoom,
    };
  }, []);

  /** Glide to `target`, or jump there under reduced motion or when `animate` is false. */
  const moveViewTo = useCallback((target: View, animate: boolean) => {
    const motion = motionRef.current;
    motion.zoomTarget = null;
    motion.inertia = null;
    if (!animate || prefersReducedMotion()) {
      motion.tween = null;
      zoomRef.current = target.zoom;
      panRef.current = { x: target.x, y: target.y };
    } else {
      motion.tween = {
        from: { zoom: zoomRef.current, ...panRef.current },
        to: target,
        start: null,
        duration: FIT_MS,
      };
    }
    scheduleDrawRef.current();
  }, []);

  const fitToView = useCallback(() => {
    const target = fitTarget();
    if (target) moveViewTo(target, true);
  }, [fitTarget, moveViewTo]);

  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      setGraph(null);
      setLoading(true);
      setError(null);
    });
    safeInvoke<NoteGraphResponse>('get_note_graph')
      .then((result) => {
        if (cancelled) return;
        const options = optionsForNodeCount(result.nodes.length);
        layoutOptionsRef.current = options;
        layoutRef.current = initLayout(result.nodes, options, result.edges);
        temperatureRef.current = options.initialTemperature;
        motionRef.current = newMotion();
        // Resume the view this session was left at; only a session's first
        // graph is framed automatically.
        zoomRef.current = sessionView.zoom;
        panRef.current = { ...sessionView.pan };
        initialFitRef.current = !sessionView.fitted;
        entranceRef.current = prefersReducedMotion() ? null : entranceFor(layoutRef.current);
        setGraph(result);
      })
      .catch((caught: unknown) => {
        if (!cancelled) setError(caught instanceof Error ? caught.message : String(caught));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
      entranceRef.current = null;
      sessionView.zoom = zoomRef.current;
      sessionView.pan = panRef.current;
    };
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        close();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, close]);

  useEffect(() => {
    if (!isOpen) return;
    previousFocusRef.current = document.activeElement as HTMLElement | null;
    const frame = requestAnimationFrame(() => closeBtnRef.current?.focus());
    return () => {
      cancelAnimationFrame(frame);
      previousFocusRef.current?.focus?.();
      previousFocusRef.current = null;
    };
  }, [isOpen]);

  // The one frame loop. It depends on the graph alone: hover, the open note,
  // theme and view changes all reach it through refs and ask for a frame, and
  // it stops asking once nothing is moving.
  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    const context = canvas?.getContext('2d');
    if (!isOpen || !graph || !scene || !canvas || !container || !context) return;
    const nodes = layoutRef.current;
    const count = nodes.length;
    const motion = motionRef.current;
    const indexById = new Map(nodes.map((node, index) => [node.id, index]));
    const screen = { x: new Float32Array(count), y: new Float32Array(count), painted: false };
    screenRef.current = screen;
    const radius = new Float32Array(count);
    const labelAlpha = new Float32Array(count);
    const labelWidth = new Float32Array(count).fill(-1);
    const placed = new Uint8Array(count);
    const liveLabels = new Set<number>();
    /** This frame's labels as index, opacity pairs. */
    const labelDraw: number[] = [];
    const placer = createLabelPlacer();
    const emphasis = new Map<number, number>();
    const fillBuckets: number[][] = Array.from({ length: ALPHA_STEPS + 1 }, () => []);
    const strokeBuckets: number[][] = Array.from({ length: ALPHA_STEPS + 1 }, () => []);
    const ring = { x: NaN, y: NaN, size: NaN, opacity: NaN, shown: false };
    let colors = readColors();
    const motionQuery =
      typeof window.matchMedia === 'function'
        ? window.matchMedia('(prefers-reduced-motion: reduce)')
        : null;
    const reducedMotion = () => motionQuery?.matches ?? false;
    const labelFont = `${LABEL_SIZE_PX}px ${readCssVar('--font-sans', 'ui-sans-serif, system-ui, sans-serif')}`;
    const boldFont = `600 ${labelFont}`;
    let hoverWidth = { index: -1, width: 0 };
    let width = 0;
    let height = 0;
    let frameId: number | null = null;
    let driftTimer: ReturnType<typeof setTimeout> | null = null;
    let lastTime: number | null = null;
    /** Screen-px offset of each star from where it truly is, and its velocity in px/s. */
    const swayX = new Float32Array(count);
    const swayY = new Float32Array(count);
    const swayVX = new Float32Array(count);
    const swayVY = new Float32Array(count);
    let swaying = false;
    const lastView = { zoom: 0, x: 0, y: 0, known: false };
    const pullIndex: number[] = [];
    const pullShare: number[] = [];
    let pullFor = -1;
    let driftClock = 0;
    let driftDue = false;
    let labelsFading = false;
    // The one automatic fit a session gets, unless the user moves the view first.
    let fitAfterSettling = !sessionView.fitted;

    const resize = () => {
      const rect = container.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      width = rect.width;
      height = rect.height;
      const pixelWidth = Math.max(1, Math.round(rect.width * dpr));
      const pixelHeight = Math.max(1, Math.round(rect.height * dpr));
      // Assigning either dimension clears the bitmap even when the value is
      // unchanged, so only a real size change may touch them.
      if (canvas.width !== pixelWidth) canvas.width = pixelWidth;
      if (canvas.height !== pixelHeight) canvas.height = pixelHeight;
      canvas.style.width = `${rect.width}px`;
      canvas.style.height = `${rect.height}px`;
      context.setTransform(
        pixelWidth / Math.max(1, rect.width),
        0,
        0,
        pixelHeight / Math.max(1, rect.height),
        0,
        0
      );
    };

    /** Hold star `index` back by `weight` of a move of (dx, dy) screen px; its spring catches up. */
    const kick = (
      index: number,
      dx: number,
      dy: number,
      weight: number,
      // The cap scales with the weight too, or a fast pan would hold every
      // star at the same distance and flatten the depth.
      limit = SWAY_MAX_PX * weight
    ) => {
      let x = swayX[index] - dx * weight;
      let y = swayY[index] - dy * weight;
      const reach = Math.hypot(x, y);
      if (reach > limit) {
        x *= limit / reach;
        y *= limit / reach;
      }
      swayX[index] = x;
      swayY[index] = y;
      swaying = true;
    };

    const stopSway = () => {
      swayX.fill(0);
      swayY.fill(0);
      swayVX.fill(0);
      swayVY.fill(0);
      swaying = false;
    };

    /** The view's move since the last frame sways every star; returns whether any are still moving. */
    const sway = (elapsed: number, pinned: number): boolean => {
      const zoom = zoomRef.current;
      const { x: panX, y: panY } = panRef.current;
      if (reducedMotion() || entranceRef.current) {
        if (swaying) stopSway();
      } else if (lastView.known) {
        const dz = zoom - lastView.zoom;
        const dx = panX - lastView.x;
        const dy = panY - lastView.y;
        if (dz !== 0 || dx !== 0 || dy !== 0) {
          const share = dz !== 0 ? SWAY_ZOOM_SHARE : 1;
          for (let index = 0; index < count; index++) {
            kick(
              index,
              (dx + nodes[index].x * dz) * share,
              (dy + nodes[index].y * dz) * share,
              scene.swayLag[index]
            );
          }
        }
      }
      lastView.zoom = zoom;
      lastView.x = panX;
      lastView.y = panY;
      lastView.known = true;
      if (!swaying) return false;
      if (pinned >= 0) {
        swayX[pinned] = swayY[pinned] = swayVX[pinned] = swayVY[pinned] = 0;
      }
      // Semi-implicit Euler: stable for these constants at the 64 ms frame cap.
      const dt = elapsed / 1000;
      const stiffness = SWAY_RATE * SWAY_RATE;
      const friction = 2 * SWAY_DAMPING * SWAY_RATE;
      let peak = 0;
      for (let index = 0; index < count; index++) {
        const vx = swayVX[index] - (stiffness * swayX[index] + friction * swayVX[index]) * dt;
        const vy = swayVY[index] - (stiffness * swayY[index] + friction * swayVY[index]) * dt;
        swayVX[index] = vx;
        swayVY[index] = vy;
        swayX[index] += vx * dt;
        swayY[index] += vy * dt;
        peak = Math.max(
          peak,
          Math.abs(swayX[index]) + Math.abs(swayY[index]) + (Math.abs(vx) + Math.abs(vy)) * 0.1
        );
      }
      if (peak < SWAY_REST_PX) stopSway();
      return swaying;
    };

    /** The dragged star's neighbours, and theirs, follow it part of the way, on their springs. */
    const pullNeighbours = (pinned: number) => {
      const { pull } = motion;
      if (pull.x === 0 && pull.y === 0) return;
      if (pinned >= 0) {
        if (pullFor !== pinned) {
          pullFor = pinned;
          pullIndex.length = 0;
          pullShare.length = 0;
          const seen = new Set([pinned]);
          let frontier = [pinned];
          for (const share of DRAG_PULL) {
            const next: number[] = [];
            for (const from of frontier) {
              for (const to of scene.neighbors[from]) {
                if (seen.has(to) || pullIndex.length >= DRAG_PULL_MAX_NODES) continue;
                seen.add(to);
                next.push(to);
                pullIndex.push(to);
                pullShare.push(share);
              }
            }
            frontier = next;
          }
        }
        const zoom = zoomRef.current;
        for (let item = 0; item < pullIndex.length; item++) {
          const index = pullIndex[item];
          const share = pullShare[item];
          nodes[index].x += pull.x * share;
          nodes[index].y += pull.y * share;
          kick(index, pull.x * share * zoom, pull.y * share * zoom, 1, DRAG_SWAY_MAX_PX);
        }
      }
      pull.x = 0;
      pull.y = 0;
    };

    const advance = (time: number, elapsed: number): boolean => {
      let active = false;
      const instant = reducedMotion();
      const interaction = interactionRef.current;
      const pinned = interaction?.mode === 'node' ? interaction.node : -1;
      pullNeighbours(pinned);

      if (count > 0 && temperatureRef.current > SETTLED_TEMPERATURE) {
        stepLayout(nodes, graph.edges, temperatureRef.current, layoutOptionsRef.current, {
          pinnedNodeId: pinned >= 0 ? nodes[pinned].id : null,
        });
        temperatureRef.current *= layoutOptionsRef.current.cooling;
        active = true;
      }

      const entrance = entranceRef.current;
      if (entrance) {
        entrance.start ??= time;
        const sinceStart = time - entrance.start;
        entrance.progress = clamp01(sinceStart / (ENTRANCE_STAGGER_MS + ENTRANCE_TRAVEL_MS));
        for (let index = 0; index < count; index++) {
          const origin = entrance.origins[index];
          const t = easeOutCubic(clamp01((sinceStart - origin.delay) / ENTRANCE_TRAVEL_MS));
          entrance.t[index] = t;
          entrance.x[index] = origin.x + (nodes[index].x - origin.x) * t;
          entrance.y[index] = origin.y + (nodes[index].y - origin.y) * t;
        }
        if (entrance.progress < 1) active = true;
      }

      if (motion.leaving) {
        motion.leaveStart ??= time;
        if (instant || time - motion.leaveStart >= HOVER_GRACE_MS) {
          motion.hover = -1;
          motion.leaving = false;
          motion.leaveStart = null;
        } else {
          active = true;
        }
      }
      const fade = instant ? 0 : HOVER_FADE_MS;
      if (motion.hover >= 0 && !motion.focus.has(motion.hover)) motion.focus.set(motion.hover, 0);
      for (const [index, level] of motion.focus) {
        const target = index === motion.hover ? 1 : 0;
        const next = approach(level, target, elapsed, fade);
        if (next === 0 && target === 0) motion.focus.delete(index);
        else motion.focus.set(index, next);
        if (next !== target) active = true;
      }
      const dimTarget = motion.hover >= 0 ? 1 : 0;
      motion.dim = approach(motion.dim, dimTarget, elapsed, fade);
      if (motion.dim !== dimTarget) active = true;

      if (motion.tween) {
        motion.tween.start ??= time;
        const { view, done } = viewAt(motion.tween, time);
        zoomRef.current = view.zoom;
        panRef.current = { x: view.x, y: view.y };
        if (done) motion.tween = null;
        else active = true;
      } else if (motion.zoomTarget) {
        const target = motion.zoomTarget;
        const oldZoom = zoomRef.current;
        const nextZoom = approach(
          oldZoom,
          target.zoom,
          elapsed,
          instant ? 0 : WHEEL_ZOOM_MS,
          target.zoom * 0.002
        );
        const logicalX = (target.anchorX - panRef.current.x) / oldZoom;
        const logicalY = (target.anchorY - panRef.current.y) / oldZoom;
        zoomRef.current = nextZoom;
        panRef.current = {
          x: target.anchorX - logicalX * nextZoom,
          y: target.anchorY - logicalY * nextZoom,
        };
        clampPan();
        if (nextZoom === target.zoom) motion.zoomTarget = null;
        else active = true;
      } else if (motion.inertia) {
        const inertia = motion.inertia;
        panRef.current = {
          x: panRef.current.x + inertia.vx * elapsed,
          y: panRef.current.y + inertia.vy * elapsed,
        };
        const decay = Math.exp(-elapsed / PAN_FRICTION_MS);
        inertia.vx *= decay;
        inertia.vy *= decay;
        clampPan();
        if (Math.hypot(inertia.vx, inertia.vy) < 0.01) motion.inertia = null;
        else active = true;
      }
      return active;
    };

    /** The highlighted name is drawn whole and in bold, so it is measured on its own. */
    const hoverLabelWidth = (index: number) => {
      if (hoverWidth.index !== index) {
        context.font = boldFont;
        hoverWidth = { index, width: context.measureText(nodes[index].name).width };
        context.font = labelFont;
      }
      return hoverWidth.width;
    };

    const labelWidthOf = (index: number) => {
      if (labelWidth[index] < 0)
        labelWidth[index] = context.measureText(scene.labelText[index]).width;
      return labelWidth[index];
    };

    /** Draw the frame; returns whether label fades still need frames. */
    const paint = (elapsed: number): boolean => {
      const entrance = entranceRef.current;
      const live = entrance && entrance.progress < 1 ? entrance : null;
      if (entrance && !live) entranceRef.current = null;
      const reveal = clamp01(
        ((live ? live.progress : 1) - ENTRANCE_REVEAL_LEAD) / (1 - ENTRANCE_REVEAL_LEAD)
      );
      const zoom = zoomRef.current;
      const centerX = width / 2 + panRef.current.x;
      const centerY = height / 2 + panRef.current.y;
      const ramp = clamp01(driftClock / DRIFT_RAMP_MS);
      const drift = reducedMotion() ? 0 : DRIFT_PX * ramp * ramp * (3 - 2 * ramp);
      for (let index = 0; index < count; index++) {
        let x = centerX + (live ? live.x[index] : nodes[index].x) * zoom + swayX[index];
        let y = centerY + (live ? live.y[index] : nodes[index].y) * zoom + swayY[index];
        if (drift > 0) {
          const slot = index * 2;
          x += drift * Math.sin(scene.driftRate[slot] * driftClock + scene.driftPhase[slot]);
          y +=
            drift * Math.sin(scene.driftRate[slot + 1] * driftClock + scene.driftPhase[slot + 1]);
        }
        screen.x[index] = x;
        screen.y[index] = y;
      }
      screen.painted = true;

      emphasis.clear();
      for (const [index, level] of motion.focus) {
        if (level > (emphasis.get(index) ?? 0)) emphasis.set(index, level);
        for (const neighbor of scene.neighbors[index]) {
          if (level > (emphasis.get(neighbor) ?? 0)) emphasis.set(neighbor, level);
        }
      }
      const dim = motion.dim;
      context.clearRect(0, 0, width, height);

      // Links fade in once the stars are mostly home.
      const edgeAlpha = EDGE_ALPHA + (EDGE_ALPHA_DIMMED - EDGE_ALPHA) * dim;
      context.strokeStyle = colors.edge;
      context.lineWidth = 1;
      context.globalAlpha = edgeAlpha * reveal;
      context.beginPath();
      for (let edge = 0; edge < scene.edgeSource.length; edge++) {
        const source = scene.edgeSource[edge];
        const target = scene.edgeTarget[edge];
        context.moveTo(screen.x[source], screen.y[source]);
        context.lineTo(screen.x[target], screen.y[target]);
      }
      context.stroke();
      // A lit star's own links are drawn again over the field in the label ink.
      context.strokeStyle = colors.label;
      for (const [index, level] of motion.focus) {
        context.globalAlpha = EDGE_ALPHA_ACTIVE * level * reveal;
        context.beginPath();
        for (const neighbor of scene.neighbors[index]) {
          context.moveTo(screen.x[index], screen.y[index]);
          context.lineTo(screen.x[neighbor], screen.y[neighbor]);
        }
        context.stroke();
      }

      const current = currentNoteRef.current ? (indexById.get(currentNoteRef.current) ?? -1) : -1;

      // Labels claim space in priority order: the highlighted star and its
      // neighbours, the open note, labels already showing (so they do not
      // flicker as you pan), then the best-linked notes.
      let labelsMoving = false;
      context.font = labelFont;
      placer.reset();
      placed.fill(0);
      let budget = MAX_LABELS;
      const labelLeft = (index: number) =>
        screen.x[index] + scene.styles[index].radius + STAR_HOVER_GROWTH + 4;
      const offer = (index: number) => {
        if (placed[index] || budget <= 0) return;
        const x = screen.x[index];
        const y = screen.y[index];
        if (x < -240 || x > width || y < -10 || y > height + 10) return;
        const left = labelLeft(index);
        // A hidden label must clear its neighbours by a margin wider than the
        // drift, or a label at the edge of a collision blinks as stars wander.
        const pad = labelAlpha[index] > 0.5 ? 0 : LABEL_ENTRY_PAD;
        const lit = index === motion.hover;
        const boxWidth = lit
          ? hoverLabelWidth(index) + PILL_PAD_X * 2 + 2
          : labelWidthOf(index) + 4;
        const boxHeight = lit ? PILL_HEIGHT : LABEL_SIZE_PX * 1.5;
        if (
          placer.place(
            left - 2 - pad,
            y - boxHeight / 2 - pad,
            boxWidth + pad * 2,
            boxHeight + pad * 2
          )
        ) {
          placed[index] = 1;
          budget--;
          liveLabels.add(index);
        }
      };
      if (reveal > 0) {
        if (motion.hover >= 0) {
          offer(motion.hover);
          for (const neighbor of scene.neighbors[motion.hover]) offer(neighbor);
        }
        if (current >= 0 && zoom >= HUB_LABEL_ZOOM) offer(current);
        if (zoom >= HUB_LABEL_ZOOM) {
          for (const index of scene.labelOrder) {
            if (labelAlpha[index] > 0.5 && zoom >= scene.labelZoom[index]) offer(index);
          }
          for (const index of scene.labelOrder) {
            if (budget <= 0) break;
            if (zoom >= scene.labelZoom[index]) offer(index);
          }
        }
      }
      const labelFade = reducedMotion() ? 0 : LABEL_FADE_MS;
      labelDraw.length = 0;
      for (const index of liveLabels) {
        const target = placed[index] ? 1 : 0;
        // While a star is lit, only its own name and its neighbours' remain.
        // A name hidden that way changes without a fade: nobody sees it.
        const shown = 1 - dim * (1 - (emphasis.get(index) ?? 0));
        const level =
          shown < 0.01 ? target : approach(labelAlpha[index], target, elapsed, labelFade, 0.01);
        labelAlpha[index] = level;
        if (level !== target) labelsMoving = true;
        if (level === 0) {
          liveLabels.delete(index);
          continue;
        }
        const alpha = level * reveal * shown * (live ? live.t[index] : 1);
        if (alpha >= 0.01) labelDraw.push(index, alpha);
      }
      const labelText = (index: number) =>
        index === motion.hover ? nodes[index].name : scene.labelText[index];
      const textLeft = (index: number) =>
        labelLeft(index) + (PILL_PAD_X - 2) * (motion.focus.get(index) ?? 0);
      // A halo in the page colour, under the stars, keeps text legible where
      // links cross it without cutting the stars beneath it into crescents.
      // The lit star's name sits on a pill instead.
      context.textBaseline = 'middle';
      context.lineJoin = 'round';
      for (let item = 0; item < labelDraw.length; item += 2) {
        const index = labelDraw[item];
        const pill = motion.focus.get(index) ?? 0;
        context.globalAlpha = labelDraw[item + 1];
        if (pill > 0) {
          const textWidth = index === motion.hover ? hoverLabelWidth(index) : labelWidthOf(index);
          context.globalAlpha *= pill;
          context.lineWidth = 1;
          context.fillStyle = colors.pill;
          context.strokeStyle = colors.pillBorder;
          context.beginPath();
          context.roundRect(
            labelLeft(index) - 2,
            screen.y[index] - PILL_HEIGHT / 2,
            textWidth + PILL_PAD_X * 2,
            PILL_HEIGHT,
            PILL_HEIGHT / 2
          );
          context.fill();
          context.stroke();
        } else {
          context.lineWidth = 3;
          context.strokeStyle = colors.halo;
          context.strokeText(labelText(index), labelLeft(index), screen.y[index]);
        }
      }
      context.lineWidth = 1;

      for (const bucket of fillBuckets) bucket.length = 0;
      for (const bucket of strokeBuckets) bucket.length = 0;
      for (let index = 0; index < count; index++) {
        const style = scene.styles[index];
        const self = motion.focus.get(index) ?? 0;
        radius[index] = style.radius + STAR_HOVER_GROWTH * self;
        const x = screen.x[index];
        const y = screen.y[index];
        if (x < -20 || y < -20 || x > width + 20 || y > height + 20) continue;
        const rest = style.alpha + (STAR_DIMMED_ALPHA - style.alpha) * dim;
        const lit = style.alpha + (STAR_ALPHA_MAX - style.alpha) * self;
        // Stars resolve out of the dark rather than arriving already lit.
        const arrival = live ? 0.2 + 0.8 * live.t[index] : 1;
        const alpha = (rest + (lit - rest) * (emphasis.get(index) ?? 0)) * arrival;
        const bucket = Math.round(clamp01(alpha) * ALPHA_STEPS);
        (nodes[index].isMissing ? strokeBuckets : fillBuckets)[bucket].push(index);
      }
      context.fillStyle = colors.star;
      context.strokeStyle = colors.missing;
      const drawStars = (bucket: number[], step: number, filled: boolean) => {
        if (bucket.length === 0) return;
        context.globalAlpha = step / ALPHA_STEPS;
        context.beginPath();
        for (const index of bucket) {
          context.moveTo(screen.x[index] + radius[index], screen.y[index]);
          context.arc(screen.x[index], screen.y[index], radius[index], 0, Math.PI * 2);
        }
        if (filled) context.fill();
        else context.stroke();
      };
      for (let step = 1; step <= ALPHA_STEPS; step++) {
        drawStars(fillBuckets[step], step, true);
        drawStars(strokeBuckets[step], step, false);
      }

      if (motion.fromKeyboard && motion.hover >= 0) {
        const index = motion.hover;
        context.globalAlpha = 1;
        context.strokeStyle = colors.focus;
        context.lineWidth = 1.5;
        context.beginPath();
        context.arc(
          screen.x[index],
          screen.y[index],
          radius[index] + KEYBOARD_RING_GAP,
          0,
          Math.PI * 2
        );
        context.stroke();
        context.lineWidth = 1;
      }

      // The open note's ring is a DOM element so its slow breathing runs on
      // the compositor; a canvas ring would need this loop awake forever.
      const ringElement = ringRef.current;
      if (ringElement) {
        const x = current >= 0 ? screen.x[current] : NaN;
        const y = current >= 0 ? screen.y[current] : NaN;
        const shown = current >= 0 && x > -20 && y > -20 && x < width + 20 && y < height + 20;
        if (shown !== ring.shown) {
          ring.shown = shown;
          ringElement.style.display = shown ? 'block' : 'none';
        }
        if (shown) {
          const size = Math.round((radius[current] + CURRENT_RING_GAP) * 2 * 2) / 2;
          const emphasized = emphasis.get(current) ?? 0;
          const opacity =
            Math.round(
              (1 + (STAR_DIMMED_ALPHA - 1) * dim * (1 - emphasized)) *
                (live ? live.t[current] : 1) *
                100
            ) / 100;
          if (size !== ring.size) {
            ring.size = size;
            ringElement.style.width = `${size}px`;
            ringElement.style.height = `${size}px`;
          }
          if (x !== ring.x || y !== ring.y || size !== ring.size) {
            ring.x = x;
            ring.y = y;
            ringElement.style.transform = `translate(${x - size / 2}px, ${y - size / 2}px)`;
          }
          if (opacity !== ring.opacity) {
            ring.opacity = opacity;
            ringElement.style.opacity = String(opacity);
          }
        }
      }

      context.fillStyle = colors.label;
      let litAlpha = 0;
      for (let item = 0; item < labelDraw.length; item += 2) {
        const index = labelDraw[item];
        if (index === motion.hover) {
          litAlpha = labelDraw[item + 1];
          continue;
        }
        context.globalAlpha = labelDraw[item + 1];
        context.fillText(labelText(index), textLeft(index), screen.y[index]);
      }
      if (litAlpha > 0) {
        context.globalAlpha = litAlpha;
        context.font = boldFont;
        context.fillStyle = colors.star;
        context.fillText(labelText(motion.hover), textLeft(motion.hover), screen.y[motion.hover]);
        context.font = labelFont;
      }
      context.globalAlpha = 1;
      return labelsMoving;
    };

    const schedule = () => {
      if (frameId === null && !document.hidden) frameId = requestAnimationFrame(frame);
    };

    const driftFrame = () =>
      count > 0 &&
      count <= DRIFT_MAX_NODES &&
      !document.hidden &&
      !reducedMotion() &&
      !entranceRef.current &&
      window.performance.now() - motion.lastInput < DRIFT_IDLE_MS;
    scheduleDrawRef.current = schedule;

    const frame = (time: number) => {
      frameId = null;
      const elapsed = lastTime === null ? FRAME_MS : Math.min(MAX_FRAME_STEP_MS, time - lastTime);
      lastTime = time;
      const advancing = advance(time, elapsed);
      const pinned = interactionRef.current?.mode === 'node' ? interactionRef.current.node : -1;
      const swayingNow = sway(elapsed, pinned);
      // Drift only moves on its own timer's frames, and only when nothing else
      // is moving, so it never adds to an interaction's work.
      const busy = advancing || swayingNow || labelsFading;
      if (driftDue && !busy && driftFrame()) driftClock += elapsed;
      driftDue = false;
      labelsFading = paint(elapsed);
      if (busy || labelsFading || entranceRef.current) {
        schedule();
        return;
      }
      if (fitAfterSettling) {
        fitAfterSettling = false;
        sessionView.fitted = true;
        if (!motion.viewTouched) fitToView();
      }
      if (frameId === null && driftTimer === null && driftFrame()) {
        driftTimer = setTimeout(() => {
          driftTimer = null;
          driftDue = true;
          schedule();
        }, DRIFT_FRAME_MS);
        return;
      }
      if (driftTimer === null) lastTime = null;
    };

    resize();
    if (initialFitRef.current) {
      initialFitRef.current = false;
      const target = fitTarget();
      if (target) moveViewTo(target, false);
    }
    schedule();

    // Resizing clears the bitmap, so repaint before the browser presents it.
    const handleResize = () => {
      resize();
      paint(0);
      schedule();
    };
    const observer =
      typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(handleResize);
    if (observer) observer.observe(container);
    else window.addEventListener('resize', handleResize);

    const themeObserver = new MutationObserver(() => {
      colors = readColors();
      schedule();
    });
    themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class', 'data-theme'],
    });

    const handleVisibility = () => {
      if (!document.hidden) {
        schedule();
        return;
      }
      if (frameId !== null) cancelAnimationFrame(frameId);
      if (driftTimer !== null) clearTimeout(driftTimer);
      frameId = null;
      driftTimer = null;
      lastTime = null;
    };
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      if (frameId !== null) cancelAnimationFrame(frameId);
      if (driftTimer !== null) clearTimeout(driftTimer);
      document.removeEventListener('visibilitychange', handleVisibility);
      observer?.disconnect();
      themeObserver.disconnect();
      if (!observer) window.removeEventListener('resize', handleResize);
      scheduleDrawRef.current = () => undefined;
      screen.painted = false;
    };
  }, [isOpen, graph, scene, clampPan, fitTarget, moveViewTo, fitToView]);

  /** The star painted nearest the pointer within `reach` px, or -1. */
  const pickNode = useCallback((clientX: number, clientY: number, reach = HOVER_REACH_PX) => {
    const container = containerRef.current;
    const screen = screenRef.current;
    if (!container || !screen.painted) return -1;
    const rect = container.getBoundingClientRect();
    const pointerX = clientX - rect.left;
    const pointerY = clientY - rect.top;
    let closest = -1;
    let closestDistance = reach;
    for (let index = 0; index < screen.x.length; index++) {
      const distance = Math.hypot(screen.x[index] - pointerX, screen.y[index] - pointerY);
      if (distance < closestDistance) {
        closest = index;
        closestDistance = distance;
      }
    }
    return closest;
  }, []);

  /** Light `index`, or start letting go of the lit star when it is -1. */
  const setHover = useCallback((index: number, fromKeyboard = false) => {
    const motion = motionRef.current;
    if (index >= 0) {
      motion.leaving = false;
      motion.leaveStart = null;
      if (motion.hover === index && motion.fromKeyboard === fromKeyboard) return;
      motion.hover = index;
      motion.fromKeyboard = fromKeyboard;
    } else {
      if (motion.hover < 0 || motion.leaving) return;
      motion.leaving = true;
      motion.leaveStart = null;
    }
    const canvas = canvasRef.current;
    if (canvas && !interactionRef.current) {
      canvas.style.cursor = index >= 0 && !fromKeyboard ? 'pointer' : 'grab';
    }
    scheduleDrawRef.current();
  }, []);

  const openGraphNode = useCallback(
    async (nodeId: string) => {
      const target = noteForGraphNode(notes, nodeId);
      if (!target) return;
      close();
      try {
        await loadNote(target);
      } catch (caught) {
        console.error('[GraphView] Failed to open note:', caught);
      }
    },
    [notes, close, loadNote]
  );

  /** Input keeps the ambient drift going, and wakes it once it has stopped. */
  const noteInput = useCallback(() => {
    const motion = motionRef.current;
    const now = window.performance.now();
    const stopped = now - motion.lastInput >= DRIFT_IDLE_MS;
    motion.lastInput = now;
    if (stopped) scheduleDrawRef.current();
  }, []);

  const handlePointerDown = useCallback(
    (event: React.PointerEvent<HTMLCanvasElement>) => {
      if (event.button !== 0) return;
      noteInput();
      const motion = motionRef.current;
      motion.tween = null;
      motion.inertia = null;
      motion.zoomTarget = null;
      const pointers = pointersRef.current;
      // Nothing in progress means no finger is down, whatever a lost pointerup left behind.
      if (!interactionRef.current) pointers.clear();
      pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      event.currentTarget.setPointerCapture(event.pointerId);
      const container = containerRef.current;
      if (pointers.size === 2 && container) {
        // A second finger turns whatever the first was doing into a pinch.
        const [a, b] = [...pointers.values()];
        const rect = container.getBoundingClientRect();
        const midX = (a.x + b.x) / 2 - rect.left - rect.width / 2;
        const midY = (a.y + b.y) / 2 - rect.top - rect.height / 2;
        pinchRef.current = {
          distance: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)),
          zoom: zoomRef.current,
          logicalX: (midX - panRef.current.x) / zoomRef.current,
          logicalY: (midY - panRef.current.y) / zoomRef.current,
        };
        interactionRef.current = {
          mode: 'pinch',
          pointerId: -1,
          node: -1,
          startX: 0,
          startY: 0,
          lastX: 0,
          lastY: 0,
          moved: true,
          velocityX: 0,
          velocityY: 0,
          sampledAt: 0,
          pendingX: 0,
          pendingY: 0,
        };
        motion.viewTouched = true;
        return;
      }
      if (pointers.size > 2) return;
      const node = pickNode(
        event.clientX,
        event.clientY,
        isTouch(event) ? TOUCH_REACH_PX : HOVER_REACH_PX
      );
      interactionRef.current = {
        mode: node >= 0 ? 'node' : 'pan',
        pointerId: event.pointerId,
        node,
        startX: event.clientX,
        startY: event.clientY,
        lastX: event.clientX,
        lastY: event.clientY,
        moved: false,
        velocityX: 0,
        velocityY: 0,
        sampledAt: window.performance.now(),
        pendingX: 0,
        pendingY: 0,
      };
      event.currentTarget.style.cursor = 'grabbing';
    },
    [pickNode, noteInput]
  );

  const handlePointerMove = useCallback(
    (event: React.PointerEvent<HTMLCanvasElement>) => {
      noteInput();
      const pointer = pointersRef.current.get(event.pointerId);
      if (pointer) {
        pointer.x = event.clientX;
        pointer.y = event.clientY;
      }
      const interaction = interactionRef.current;
      const motion = motionRef.current;
      if (!interaction) {
        let index = pickNode(event.clientX, event.clientY);
        if (index < 0 && motion.hover >= 0 && !motion.fromKeyboard && !motion.leaving) {
          // Hysteresis: a lit star lets go a little further out than it lights.
          const kept = pickNode(event.clientX, event.clientY, HOVER_REACH_PX * HOVER_KEEP_FACTOR);
          if (kept === motion.hover) index = kept;
        }
        setHover(index);
        return;
      }
      const container = containerRef.current;
      if (interaction.mode === 'pinch') {
        const pinch = pinchRef.current;
        if (!pinch || !container || pointersRef.current.size < 2) return;
        const [a, b] = [...pointersRef.current.values()];
        const rect = container.getBoundingClientRect();
        const zoom = clampZoom(
          pinch.zoom * (Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)) / pinch.distance)
        );
        const midX = (a.x + b.x) / 2 - rect.left - rect.width / 2;
        const midY = (a.y + b.y) / 2 - rect.top - rect.height / 2;
        zoomRef.current = zoom;
        panRef.current = { x: midX - pinch.logicalX * zoom, y: midY - pinch.logicalY * zoom };
        clampPan();
        scheduleDrawRef.current();
        return;
      }
      if (event.pointerId !== interaction.pointerId) return;
      const deltaX = event.clientX - interaction.lastX;
      const deltaY = event.clientY - interaction.lastY;
      if (Math.hypot(event.clientX - interaction.startX, event.clientY - interaction.startY) > 3) {
        interaction.moved = true;
      }
      if (interaction.mode === 'pan') {
        panRef.current = { x: panRef.current.x + deltaX, y: panRef.current.y + deltaY };
        clampPan();
        if (interaction.moved) motion.viewTouched = true;
        interaction.pendingX += deltaX;
        interaction.pendingY += deltaY;
        const now = window.performance.now();
        const sinceSample = now - interaction.sampledAt;
        if (sinceSample >= 8) {
          interaction.velocityX =
            interaction.velocityX * 0.3 + (interaction.pendingX / sinceSample) * 0.7;
          interaction.velocityY =
            interaction.velocityY * 0.3 + (interaction.pendingY / sinceSample) * 0.7;
          interaction.pendingX = 0;
          interaction.pendingY = 0;
          interaction.sampledAt = now;
        }
      } else if (interaction.node >= 0 && container) {
        const node = layoutRef.current[interaction.node];
        const rect = container.getBoundingClientRect();
        const options = layoutOptionsRef.current;
        const margin = collisionRadius(node);
        const x = (event.clientX - rect.left - rect.width / 2 - panRef.current.x) / zoomRef.current;
        const y = (event.clientY - rect.top - rect.height / 2 - panRef.current.y) / zoomRef.current;
        const nextX = Math.max(
          -options.width / 2 + margin,
          Math.min(options.width / 2 - margin, x)
        );
        const nextY = Math.max(
          -options.height / 2 + margin,
          Math.min(options.height / 2 - margin, y)
        );
        motion.pull.x += nextX - node.x;
        motion.pull.y += nextY - node.y;
        node.x = nextX;
        node.y = nextY;
        temperatureRef.current = Math.max(temperatureRef.current, DRAG_TEMPERATURE);
      }
      interaction.lastX = event.clientX;
      interaction.lastY = event.clientY;
      scheduleDrawRef.current();
    },
    [pickNode, clampPan, setHover, noteInput]
  );

  const finishPointer = useCallback(
    (event: React.PointerEvent<HTMLCanvasElement>, cancelled = false) => {
      const pointers = pointersRef.current;
      pointers.delete(event.pointerId);
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
      const interaction = interactionRef.current;
      if (!interaction) return;
      const motion = motionRef.current;
      if (interaction.mode === 'pinch') {
        pinchRef.current = null;
        const remaining = [...pointers.entries()][0];
        // The finger still down carries on as a pan, from where it is now.
        interactionRef.current = remaining
          ? {
              ...interaction,
              mode: 'pan',
              pointerId: remaining[0],
              lastX: remaining[1].x,
              lastY: remaining[1].y,
              velocityX: 0,
              velocityY: 0,
            }
          : null;
        return;
      }
      if (interaction.pointerId !== event.pointerId) return;
      interactionRef.current = null;
      event.currentTarget.style.cursor =
        motion.hover >= 0 && !motion.fromKeyboard ? 'pointer' : 'grab';
      const nodeId = interaction.node >= 0 ? layoutRef.current[interaction.node]?.id : undefined;
      if (interaction.mode === 'pan' && interaction.moved) {
        const speed = Math.hypot(interaction.velocityX, interaction.velocityY);
        const recent = window.performance.now() - interaction.sampledAt < 60;
        if (!cancelled && recent && speed > 0.25 && !prefersReducedMotion()) {
          motion.inertia = { vx: interaction.velocityX, vy: interaction.velocityY };
          scheduleDrawRef.current();
        }
      } else if (interaction.mode === 'node' && interaction.moved) {
        temperatureRef.current = Math.max(temperatureRef.current, DRAG_TEMPERATURE);
        scheduleDrawRef.current();
      } else if (!cancelled && !interaction.moved && isTouch(event)) {
        // A finger cannot hover to learn which note a star is before opening
        // it: the first tap names the star and its neighbours, a second opens it.
        if (nodeId && interaction.node === motion.hover) {
          // Opened by the click that follows the lift. Closing the graph now
          // would hand that click to the note underneath, raising the keyboard.
          openOnClickRef.current = nodeId;
        } else {
          setHover(interaction.node);
        }
      } else if (!cancelled && !interaction.moved && nodeId) {
        void openGraphNode(nodeId);
      }
    },
    [openGraphNode, setHover]
  );

  const handleWheel = useCallback(
    (event: React.WheelEvent['nativeEvent']) => {
      event.preventDefault();
      noteInput();
      const container = containerRef.current;
      if (!container) return;
      const rect = container.getBoundingClientRect();
      const motion = motionRef.current;
      motion.tween = null;
      motion.inertia = null;
      motion.viewTouched = true;
      const pixels =
        event.deltaMode === 1
          ? event.deltaY * 33
          : event.deltaMode === 2
            ? event.deltaY * rect.height
            : event.deltaY;
      // Trackpad pinches arrive as ctrl+wheel with small deltas.
      const rate = event.ctrlKey ? PINCH_ZOOM_RATE : WHEEL_ZOOM_RATE;
      const anchorX = event.clientX - rect.left - rect.width / 2;
      const anchorY = event.clientY - rect.top - rect.height / 2;
      if (Math.abs(pixels) >= WHEEL_NOTCH_PX) {
        const base = motion.zoomTarget?.zoom ?? zoomRef.current;
        motion.zoomTarget = {
          zoom: clampZoom(base * Math.exp(-pixels * rate)),
          anchorX,
          anchorY,
        };
      } else {
        motion.zoomTarget = null;
        const oldZoom = zoomRef.current;
        const nextZoom = clampZoom(oldZoom * Math.exp(-pixels * rate));
        const logicalX = (anchorX - panRef.current.x) / oldZoom;
        const logicalY = (anchorY - panRef.current.y) / oldZoom;
        zoomRef.current = nextZoom;
        panRef.current = { x: anchorX - logicalX * nextZoom, y: anchorY - logicalY * nextZoom };
        clampPan();
      }
      scheduleDrawRef.current();
    },
    [clampPan, noteInput]
  );

  // React registers wheel listeners as passive, which would ignore preventDefault.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!isOpen || !canvas) return;
    canvas.addEventListener('wheel', handleWheel, { passive: false });
    return () => canvas.removeEventListener('wheel', handleWheel);
  }, [isOpen, handleWheel]);

  /** Light a star from the keyboard, say its name, and bring it into view. */
  const focusNode = useCallback(
    (index: number) => {
      const screen = screenRef.current;
      const container = containerRef.current;
      const node = layoutRef.current[index];
      if (!node || !container || !scene) return;
      setHover(index, true);
      const links = scene.neighbors[index].length;
      if (announceRef.current) {
        announceRef.current.textContent = `${node.name}, ${links} ${links === 1 ? 'link' : 'links'}`;
      }
      const rect = container.getBoundingClientRect();
      const margin = Math.min(80, rect.width / 4, rect.height / 4);
      const x = screen.x[index];
      const y = screen.y[index];
      if (x < margin || y < margin || x > rect.width - margin || y > rect.height - margin) {
        moveViewTo(
          {
            zoom: zoomRef.current,
            x: panRef.current.x + rect.width / 2 - x,
            y: panRef.current.y + rect.height / 2 - y,
          },
          true
        );
      }
    },
    [scene, setHover, moveViewTo]
  );

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLCanvasElement>) => {
      noteInput();
      const screen = screenRef.current;
      const container = containerRef.current;
      if (!screen.painted || screen.x.length === 0 || !container) return;
      const motion = motionRef.current;
      const direction = ARROW_DIRECTIONS[event.key];
      if (direction) {
        event.preventDefault();
        const from = motion.hover;
        let best = -1;
        let bestScore = Infinity;
        const rect = container.getBoundingClientRect();
        const originX = from >= 0 ? screen.x[from] : rect.width / 2;
        const originY = from >= 0 ? screen.y[from] : rect.height / 2;
        for (let index = 0; index < screen.x.length; index++) {
          if (index === from) continue;
          const dx = screen.x[index] - originX;
          const dy = screen.y[index] - originY;
          if (from < 0) {
            const distance = Math.hypot(dx, dy);
            if (distance < bestScore) {
              best = index;
              bestScore = distance;
            }
            continue;
          }
          const along = dx * direction.x + dy * direction.y;
          const across = Math.abs(dx * direction.y - dy * direction.x);
          if (along <= 0 || across > along * 2) continue;
          const score = along + across * 2;
          if (score < bestScore) {
            best = index;
            bestScore = score;
          }
        }
        if (best >= 0) focusNode(best);
        return;
      }
      if ((event.key === 'Enter' || event.key === ' ') && motion.hover >= 0) {
        event.preventDefault();
        const node = layoutRef.current[motion.hover];
        if (node) void openGraphNode(node.id);
        return;
      }
      const zoomStep =
        event.key === '+' || event.key === '='
          ? KEY_ZOOM_STEP
          : event.key === '-' || event.key === '_'
            ? 1 / KEY_ZOOM_STEP
            : 0;
      if (zoomStep) {
        event.preventDefault();
        motion.tween = null;
        motion.viewTouched = true;
        const base = motion.zoomTarget?.zoom ?? zoomRef.current;
        motion.zoomTarget = { zoom: clampZoom(base * zoomStep), anchorX: 0, anchorY: 0 };
        scheduleDrawRef.current();
      } else if (event.key === '0') {
        event.preventDefault();
        fitToView();
      }
    },
    [focusNode, openGraphNode, fitToView, noteInput]
  );

  /** Double-clicking empty sky is the shortcut for Fit view. */
  const handleDoubleClick = useCallback(
    (event: React.MouseEvent<HTMLCanvasElement>) => {
      if (pickNode(event.clientX, event.clientY) >= 0) return;
      fitToView();
    },
    [pickNode, fitToView]
  );

  if (!isOpen) return null;

  return (
    // No `app-overlay` entrance here: its scale transform would be baked into
    // the canvas' backing-store size. The galaxy entrance is this surface's.
    <div
      className="graph-view fixed inset-y-0 z-[9998] flex flex-col"
      style={{
        backgroundColor: 'var(--bg-base)',
        // Start clear of the icon rail rather than under it: the rail sits in
        // normal flow at z-10000, so `inset-0` put this surface's first 48px
        // behind it and the "Graph" heading rendered as ".ph". Leaving the
        // rail exposed also keeps it usable, which is how you leave the graph.
        left: 'var(--rail-inset-left)',
        right: 'var(--rail-inset-right)',
      }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="graph-view-title"
    >
      <div
        className="graph-view-header flex items-center justify-between gap-6 px-5 py-3"
        style={{ borderBottom: '1px solid var(--border-default)' }}
      >
        <div className="flex items-baseline gap-4">
          <h2
            id="graph-view-title"
            className="m-0"
            style={{
              color: 'var(--text-primary)',
              fontFamily: 'var(--font-display)',
              fontSize: '17px',
              fontWeight: 500,
              letterSpacing: '-0.015em',
            }}
          >
            Graph
          </h2>
          {graph && (
            <span style={editorialLabel}>
              {graph.nodes.length} notes · {graph.edges.length} links
            </span>
          )}
          {loading && <span style={editorialLabel}>Loading…</span>}
          {error && (
            <span style={{ ...editorialLabel, color: 'var(--accent-danger)' }}>{error}</span>
          )}
        </div>
        <div className="flex items-center gap-5">
          <span className="app-overlay-hint" style={editorialLabel}>
            Drag to pan · Scroll to zoom · Double-click to fit
          </span>
          {graph && graph.nodes.length > 0 && (
            <button
              type="button"
              onClick={fitToView}
              className="pad-hover focus-ring graph-view-fit"
              style={{
                color: 'var(--text-secondary)',
                fontFamily: 'var(--font-display)',
                fontSize: '11px',
                letterSpacing: '0.08em',
                lineHeight: 1,
                textTransform: 'uppercase',
              }}
              title={
                isMobilePlatform()
                  ? 'Fit all notes in view'
                  : 'Fit all notes in view (double-click the canvas)'
              }
            >
              Fit view
            </button>
          )}
          <CloseButton ref={closeBtnRef} onClick={close} label="Close graph view" />
        </div>
      </div>

      <div ref={containerRef} className="graph-view-canvas relative flex-1 overflow-hidden">
        <canvas
          ref={canvasRef}
          tabIndex={0}
          role="application"
          aria-label="Note graph. Arrow keys move between notes, Enter opens one, plus and minus zoom, 0 fits the view."
          className="focus-ring"
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={(event) => finishPointer(event)}
          onPointerCancel={(event) => finishPointer(event, true)}
          // A lifted finger also leaves, which would drop the star its tap just named.
          onPointerLeave={(event) => {
            if (!interactionRef.current && !isTouch(event) && !motionRef.current.fromKeyboard) {
              setHover(-1);
            }
          }}
          onClick={() => {
            const nodeId = openOnClickRef.current;
            openOnClickRef.current = null;
            if (nodeId) void openGraphNode(nodeId);
          }}
          onDoubleClick={handleDoubleClick}
          onKeyDown={handleKeyDown}
          onBlur={() => {
            if (motionRef.current.fromKeyboard) setHover(-1);
          }}
          style={{ display: 'block', cursor: 'grab', touchAction: 'none' }}
        />
        <div
          ref={ringRef}
          aria-hidden="true"
          className="pointer-events-none absolute left-0 top-0"
          style={{ display: 'none', willChange: 'transform' }}
        >
          <div
            className="absolute inset-0"
            style={{
              border: '1px solid var(--accent-primary)',
              borderRadius: '50%',
              animation: 'pulse-subtle 4.8s ease-in-out infinite',
            }}
          />
        </div>
        <div ref={announceRef} className="sr-only" aria-live="polite" />
        {graph && graph.nodes.length === 0 && !loading && (
          <div className="absolute inset-0 flex items-center justify-center">
            <EmptyGraphEmptyState />
          </div>
        )}
      </div>
    </div>
  );
}

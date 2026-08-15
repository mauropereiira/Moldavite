import { type CSSProperties, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { EmptyGraphEmptyState } from '@/components/ui';
import { safeInvoke } from '@/lib/ipc';
import { useGraphStore, useNoteStore, useThemeStore } from '@/stores';
import { useNotes } from '@/hooks';
import { noteForGraphNode } from './addressing';
import {
  collisionRadius,
  initLayout,
  stepLayout,
  type GraphEdge,
  type GraphNode,
  type LayoutNode,
  type LayoutOptions,
} from './layout';

interface NoteGraphResponse {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

interface PointerInteraction {
  mode: 'pan' | 'node';
  pointerId: number;
  nodeId: string | null;
  startX: number;
  startY: number;
  lastX: number;
  lastY: number;
  moved: boolean;
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
  origins: EntranceOrigin[];
  x: Float64Array;
  y: Float64Array;
  t: Float64Array;
}

// Stars. Radius and brightness both rise with a note's link count, mirroring
// how stellar magnitude sizes the welcome screen's constellations.
const STAR_RADIUS_MIN = 1.9;
const STAR_RADIUS_MAX = 5;
const STAR_HOVER_GROWTH = 1.8;
const STAR_ALPHA_MIN = 0.55;
const STAR_ALPHA_MAX = 1;
const STAR_DIMMED_ALPHA = 0.14;
const FALLBACK_STAR: StarStyle = { radius: STAR_RADIUS_MIN, alpha: STAR_ALPHA_MIN };
/** Thin ring around the star of the note currently open behind the graph. */
const CURRENT_RING_GAP = 4;

// Constellation lines: hairlines, never gradients or glow.
const EDGE_ALPHA = 0.42;
const EDGE_ALPHA_DIMMED = 0.12;
const EDGE_ALPHA_ACTIVE = 0.8;

const LABEL_SIZE_PX = 11;
const LABEL_VISIBILITY_THRESHOLD = 0.62;
const LABEL_ALL_NODE_LIMIT = 180;
const MAX_RENDERED_EDGES = 12_000;
const MIN_ZOOM = 0.15;
const MAX_ZOOM = 3;
const SETTLED_TEMPERATURE = 0.35;
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

function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
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
    origins,
    x: Float64Array.from(origins, (origin) => origin.x),
    y: Float64Array.from(origins, (origin) => origin.y),
    t: new Float64Array(origins.length),
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

/** Full-screen, path-addressed note graph rendered on a Canvas 2D surface. */
export function GraphView() {
  const isOpen = useGraphStore((state) => state.isOpen);
  const close = useGraphStore((state) => state.close);
  const notes = useNoteStore((state) => state.notes);
  const currentNoteId = useNoteStore((state) => state.currentNote?.id ?? null);
  const theme = useThemeStore((state) => state.theme);
  const preset = useThemeStore((state) => state.preset);
  const { loadNote } = useNotes();

  const [graph, setGraph] = useState<NoteGraphResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
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
  const scheduleDrawRef = useRef<() => void>(() => undefined);

  const adjacency = useMemo(() => {
    const result = new Map<string, Set<string>>();
    if (!graph) return result;
    for (const edge of graph.edges) {
      if (!result.has(edge.source)) result.set(edge.source, new Set());
      if (!result.has(edge.target)) result.set(edge.target, new Set());
      result.get(edge.source)?.add(edge.target);
      result.get(edge.target)?.add(edge.source);
    }
    return result;
  }, [graph]);

  /** Hubs read as brighter, larger stars; a note with no links is the faintest. */
  const starStyles = useMemo(() => {
    const styles = new Map<string, StarStyle>();
    if (!graph) return styles;
    let maxDegree = 0;
    for (const neighbors of adjacency.values()) maxDegree = Math.max(maxDegree, neighbors.size);
    for (const node of graph.nodes) {
      const degree = adjacency.get(node.id)?.size ?? 0;
      const magnitude = maxDegree > 0 ? Math.sqrt(degree / maxDegree) : 0;
      styles.set(node.id, {
        radius: STAR_RADIUS_MIN + (STAR_RADIUS_MAX - STAR_RADIUS_MIN) * magnitude,
        alpha: STAR_ALPHA_MIN + (STAR_ALPHA_MAX - STAR_ALPHA_MIN) * magnitude,
      });
    }
    return styles;
  }, [graph, adjacency]);

  const renderedEdges = useMemo(() => {
    if (!graph || graph.edges.length <= MAX_RENDERED_EDGES) return graph?.edges ?? [];
    const stride = Math.ceil(graph.edges.length / MAX_RENDERED_EDGES);
    return graph.edges.filter((_, index) => index % stride === 0);
  }, [graph]);

  const resizeCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;
    const rect = container.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.max(1, Math.floor(rect.width * dpr));
    canvas.height = Math.max(1, Math.floor(rect.height * dpr));
    canvas.style.width = `${rect.width}px`;
    canvas.style.height = `${rect.height}px`;
    canvas.getContext('2d')?.setTransform(dpr, 0, 0, dpr, 0, 0);
  }, []);

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

  const fitToView = useCallback(() => {
    const container = containerRef.current;
    if (!container || layoutRef.current.length === 0) return;
    const rect = container.getBoundingClientRect();
    const bounds = layoutBounds(layoutRef.current);
    const availableWidth = Math.max(1, rect.width - 80);
    const availableHeight = Math.max(1, rect.height - 80);
    zoomRef.current = Math.max(
      MIN_ZOOM,
      Math.min(
        MAX_ZOOM,
        availableWidth / Math.max(1, bounds.maxX - bounds.minX),
        availableHeight / Math.max(1, bounds.maxY - bounds.minY)
      )
    );
    panRef.current = {
      x: -((bounds.minX + bounds.maxX) / 2) * zoomRef.current,
      y: -((bounds.minY + bounds.maxY) / 2) * zoomRef.current,
    };
    scheduleDrawRef.current();
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      setGraph(null);
      setHoveredId(null);
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

  useEffect(() => {
    if (!isOpen || !graph) return;
    let frameId: number | null = null;
    // The one automatic fit a session gets. Hover, theme, preset and every
    // other re-render deliberately leave the view exactly where the user put it.
    let fitAfterSettling = !sessionView.fitted;
    const indexById = new Map(layoutRef.current.map((node, index) => [node.id, index]));
    const neighbors = hoveredId ? adjacency.get(hoveredId) : undefined;

    const colors = {
      edge: readCssVar('--border-strong', '#b8b09c'),
      star: readCssVar('--text-primary', '#0e0d0a'),
      missing: readCssVar('--text-muted', '#9a8268'),
      label: readCssVar('--text-secondary', '#5a4530'),
      current: readCssVar('--accent-primary', '#2e5b3c'),
    };
    const labelFont = `${LABEL_SIZE_PX}px ${readCssVar('--font-sans', 'ui-sans-serif, system-ui, sans-serif')}`;

    const schedule = () => {
      if (frameId === null) frameId = requestAnimationFrame(draw);
    };
    scheduleDrawRef.current = schedule;

    const draw = (time: number) => {
      frameId = null;
      const canvas = canvasRef.current;
      const container = containerRef.current;
      const context = canvas?.getContext('2d');
      if (!canvas || !container || !context) return;

      const simulating = temperatureRef.current > SETTLED_TEMPERATURE;
      if (simulating) {
        stepLayout(
          layoutRef.current,
          graph.edges,
          temperatureRef.current,
          layoutOptionsRef.current,
          {
            pinnedNodeId:
              interactionRef.current?.mode === 'node' ? interactionRef.current.nodeId : null,
          }
        );
        temperatureRef.current *= layoutOptionsRef.current.cooling;
      }

      // Entrance positions are computed for every node up front so hit-testing,
      // edges and labels all read the same frame.
      const entrance = entranceRef.current;
      let entranceProgress = 1;
      if (entrance) {
        entrance.start ??= time;
        const elapsed = time - entrance.start;
        entranceProgress = clamp01(elapsed / (ENTRANCE_STAGGER_MS + ENTRANCE_TRAVEL_MS));
        for (let index = 0; index < layoutRef.current.length; index++) {
          const node = layoutRef.current[index];
          const origin = entrance.origins[index];
          const t = easeOutCubic(clamp01((elapsed - origin.delay) / ENTRANCE_TRAVEL_MS));
          entrance.t[index] = t;
          entrance.x[index] = origin.x + (node.x - origin.x) * t;
          entrance.y[index] = origin.y + (node.y - origin.y) * t;
        }
        if (entranceProgress >= 1) entranceRef.current = null;
      }
      const revealAlpha = clamp01(
        (entranceProgress - ENTRANCE_REVEAL_LEAD) / (1 - ENTRANCE_REVEAL_LEAD)
      );

      const rect = container.getBoundingClientRect();
      context.clearRect(0, 0, rect.width, rect.height);
      const centerX = rect.width / 2 + panRef.current.x;
      const centerY = rect.height / 2 + panRef.current.y;
      const zoom = zoomRef.current;
      const nodeX = (index: number) =>
        centerX + (entrance ? entrance.x[index] : layoutRef.current[index].x) * zoom;
      const nodeY = (index: number) =>
        centerY + (entrance ? entrance.y[index] : layoutRef.current[index].y) * zoom;

      const drawEdge = (edge: GraphEdge) => {
        const source = indexById.get(edge.source);
        const target = indexById.get(edge.target);
        if (source === undefined || target === undefined) return;
        context.moveTo(nodeX(source), nodeY(source));
        context.lineTo(nodeX(target), nodeY(target));
      };

      context.strokeStyle = colors.edge;
      context.lineWidth = 1;
      context.globalAlpha = (hoveredId ? EDGE_ALPHA_DIMMED : EDGE_ALPHA) * revealAlpha;
      context.beginPath();
      for (const edge of renderedEdges) drawEdge(edge);
      context.stroke();

      if (hoveredId) {
        context.globalAlpha = EDGE_ALPHA_ACTIVE * revealAlpha;
        context.beginPath();
        for (const edge of graph.edges) {
          if (edge.source === hoveredId || edge.target === hoveredId) drawEdge(edge);
        }
        context.stroke();
      }

      for (let index = 0; index < layoutRef.current.length; index++) {
        const node = layoutRef.current[index];
        const x = nodeX(index);
        const y = nodeY(index);
        if (x < -20 || y < -20 || x > rect.width + 20 || y > rect.height + 20) continue;
        const style = starStyles.get(node.id) ?? FALLBACK_STAR;
        const isHovered = node.id === hoveredId;
        const isNeighbor = neighbors?.has(node.id) ?? false;
        const radius = isHovered ? style.radius + STAR_HOVER_GROWTH : style.radius;
        const dimmed = hoveredId !== null && !isHovered && !isNeighbor;
        // Stars resolve out of the dark rather than arriving already lit.
        const arrival = entrance ? 0.2 + 0.8 * entrance.t[index] : 1;
        context.globalAlpha =
          (dimmed ? STAR_DIMMED_ALPHA : isHovered ? STAR_ALPHA_MAX : style.alpha) * arrival;
        context.beginPath();
        context.arc(x, y, radius, 0, Math.PI * 2);
        if (node.isMissing) {
          context.strokeStyle = colors.missing;
          context.stroke();
        } else {
          context.fillStyle = colors.star;
          context.fill();
        }
        // The one rationed accent on this surface.
        if (node.id === currentNoteId) {
          context.globalAlpha = (dimmed ? STAR_DIMMED_ALPHA : 1) * arrival;
          context.strokeStyle = colors.current;
          context.beginPath();
          context.arc(x, y, radius + CURRENT_RING_GAP, 0, Math.PI * 2);
          context.stroke();
        }
      }

      const showAllLabels =
        graph.nodes.length <= LABEL_ALL_NODE_LIMIT && zoom >= LABEL_VISIBILITY_THRESHOLD;
      context.globalAlpha = revealAlpha;
      context.font = labelFont;
      context.fillStyle = colors.label;
      context.textBaseline = 'middle';
      for (let index = 0; index < layoutRef.current.length; index++) {
        const node = layoutRef.current[index];
        const showLabel =
          showAllLabels || node.id === hoveredId || (neighbors?.has(node.id) ?? false);
        if (!showLabel) continue;
        const x = nodeX(index);
        const y = nodeY(index);
        if (x < -100 || y < -20 || x > rect.width + 20 || y > rect.height + 20) continue;
        const style = starStyles.get(node.id) ?? FALLBACK_STAR;
        context.fillText(node.name, x + style.radius + STAR_HOVER_GROWTH + 4, y);
      }
      context.globalAlpha = 1;

      if (simulating || entranceRef.current) {
        schedule();
      } else if (fitAfterSettling) {
        fitAfterSettling = false;
        sessionView.fitted = true;
        fitToView();
      }
    };

    resizeCanvas();
    if (initialFitRef.current) {
      initialFitRef.current = false;
      fitToView();
    }
    schedule();

    const handleResize = () => {
      resizeCanvas();
      schedule();
    };
    const observer =
      typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(handleResize);
    if (observer) observer.observe(containerRef.current as Element);
    else window.addEventListener('resize', handleResize);

    const themeObserver = new MutationObserver(() => {
      colors.edge = readCssVar('--border-strong', colors.edge);
      colors.star = readCssVar('--text-primary', colors.star);
      colors.missing = readCssVar('--text-muted', colors.missing);
      colors.label = readCssVar('--text-secondary', colors.label);
      colors.current = readCssVar('--accent-primary', colors.current);
      schedule();
    });
    themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class', 'data-theme'],
    });

    return () => {
      if (frameId !== null) cancelAnimationFrame(frameId);
      observer?.disconnect();
      themeObserver.disconnect();
      if (!observer) window.removeEventListener('resize', handleResize);
      scheduleDrawRef.current = () => undefined;
    };
  }, [
    isOpen,
    graph,
    hoveredId,
    adjacency,
    starStyles,
    currentNoteId,
    renderedEdges,
    resizeCanvas,
    fitToView,
    theme,
    preset,
  ]);

  const pickNode = useCallback((clientX: number, clientY: number): LayoutNode | null => {
    const container = containerRef.current;
    if (!container) return null;
    const rect = container.getBoundingClientRect();
    const pointerX = clientX - rect.left;
    const pointerY = clientY - rect.top;
    const centerX = rect.width / 2 + panRef.current.x;
    const centerY = rect.height / 2 + panRef.current.y;
    const entrance = entranceRef.current;
    let closest: LayoutNode | null = null;
    let closestDistance = 12;
    for (let index = 0; index < layoutRef.current.length; index++) {
      const node = layoutRef.current[index];
      const distance = Math.hypot(
        centerX + (entrance ? entrance.x[index] : node.x) * zoomRef.current - pointerX,
        centerY + (entrance ? entrance.y[index] : node.y) * zoomRef.current - pointerY
      );
      if (distance < closestDistance) {
        closest = node;
        closestDistance = distance;
      }
    }
    return closest;
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

  const handlePointerDown = useCallback(
    (event: React.PointerEvent<HTMLCanvasElement>) => {
      if (event.button !== 0) return;
      const node = pickNode(event.clientX, event.clientY);
      interactionRef.current = {
        mode: node ? 'node' : 'pan',
        pointerId: event.pointerId,
        nodeId: node?.id ?? null,
        startX: event.clientX,
        startY: event.clientY,
        lastX: event.clientX,
        lastY: event.clientY,
        moved: false,
      };
      event.currentTarget.setPointerCapture(event.pointerId);
      event.currentTarget.style.cursor = 'grabbing';
    },
    [pickNode]
  );

  const handlePointerMove = useCallback(
    (event: React.PointerEvent<HTMLCanvasElement>) => {
      const interaction = interactionRef.current;
      if (!interaction) {
        const node = pickNode(event.clientX, event.clientY);
        setHoveredId((current) => (current === node?.id ? current : (node?.id ?? null)));
        return;
      }
      const deltaX = event.clientX - interaction.lastX;
      const deltaY = event.clientY - interaction.lastY;
      if (Math.hypot(event.clientX - interaction.startX, event.clientY - interaction.startY) > 3) {
        interaction.moved = true;
      }
      if (interaction.mode === 'pan') {
        panRef.current = { x: panRef.current.x + deltaX, y: panRef.current.y + deltaY };
        clampPan();
      } else if (interaction.nodeId) {
        const node = layoutRef.current.find((candidate) => candidate.id === interaction.nodeId);
        const container = containerRef.current;
        if (node && container) {
          const rect = container.getBoundingClientRect();
          node.x =
            (event.clientX - rect.left - rect.width / 2 - panRef.current.x) / zoomRef.current;
          node.y =
            (event.clientY - rect.top - rect.height / 2 - panRef.current.y) / zoomRef.current;
          const options = layoutOptionsRef.current;
          const margin = collisionRadius(node);
          node.x = Math.max(
            -options.width / 2 + margin,
            Math.min(options.width / 2 - margin, node.x)
          );
          node.y = Math.max(
            -options.height / 2 + margin,
            Math.min(options.height / 2 - margin, node.y)
          );
          temperatureRef.current = Math.max(temperatureRef.current, 9);
        }
      }
      interaction.lastX = event.clientX;
      interaction.lastY = event.clientY;
      scheduleDrawRef.current();
    },
    [pickNode, clampPan]
  );

  const finishPointer = useCallback(
    (event: React.PointerEvent<HTMLCanvasElement>, cancelled = false) => {
      const interaction = interactionRef.current;
      if (!interaction || interaction.pointerId !== event.pointerId) return;
      interactionRef.current = null;
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
      event.currentTarget.style.cursor = hoveredId ? 'pointer' : 'grab';
      if (interaction.mode === 'node' && interaction.moved) {
        temperatureRef.current = Math.max(temperatureRef.current, 9);
        scheduleDrawRef.current();
      } else if (!cancelled && !interaction.moved && interaction.nodeId) {
        void openGraphNode(interaction.nodeId);
      }
    },
    [hoveredId, openGraphNode]
  );

  const handleWheel = useCallback(
    (event: React.WheelEvent<HTMLCanvasElement>) => {
      event.preventDefault();
      const container = containerRef.current;
      if (!container) return;
      const rect = container.getBoundingClientRect();
      const oldZoom = zoomRef.current;
      const nextZoom = Math.max(
        MIN_ZOOM,
        Math.min(MAX_ZOOM, oldZoom * Math.exp(-event.deltaY * 0.0015))
      );
      const pointerX = event.clientX - rect.left - rect.width / 2;
      const pointerY = event.clientY - rect.top - rect.height / 2;
      const logicalX = (pointerX - panRef.current.x) / oldZoom;
      const logicalY = (pointerY - panRef.current.y) / oldZoom;
      zoomRef.current = nextZoom;
      panRef.current = {
        x: pointerX - logicalX * nextZoom,
        y: pointerY - logicalY * nextZoom,
      };
      clampPan();
      scheduleDrawRef.current();
    },
    [clampPan]
  );

  /** Double-clicking empty sky is the shortcut for Fit view. */
  const handleDoubleClick = useCallback(
    (event: React.MouseEvent<HTMLCanvasElement>) => {
      if (pickNode(event.clientX, event.clientY)) return;
      fitToView();
    },
    [pickNode, fitToView]
  );

  if (!isOpen) return null;

  return (
    // No `app-overlay` entrance here: its scale transform would be baked into
    // the canvas' backing-store size. The galaxy entrance is this surface's.
    <div
      className="fixed inset-0 z-[9998] flex flex-col"
      style={{ backgroundColor: 'var(--bg-base)' }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="graph-view-title"
    >
      <div
        className="flex items-baseline justify-between gap-6 px-5 py-3"
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
        <div className="flex items-baseline gap-5">
          <span style={editorialLabel}>Drag to pan · Scroll to zoom · Double-click to fit</span>
          {graph && graph.nodes.length > 0 && (
            <button
              type="button"
              onClick={fitToView}
              className="focus-ring"
              style={{
                color: 'var(--text-secondary)',
                fontFamily: 'var(--font-display)',
                fontSize: '11px',
                letterSpacing: '0.08em',
                lineHeight: 1,
                textTransform: 'uppercase',
              }}
              title="Fit all notes in view (double-click the canvas)"
            >
              Fit view
            </button>
          )}
          <button
            ref={closeBtnRef}
            type="button"
            onClick={close}
            className="focus-ring"
            style={{
              color: 'var(--text-muted)',
              fontFamily: 'var(--font-display)',
              fontSize: '20px',
              lineHeight: 1,
            }}
            aria-label="Close graph view"
            title="Close (Esc)"
          >
            ×
          </button>
        </div>
      </div>

      <div ref={containerRef} className="relative flex-1 overflow-hidden">
        <canvas
          ref={canvasRef}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={(event) => finishPointer(event)}
          onPointerCancel={(event) => finishPointer(event, true)}
          onPointerLeave={() => {
            if (!interactionRef.current) setHoveredId(null);
          }}
          onDoubleClick={handleDoubleClick}
          onWheel={handleWheel}
          style={{ display: 'block', cursor: hoveredId ? 'pointer' : 'grab', touchAction: 'none' }}
        />
        {graph && graph.nodes.length === 0 && !loading && (
          <div className="absolute inset-0 flex items-center justify-center">
            <EmptyGraphEmptyState />
          </div>
        )}
      </div>
    </div>
  );
}

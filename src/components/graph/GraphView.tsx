import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Maximize2, X } from 'lucide-react';
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

const NODE_RADIUS = 5;
const NODE_RADIUS_HOVER = 7;
const LABEL_FONT = '11px ui-sans-serif, system-ui, sans-serif';
const LABEL_VISIBILITY_THRESHOLD = 0.62;
const LABEL_ALL_NODE_LIMIT = 180;
const MAX_RENDERED_EDGES = 12_000;
const MIN_ZOOM = 0.15;
const MAX_ZOOM = 3;
const SETTLED_TEMPERATURE = 0.35;
const PAN_VISIBLE_MARGIN = 48;

function readCssVar(name: string, fallback: string): string {
  if (typeof window === 'undefined') return fallback;
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
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

/** Full-screen, path-addressed note graph rendered on a Canvas 2D surface. */
export function GraphView() {
  const isOpen = useGraphStore((state) => state.isOpen);
  const close = useGraphStore((state) => state.close);
  const notes = useNoteStore((state) => state.notes);
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

  const clampPan = useCallback(() => {
    const container = containerRef.current;
    if (!container || layoutRef.current.length === 0) return;
    const rect = container.getBoundingClientRect();
    const bounds = layoutBounds(layoutRef.current);
    const zoom = zoomRef.current;
    const minPanX = -rect.width / 2 - bounds.maxX * zoom + PAN_VISIBLE_MARGIN;
    const maxPanX = rect.width / 2 - bounds.minX * zoom - PAN_VISIBLE_MARGIN;
    const minPanY = -rect.height / 2 - bounds.maxY * zoom + PAN_VISIBLE_MARGIN;
    const maxPanY = rect.height / 2 - bounds.minY * zoom - PAN_VISIBLE_MARGIN;
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
        zoomRef.current = 1;
        panRef.current = { x: 0, y: 0 };
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
    let fitAfterSettling = temperatureRef.current > SETTLED_TEMPERATURE;
    const byId = new Map(layoutRef.current.map((node) => [node.id, node]));
    const neighbors = hoveredId ? adjacency.get(hoveredId) : undefined;

    const colors = {
      edge: readCssVar('--border-strong', '#78847d'),
      node: readCssVar('--accent-primary', '#4f8060'),
      nodeHover: readCssVar('--text-primary', '#f5f7f5'),
      label: readCssVar('--text-secondary', '#8a9a8f'),
      missing: readCssVar('--text-muted', '#718078'),
    };

    const schedule = () => {
      if (frameId === null) frameId = requestAnimationFrame(draw);
    };
    scheduleDrawRef.current = schedule;

    const drawEdge = (
      context: CanvasRenderingContext2D,
      edge: GraphEdge,
      centerX: number,
      centerY: number,
      zoom: number
    ) => {
      const source = byId.get(edge.source);
      const target = byId.get(edge.target);
      if (!source || !target) return;
      context.moveTo(centerX + source.x * zoom, centerY + source.y * zoom);
      context.lineTo(centerX + target.x * zoom, centerY + target.y * zoom);
    };

    const draw = () => {
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

      const rect = container.getBoundingClientRect();
      context.clearRect(0, 0, rect.width, rect.height);
      const centerX = rect.width / 2 + panRef.current.x;
      const centerY = rect.height / 2 + panRef.current.y;
      const zoom = zoomRef.current;

      context.strokeStyle = colors.edge;
      context.lineWidth = 1;
      context.globalAlpha = hoveredId ? 0.12 : 0.32;
      context.beginPath();
      for (const edge of renderedEdges) drawEdge(context, edge, centerX, centerY, zoom);
      context.stroke();

      if (hoveredId) {
        context.globalAlpha = 0.85;
        context.lineWidth = 1.5;
        context.beginPath();
        for (const edge of graph.edges) {
          if (edge.source === hoveredId || edge.target === hoveredId) {
            drawEdge(context, edge, centerX, centerY, zoom);
          }
        }
        context.stroke();
      }
      context.globalAlpha = 1;

      for (const node of layoutRef.current) {
        const x = centerX + node.x * zoom;
        const y = centerY + node.y * zoom;
        if (x < -20 || y < -20 || x > rect.width + 20 || y > rect.height + 20) continue;
        const isHovered = node.id === hoveredId;
        const isNeighbor = neighbors?.has(node.id) ?? false;
        context.globalAlpha = hoveredId && !isHovered && !isNeighbor ? 0.28 : 1;
        context.beginPath();
        context.arc(x, y, isHovered ? NODE_RADIUS_HOVER : NODE_RADIUS, 0, Math.PI * 2);
        if (node.isMissing) {
          context.strokeStyle = isHovered ? colors.nodeHover : colors.missing;
          context.lineWidth = 1.5;
          context.stroke();
        } else {
          context.fillStyle = isHovered || isNeighbor ? colors.nodeHover : colors.node;
          context.fill();
        }
      }
      context.globalAlpha = 1;

      const showAllLabels =
        graph.nodes.length <= LABEL_ALL_NODE_LIMIT && zoom >= LABEL_VISIBILITY_THRESHOLD;
      context.font = LABEL_FONT;
      context.fillStyle = colors.label;
      context.textBaseline = 'middle';
      for (const node of layoutRef.current) {
        const showLabel =
          showAllLabels || node.id === hoveredId || (neighbors?.has(node.id) ?? false);
        if (!showLabel) continue;
        const x = centerX + node.x * zoom;
        const y = centerY + node.y * zoom;
        if (x < -100 || y < -20 || x > rect.width + 20 || y > rect.height + 20) continue;
        context.fillText(node.name, x + NODE_RADIUS_HOVER + 4, y);
      }

      if (simulating) {
        schedule();
      } else if (fitAfterSettling && temperatureRef.current <= SETTLED_TEMPERATURE) {
        fitAfterSettling = false;
        fitToView();
      }
    };

    resizeCanvas();
    fitToView();
    schedule();

    const handleResize = () => {
      resizeCanvas();
      fitToView();
      schedule();
    };
    const observer =
      typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(handleResize);
    if (observer) observer.observe(containerRef.current as Element);
    else window.addEventListener('resize', handleResize);

    const themeObserver = new MutationObserver(() => {
      colors.edge = readCssVar('--border-strong', colors.edge);
      colors.node = readCssVar('--accent-primary', colors.node);
      colors.nodeHover = readCssVar('--text-primary', colors.nodeHover);
      colors.label = readCssVar('--text-secondary', colors.label);
      colors.missing = readCssVar('--text-muted', colors.missing);
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
  }, [isOpen, graph, hoveredId, adjacency, renderedEdges, resizeCanvas, fitToView, theme, preset]);

  const pickNode = useCallback((clientX: number, clientY: number): LayoutNode | null => {
    const container = containerRef.current;
    if (!container) return null;
    const rect = container.getBoundingClientRect();
    const pointerX = clientX - rect.left;
    const pointerY = clientY - rect.top;
    const centerX = rect.width / 2 + panRef.current.x;
    const centerY = rect.height / 2 + panRef.current.y;
    let closest: LayoutNode | null = null;
    let closestDistance = 12;
    for (const node of layoutRef.current) {
      const distance = Math.hypot(
        centerX + node.x * zoomRef.current - pointerX,
        centerY + node.y * zoomRef.current - pointerY
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

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-[9998] flex flex-col"
      style={{ backgroundColor: 'var(--bg-base)' }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="graph-view-title"
    >
      <div
        className="flex items-center justify-between px-4 py-2"
        style={{ borderBottom: '1px solid var(--border-default)' }}
      >
        <div className="flex items-center gap-3">
          <h2
            id="graph-view-title"
            className="m-0 text-sm font-semibold"
            style={{ color: 'var(--text-primary)' }}
          >
            Graph
          </h2>
          {graph && (
            <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
              {graph.nodes.length} notes · {graph.edges.length} links
            </span>
          )}
          {loading && (
            <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
              Loading…
            </span>
          )}
          {error && (
            <span className="text-xs" style={{ color: 'var(--accent-danger)' }}>
              {error}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          {graph && graph.nodes.length > 0 && (
            <button
              type="button"
              onClick={fitToView}
              className="flex items-center gap-1.5 px-2 py-1 text-xs focus-ring"
              style={{ borderRadius: 'var(--radius-sm)', color: 'var(--text-secondary)' }}
              title="Fit all notes in view"
            >
              <Maximize2 aria-hidden="true" className="h-3.5 w-3.5" />
              Fit view
            </button>
          )}
          <button
            ref={closeBtnRef}
            type="button"
            onClick={close}
            className="p-1 focus-ring"
            style={{ borderRadius: 'var(--radius-sm)', color: 'var(--text-muted)' }}
            aria-label="Close graph view"
            title="Close (Esc)"
          >
            <X aria-hidden="true" className="h-5 w-5" />
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

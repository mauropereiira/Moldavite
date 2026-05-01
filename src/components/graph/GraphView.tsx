import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { EmptyGraphEmptyState } from '@/components/ui';
import { safeInvoke } from '@/lib/ipc';
import { useGraphStore, useNoteStore } from '@/stores';
import { useNotes } from '@/hooks';
import {
  initLayout,
  stepLayout,
  type GraphEdge,
  type GraphNode,
  type LayoutNode,
} from './layout';
import type { NoteFile } from '@/types';

interface NoteGraphResponse {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

// Visual constants — tuned for readability at typical display sizes.
const NODE_RADIUS = 5;
const NODE_RADIUS_HOVER = 7;
const EDGE_OPACITY = 0.35;
const LABEL_FONT = '11px ui-sans-serif, system-ui, sans-serif';
const LABEL_VISIBILITY_THRESHOLD = 0.6; // zoom level at which labels appear

/**
 * Read a CSS custom property from `document.documentElement`. Falls back
 * to a provided default if the property is empty (e.g. early render).
 */
function readCssVar(name: string, fallback: string): string {
  if (typeof window === 'undefined') return fallback;
  const v = getComputedStyle(document.documentElement).getPropertyValue(name);
  return v.trim() || fallback;
}

/**
 * Full-screen graph overlay. Canvas 2D only — no third-party graph
 * libraries. Runs a small force-directed simulation on the main thread
 * (fine for the scale of a personal notes vault).
 */
export function GraphView() {
  const isOpen = useGraphStore((s) => s.isOpen);
  const close = useGraphStore((s) => s.close);
  const { notes } = useNoteStore();
  const { loadNote } = useNotes();

  const [graph, setGraph] = useState<NoteGraphResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const closeBtnRef = useRef<HTMLButtonElement | null>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const layoutRef = useRef<LayoutNode[]>([]);
  const tempRef = useRef<number>(100);
  const rafRef = useRef<number | null>(null);
  const zoomRef = useRef<number>(1);
  const panRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const dragRef = useRef<{ active: boolean; lastX: number; lastY: number }>({
    active: false,
    lastX: 0,
    lastY: 0,
  });

  // Lookup helper: raw filename -> NoteFile (for click-to-open).
  const notesByFilename = useMemo(() => {
    const map = new Map<string, NoteFile>();
    for (const n of notes) map.set(n.name, n);
    return map;
  }, [notes]);

  // Fetch graph whenever the overlay opens.
  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    safeInvoke<NoteGraphResponse>('get_note_graph')
      .then((result) => {
        if (cancelled) return;
        setGraph(result);
        layoutRef.current = initLayout(result.nodes, {
          width: 1200,
          height: 1200,
          optimalDistance: 60,
        });
        tempRef.current = 120;
        zoomRef.current = 1;
        panRef.current = { x: 0, y: 0 };
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [isOpen]);

  // Close on Escape. Local handler (not via the global shortcut system) so the
  // graph always owns its own dismissal regardless of shortcut configuration.
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        close();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [isOpen, close]);

  // Focus management: when the overlay opens, remember the previously focused
  // element and move focus into the dialog. When it closes, return focus to
  // the trigger so keyboard users aren't dropped at the top of the page.
  useEffect(() => {
    if (!isOpen) return;
    previousFocusRef.current =
      (document.activeElement as HTMLElement | null) ?? null;
    // Defer until the dialog is mounted and the close button ref has settled.
    const raf = requestAnimationFrame(() => {
      closeBtnRef.current?.focus();
    });
    return () => {
      cancelAnimationFrame(raf);
      const prev = previousFocusRef.current;
      if (prev && typeof prev.focus === 'function') {
        prev.focus();
      }
      previousFocusRef.current = null;
    };
  }, [isOpen]);

  // Resize canvas to match its container (handles DPR).
  const resizeCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;
    const rect = container.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.floor(rect.width * dpr);
    canvas.height = Math.floor(rect.height * dpr);
    canvas.style.width = `${rect.width}px`;
    canvas.style.height = `${rect.height}px`;
    const ctx = canvas.getContext('2d');
    if (ctx) ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }, []);

  // Main render + simulation loop.
  useEffect(() => {
    if (!isOpen || !graph) return;
    resizeCanvas();

    const onResize = () => resizeCanvas();
    window.addEventListener('resize', onResize);

    const edgeColor = readCssVar('--border-strong', '#888');
    const nodeColor = readCssVar('--accent-primary', '#6aa0ff');
    const nodeHoverColor = readCssVar('--text-primary', '#fff');
    const labelColor = readCssVar('--text-secondary', '#ccc');

    const draw = () => {
      const canvas = canvasRef.current;
      const container = containerRef.current;
      if (!canvas || !container) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      // Step simulation while it hasn't cooled down.
      if (tempRef.current > 0.5) {
        stepLayout(layoutRef.current, graph.edges, tempRef.current, {
          width: 1200,
          height: 1200,
          optimalDistance: 60,
        });
        tempRef.current *= 0.97;
      }

      const rect = container.getBoundingClientRect();
      ctx.clearRect(0, 0, rect.width, rect.height);

      const cx = rect.width / 2 + panRef.current.x;
      const cy = rect.height / 2 + panRef.current.y;
      const zoom = zoomRef.current;

      // Pre-compute screen positions for hit-testing and drawing.
      const screenPos = new Map<string, { x: number; y: number }>();
      for (const n of layoutRef.current) {
        screenPos.set(n.id, { x: cx + n.x * zoom, y: cy + n.y * zoom });
      }

      // Draw edges.
      ctx.strokeStyle = edgeColor;
      ctx.globalAlpha = EDGE_OPACITY;
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (const e of graph.edges) {
        const a = screenPos.get(e.source);
        const b = screenPos.get(e.target);
        if (!a || !b) continue;
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
      }
      ctx.stroke();
      ctx.globalAlpha = 1;

      // Draw nodes.
      for (const n of layoutRef.current) {
        const pos = screenPos.get(n.id);
        if (!pos) continue;
        const isHover = n.id === hoveredId;
        ctx.fillStyle = isHover ? nodeHoverColor : nodeColor;
        ctx.beginPath();
        ctx.arc(pos.x, pos.y, isHover ? NODE_RADIUS_HOVER : NODE_RADIUS, 0, Math.PI * 2);
        ctx.fill();
      }

      // Labels — only at sufficient zoom or for hovered node, to avoid clutter.
      if (zoom >= LABEL_VISIBILITY_THRESHOLD) {
        ctx.font = LABEL_FONT;
        ctx.fillStyle = labelColor;
        ctx.textBaseline = 'middle';
        for (const n of layoutRef.current) {
          const pos = screenPos.get(n.id);
          if (!pos) continue;
          ctx.fillText(n.name, pos.x + NODE_RADIUS + 4, pos.y);
        }
      } else if (hoveredId) {
        const hoveredNode = layoutRef.current.find((n) => n.id === hoveredId);
        const pos = hoveredNode ? screenPos.get(hoveredNode.id) : null;
        if (hoveredNode && pos) {
          ctx.font = LABEL_FONT;
          ctx.fillStyle = labelColor;
          ctx.textBaseline = 'middle';
          ctx.fillText(hoveredNode.name, pos.x + NODE_RADIUS_HOVER + 4, pos.y);
        }
      }

      rafRef.current = requestAnimationFrame(draw);
    };

    rafRef.current = requestAnimationFrame(draw);

    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      window.removeEventListener('resize', onResize);
    };
  }, [isOpen, graph, hoveredId, resizeCanvas]);

  // Convert a pointer event to simulation coordinates and find the closest
  // node within NODE_RADIUS_HOVER.
  const pickNode = useCallback((clientX: number, clientY: number): LayoutNode | null => {
    const container = containerRef.current;
    if (!container) return null;
    const rect = container.getBoundingClientRect();
    const zoom = zoomRef.current;
    const px = clientX - rect.left;
    const py = clientY - rect.top;
    const cx = rect.width / 2 + panRef.current.x;
    const cy = rect.height / 2 + panRef.current.y;

    let best: LayoutNode | null = null;
    let bestDist = NODE_RADIUS_HOVER + 2;
    for (const n of layoutRef.current) {
      const sx = cx + n.x * zoom;
      const sy = cy + n.y * zoom;
      const dx = sx - px;
      const dy = sy - py;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d < bestDist) {
        best = n;
        bestDist = d;
      }
    }
    return best;
  }, []);

  const handleMouseMove = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      if (dragRef.current.active) {
        const dx = e.clientX - dragRef.current.lastX;
        const dy = e.clientY - dragRef.current.lastY;
        panRef.current = {
          x: panRef.current.x + dx,
          y: panRef.current.y + dy,
        };
        dragRef.current.lastX = e.clientX;
        dragRef.current.lastY = e.clientY;
        return;
      }
      const n = pickNode(e.clientX, e.clientY);
      setHoveredId(n?.id ?? null);
    },
    [pickNode],
  );

  const handleMouseDown = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    dragRef.current = { active: true, lastX: e.clientX, lastY: e.clientY };
    e.currentTarget.style.cursor = 'grabbing';
  }, []);

  const handleMouseUp = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    dragRef.current.active = false;
    e.currentTarget.style.cursor = '';
  }, []);

  const handleClick = useCallback(
    async (e: React.MouseEvent<HTMLCanvasElement>) => {
      // Distinguish click from pan — if the mouse moved during drag we
      // consumed it there and shouldn't treat as a click.
      const n = pickNode(e.clientX, e.clientY);
      if (!n) return;
      const target = notesByFilename.get(n.id);
      if (!target) {
        // Broken link — filename isn't in the notes list yet.
        return;
      }
      close();
      try {
        await loadNote(target);
      } catch (err) {
        console.error('[GraphView] Failed to open note:', err);
      }
    },
    [pickNode, notesByFilename, loadNote, close],
  );

  const handleWheel = useCallback((e: React.WheelEvent<HTMLCanvasElement>) => {
    const delta = -e.deltaY * 0.001;
    const next = Math.max(0.2, Math.min(4, zoomRef.current * (1 + delta)));
    zoomRef.current = next;
  }, []);

  if (!isOpen) return null;

  return (
    <div
      ref={dialogRef}
      className="fixed inset-0 z-[9998] flex flex-col"
      style={{ backgroundColor: 'var(--bg-base)' }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="graph-view-title"
    >
      {/* Header */}
      <div
        className="flex items-center justify-between px-4 py-2"
        style={{ borderBottom: '1px solid var(--border-default)' }}
      >
        <div className="flex items-center gap-3">
          <h2
            id="graph-view-title"
            className="text-sm font-semibold m-0"
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
            <span className="text-xs" style={{ color: 'var(--accent-danger, #e66)' }}>
              {error}
            </span>
          )}
        </div>
        <button
          ref={closeBtnRef}
          type="button"
          onClick={close}
          className="p-1 focus-ring"
          style={{
            borderRadius: 'var(--radius-sm)',
            color: 'var(--text-muted)',
          }}
          aria-label="Close graph view"
          title="Close (Esc)"
        >
          <X aria-hidden="true" className="w-5 h-5" />
        </button>
      </div>

      {/* Canvas container */}
      <div
        ref={containerRef}
        className="flex-1 relative overflow-hidden"
      >
        <canvas
          ref={canvasRef}
          onMouseMove={handleMouseMove}
          onMouseDown={handleMouseDown}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
          onClick={handleClick}
          onWheel={handleWheel}
          style={{ display: 'block', cursor: hoveredId ? 'pointer' : 'grab' }}
        />
        {graph && graph.nodes.length === 0 && !loading && (
          <div className="absolute inset-0 flex items-center justify-center">
            <EmptyGraphEmptyState />
          </div>
        )}
      </div>

      {/* Footer hint */}
      <div
        className="px-4 py-2 text-xs flex items-center gap-4"
        style={{
          borderTop: '1px solid var(--border-default)',
          color: 'var(--text-muted)',
        }}
      >
        <span>Click a node to open the note</span>
        <span>Drag to pan</span>
        <span>Scroll to zoom</span>
        <span className="ml-auto">Esc to close</span>
      </div>
    </div>
  );
}

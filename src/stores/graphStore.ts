/** Transient visibility state for the graph overlay; graph data is fetched on demand. */

import { createSurfaceStore } from './overlayStore';

/**
 * Visibility store for the full-screen graph-view overlay.
 *
 * Intentionally minimal — the actual graph data (nodes/edges) is fetched
 * by `GraphView` itself each time the overlay opens, so we don't pay the
 * memory cost while the overlay is closed.
 * Visibility is transient and never implies that graph data is current.
 *
 * The graph is one of the exclusive navigation surfaces, so `isOpen` mirrors
 * `useOverlayStore` and opening anything else closes it.
 */
export const useGraphStore = createSurfaceStore('graph');

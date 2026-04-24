import { create } from 'zustand';

/**
 * Visibility store for the full-screen graph-view overlay.
 *
 * Intentionally minimal — the actual graph data (nodes/edges) is fetched
 * by `GraphView` itself each time the overlay opens, so we don't pay the
 * memory cost while the overlay is closed.
 */
interface GraphState {
  isOpen: boolean;
  open: () => void;
  close: () => void;
  toggle: () => void;
}

export const useGraphStore = create<GraphState>((set) => ({
  isOpen: false,
  open: () => set({ isOpen: true }),
  close: () => set({ isOpen: false }),
  toggle: () => set((state) => ({ isOpen: !state.isOpen })),
}));

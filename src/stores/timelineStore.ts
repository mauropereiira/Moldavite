import { create } from 'zustand';

/**
 * Controls the Timeline view. When `isOpen` is true, the Layout swaps the
 * editor pane for `TimelineView`. State is intentionally not persisted — the
 * Timeline is a transient exploration mode, not a saved user preference.
 */
interface TimelineState {
  isOpen: boolean;
  open: () => void;
  close: () => void;
  toggle: () => void;
}

export const useTimelineStore = create<TimelineState>((set) => ({
  isOpen: false,
  open: () => set({ isOpen: true }),
  close: () => set({ isOpen: false }),
  toggle: () => set((state) => ({ isOpen: !state.isOpen })),
}));

/**
 * The one active navigation surface, plus transient pinned-column state.
 *
 * At most one of Index / Agenda / Graph / Timeline / Search is visible at a
 * time, and every entry point — icon rail, keyboard shortcuts, quick-switcher
 * commands, deep links — routes through `activeOverlay` here. Surfaces used to
 * own a private `isOpen` each, which is how the graph could stay up while the
 * index believed it had opened underneath it.
 *
 * `useGraphStore`, `useTimelineStore` and `useQuickSwitcherStore` keep their own
 * hook names, but their `isOpen` is a mirror of this store (see
 * `createSurfaceStore`) — never a second source of truth.
 *
 * Pin preferences live in settingsStore. This store only remembers what is
 * visible for the current window, so summoned overlays and temporarily hidden
 * pinned columns never leak into persisted settings.
 */

import { create } from 'zustand';

export type AppOverlay = 'index' | 'agenda' | 'graph' | 'timeline' | 'search';

interface OverlayState {
  activeOverlay: AppOverlay | null;
  isSidebarHidden: boolean;
  isRightPanelHidden: boolean;
  /** Make `surface` the active one, dismissing whatever was active before. */
  openSurface: (surface: AppOverlay) => void;
  /** Close `surface`, but only while it is the active one. */
  closeSurface: (surface: AppOverlay) => void;
  toggleSurface: (surface: AppOverlay) => void;
  openIndex: (pinned: boolean) => void;
  openAgenda: (pinned: boolean) => void;
  toggleIndex: (pinned: boolean) => void;
  toggleAgenda: (pinned: boolean) => void;
  /** Close whichever surface is active. */
  closeOverlay: () => void;
}

export const useOverlayStore = create<OverlayState>((set, get) => ({
  activeOverlay: null,
  isSidebarHidden: false,
  isRightPanelHidden: false,

  openSurface: (surface) => set({ activeOverlay: surface }),

  closeSurface: (surface) =>
    set((state) => (state.activeOverlay === surface ? { activeOverlay: null } : state)),

  toggleSurface: (surface) =>
    set((state) => ({ activeOverlay: state.activeOverlay === surface ? null : surface })),

  openIndex: (pinned) =>
    pinned ? set({ activeOverlay: null, isSidebarHidden: false }) : get().openSurface('index'),

  openAgenda: (pinned) =>
    pinned ? set({ activeOverlay: null, isRightPanelHidden: false }) : get().openSurface('agenda'),

  toggleIndex: (pinned) => {
    if (!pinned) return get().toggleSurface('index');
    // A pinned column can be buried under an active surface. "Show me the
    // Index" then means dismissing that surface, not hiding the column too.
    set((state) =>
      state.activeOverlay
        ? { activeOverlay: null, isSidebarHidden: false }
        : { isSidebarHidden: !state.isSidebarHidden }
    );
  },

  toggleAgenda: (pinned) => {
    if (!pinned) return get().toggleSurface('agenda');
    set((state) =>
      state.activeOverlay
        ? { activeOverlay: null, isRightPanelHidden: false }
        : { isRightPanelHidden: !state.isRightPanelHidden }
    );
  },

  closeOverlay: () => set({ activeOverlay: null }),
}));

export interface SurfaceState {
  isOpen: boolean;
  open: () => void;
  close: () => void;
  toggle: () => void;
}

/**
 * A store-shaped view of a single coordinator surface, so call sites can keep
 * using `useGraphStore((s) => s.isOpen)` and friends.
 *
 * `isOpen` is derived: write through the actions (or through `useOverlayStore`)
 * rather than `setState`, or the mirror and the coordinator will disagree.
 */
export function createSurfaceStore(surface: AppOverlay) {
  const useSurfaceStore = create<SurfaceState>(() => ({
    isOpen: useOverlayStore.getState().activeOverlay === surface,
    open: () => useOverlayStore.getState().openSurface(surface),
    close: () => useOverlayStore.getState().closeSurface(surface),
    toggle: () => useOverlayStore.getState().toggleSurface(surface),
  }));

  useOverlayStore.subscribe(({ activeOverlay }) => {
    const isOpen = activeOverlay === surface;
    if (useSurfaceStore.getState().isOpen !== isOpen) useSurfaceStore.setState({ isOpen });
  });

  return useSurfaceStore;
}

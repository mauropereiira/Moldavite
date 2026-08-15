/** Transient visibility state for replacing the editor pane with the Timeline view. */

import { createSurfaceStore } from './overlayStore';

/**
 * Controls the Timeline view. When `isOpen` is true, the Layout swaps the
 * editor pane for `TimelineView`. State is intentionally not persisted — the
 * Timeline is a transient exploration mode, not a saved user preference.
 * Opening the view carries no calendar-event cache or selection ownership.
 *
 * The Timeline is one of the exclusive navigation surfaces, so `isOpen` mirrors
 * `useOverlayStore` and opening anything else closes it.
 */
export const useTimelineStore = createSurfaceStore('timeline');

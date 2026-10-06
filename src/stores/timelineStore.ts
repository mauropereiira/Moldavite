import { createSurfaceStore } from './overlayStore';

/**
 * The Timeline, the history of what happened to notes. While `isOpen`, the
 * Layout shows `TimelineView` in place of the editor. Not persisted: like the
 * Graph it is somewhere you visit, and its `isOpen` mirrors `useOverlayStore`,
 * so opening any other surface closes it.
 */
export const useTimelineStore = createSurfaceStore('timeline');

/**
 * Public barrel for reusable React hooks.
 *
 * Hooks own component-facing effects and orchestration; filesystem and durable
 * state invariants remain in `lib/` and `stores/` rather than this re-export layer.
 *
 * @module hooks
 */

export { useAutoSave } from './useAutoSave';
export { useAutoLock } from './useAutoLock';
export { useKeyboardShortcuts } from './useKeyboardShortcuts';
export { initializeNotes, useNotes } from './useNotes';
export { useToast } from './useToast';
export { useSettings, useSettingsModal } from './useSettings';
export { useTemplates } from './useTemplates';
export { useFolders } from './useFolders';
export { useTrash } from './useTrash';
export { useSidebarContextMenu } from './useSidebarContextMenu';
export { useSidebarLock } from './useSidebarLock';
export { useSidebarTags } from './useSidebarTags';
export { useSidebarDnd } from './useSidebarDnd';
export { useForgeWatcher } from './useForgeWatcher';
export { useRelatedNotes } from './useRelatedNotes';
export { useFocusTrap } from './useFocusTrap';
export { useElementWidth } from './useElementWidth';
export { useVisualViewportHeight } from './useVisualViewportHeight';
export { usePluginHost } from './usePluginHost';
export { usePluginDeepLinks } from './usePluginDeepLinks';

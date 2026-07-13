/**
 * Public barrel for reusable React hooks.
 *
 * Hooks own component-facing effects and orchestration; filesystem and durable
 * state invariants remain in `lib/` and `stores/` rather than this re-export layer.
 *
 * ## Available Hooks
 *
 * - `useAutoSave` - Auto-saves notes after typing stops
 * - `useAutoLock` - Auto-locks notes after inactivity
 * - `useKeyboardShortcuts` - Global keyboard shortcuts
 * - `useNotes` - Note CRUD operations
 * - `useToast` - Toast notification display
 * - `useSettings` / `useSettingsModal` - Settings management
 * - `useTemplates` - Template operations
 * - `useFolders` - Folder operations
 * - `useTrash` - Trash operations
 *
 * @module hooks
 */

export { useAutoSave } from './useAutoSave';
export { useAutoLock } from './useAutoLock';
export { useKeyboardShortcuts } from './useKeyboardShortcuts';
export { useNotes } from './useNotes';
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
export { usePluginHost } from './usePluginHost';

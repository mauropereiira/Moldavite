/**
 * Custom React hooks for Notomattic
 *
 * These hooks encapsulate complex logic and provide clean interfaces
 * for components to interact with app features.
 *
 * ## Available Hooks
 *
 * - `useAutoSave` - Auto-saves notes after typing stops
 * - `useAutoLock` - Auto-locks notes after inactivity
 * - `useKeyboardShortcuts` - Global keyboard shortcuts
 * - `useNotes` - Note CRUD operations
 * - `useToast` - Toast notification display
 * - `useSettings` / `useSettingsModal` - Settings management
 * - `useSearch` - Note search functionality
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
export { useSearch } from './useSearch';
export { useTemplates } from './useTemplates';
export { useFolders } from './useFolders';
export { useTrash } from './useTrash';

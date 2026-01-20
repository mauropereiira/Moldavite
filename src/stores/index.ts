/**
 * Zustand state stores for Notomattic
 *
 * All stores use Zustand with persistence where appropriate.
 *
 * ## Available Stores
 *
 * - `useNoteStore` - Current note, notes list, tabs, saving state
 * - `useThemeStore` - Theme (light/dark/system) with persistence
 * - `useSettingsStore` - App settings with persistence
 * - `useToastStore` - Toast notifications
 * - `useCalendarStore` - Calendar integration state
 * - `useTemplateStore` - Template management
 * - `useNoteColorsStore` - Note color assignments
 * - `useUpdateStore` - App update state
 * - `useFolderStore` - Folder navigation state
 * - `useTrashStore` - Trash/recycle bin state
 * - `useTagStore` - Tag management state
 *
 * @module stores
 */

// Core stores
export { useNoteStore } from './noteStore';
export { useThemeStore, applyTheme } from './themeStore';
export { useToastStore } from './toastStore';
export type { Toast, ToastType } from './toastStore';

// Settings with helper functions
export { useSettingsStore, applyFontSize, applyLineHeight, applyCompactMode, applyFontFamily } from './settingsStore';
export type { FontSize, LineHeight, DefaultNoteType, FontFamily, AutoLockTimeout } from './settingsStore';

// Feature stores
export { useCalendarStore } from './calendarStore';
export { useTemplateStore } from './templateStore';
export { useNoteColorsStore, buildNotePath } from './noteColorsStore';
export { useUpdateStore } from './updateStore';
export { useFolderStore } from './folderStore';
export { useTrashStore } from './trashStore';
export { useTagStore } from './tagStore';
export { useTaskStatusStore } from './taskStatusStore';

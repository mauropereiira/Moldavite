/**
 * Public barrel for Zustand stores and their shared types/helpers.
 *
 * Persistence is store-specific and generally Forge-namespaced; importing concrete
 * modules is preferred where this barrel would create a library/store cycle.
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
 * - `useWhatsNewStore` - "What's New" release-notes popup state
 * - `useFolderStore` - Folder navigation state
 * - `useTrashStore` - Trash/recycle bin state
 * - `useTagStore` - Tag management state
 *
 * @module stores
 */

// Core stores
export { useNoteStore } from './noteStore';
export { useThemeStore, applyTheme, PRESETS } from './themeStore';
export type { BaseMode, ThemePreset, PresetCoverage, PresetMeta } from './themeStore';
export { useToastStore } from './toastStore';
export type { Toast, ToastType } from './toastStore';

// Settings with helper functions
export {
  useSettingsStore,
  applyFontSize,
  applyLineHeight,
  applyCompactMode,
  applyFontFamily,
} from './settingsStore';
export type {
  FontSize,
  LineHeight,
  DefaultNoteType,
  FontFamily,
  AutoLockTimeout,
  SettingsTab,
} from './settingsStore';

// Feature stores
export { useCalendarStore } from './calendarStore';
export { useTemplateStore } from './templateStore';
export { useNoteColorsStore, buildNotePath } from './noteColorsStore';
export { useUpdateStore, selectHasPendingUpdate } from './updateStore';
export { useWhatsNewStore } from './whatsNewStore';
export { usePluginCommandStore } from './pluginCommandStore';
export { usePluginStore } from './pluginStore';
export { usePluginInstallStore } from './pluginInstallStore';
export type { PluginInstallRequest } from './pluginInstallStore';
export { editorHandle } from './editorHandleStore';
export { useFolderStore } from './folderStore';
export { useTrashStore } from './trashStore';
export { useTagStore } from './tagStore';
export { useTaskStatusStore } from './taskStatusStore';
export { useSearchStore } from './searchStore';
export type { ContentMatch, SearchMode } from './searchStore';
export { useSemanticStore } from './semanticStore';
export { useTimelineStore } from './timelineStore';
export { useGraphStore } from './graphStore';
export { useNoteSelectionStore } from './noteSelectionStore';
export type { NoteSelectionState } from './noteSelectionStore';
export { useQuickSwitcherStore } from './quickSwitcherStore';
export { usePdfExportStore, PDF_MARGIN_MM } from './pdfExportStore';
export type { PdfPageSize, PdfMarginPreset } from './pdfExportStore';
export { useForgeStore } from './forgeStore';
export type { Forge } from './forgeStore';

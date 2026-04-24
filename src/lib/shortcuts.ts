/**
 * Keyboard shortcut registry — single source of truth.
 *
 * Both `useKeyboardShortcuts` (the handler) and `ShortcutHelpModal` (the UI)
 * consume this list, so the displayed shortcuts cannot drift from what the
 * app actually responds to.
 *
 * Each entry has a stable `id` used by the hook to dispatch to the correct
 * action. When adding a new shortcut, register it here FIRST, then wire the
 * `id` handler in `useKeyboardShortcuts.ts` (or wherever the listener lives).
 *
 * Key caps use the macOS glyphs (`⌘`, `⇧`, `⌥`, `⌃`). The hook matches on
 * `metaKey || ctrlKey` so shortcuts Just Work on Windows/Linux too.
 */

export type ShortcutCategory =
  | 'navigation'
  | 'editing'
  | 'formatting'
  | 'files'
  | 'search';

/**
 * Stable identifier for every shortcut in the app. The handler dispatches on
 * this id so we don't have to string-match key combos at the call site.
 */
export type ShortcutId =
  | 'quickSwitcher'
  | 'search'
  | 'settings'
  | 'newNote'
  | 'toggleTheme'
  | 'closeTab'
  | 'templatePicker'
  | 'insertLink'
  | 'shortcutHelp'
  | 'nextTab'
  | 'prevTab'
  | 'toggleGraph';

export interface Shortcut {
  id: ShortcutId;
  keys: string[];
  description: string;
  category: ShortcutCategory;
}

export const SHORTCUTS: Shortcut[] = [
  // Navigation
  {
    id: 'quickSwitcher',
    keys: ['⌘', 'P'],
    description: 'Open quick switcher',
    category: 'navigation',
  },
  {
    id: 'search',
    keys: ['⌘', 'F'],
    description: 'Focus sidebar search',
    category: 'search',
  },
  {
    id: 'settings',
    keys: ['⌘', ','],
    description: 'Open settings',
    category: 'navigation',
  },
  {
    id: 'shortcutHelp',
    keys: ['⌘', '/'],
    description: 'Show keyboard shortcuts',
    category: 'navigation',
  },

  // Files
  {
    id: 'newNote',
    keys: ['⌘', 'N'],
    description: 'Create a new note',
    category: 'files',
  },
  {
    id: 'closeTab',
    keys: ['⌘', 'W'],
    description: 'Close the active tab',
    category: 'files',
  },
  {
    id: 'templatePicker',
    keys: ['⌘', 'T'],
    description: 'Apply a template',
    category: 'files',
  },
  {
    id: 'nextTab',
    keys: ['⌘', '⌥', '→'],
    description: 'Switch to the next open tab',
    category: 'navigation',
  },
  {
    id: 'prevTab',
    keys: ['⌘', '⌥', '←'],
    description: 'Switch to the previous open tab',
    category: 'navigation',
  },
  {
    id: 'toggleGraph',
    keys: ['⌘', '⇧', 'G'],
    description: 'Toggle graph view',
    category: 'navigation',
  },

  // Editing
  {
    id: 'insertLink',
    keys: ['⌘', 'K'],
    description: 'Insert a link',
    category: 'editing',
  },

  // Formatting
  {
    id: 'toggleTheme',
    keys: ['⌘', '⇧', 'L'],
    description: 'Toggle light / dark theme',
    category: 'formatting',
  },
];

/** Human-readable labels for the category groups, in display order. */
export const CATEGORY_LABELS: Record<ShortcutCategory, string> = {
  navigation: 'Navigation',
  search: 'Search',
  files: 'Files',
  editing: 'Editing',
  formatting: 'Formatting',
};

export const CATEGORY_ORDER: ShortcutCategory[] = [
  'navigation',
  'search',
  'files',
  'editing',
  'formatting',
];

/**
 * Match a KeyboardEvent against a shortcut id. Uses `metaKey || ctrlKey` so
 * the same bindings work on macOS and other platforms.
 */
export function matchesShortcut(
  event: KeyboardEvent,
  id: ShortcutId,
): boolean {
  const isMod = event.metaKey || event.ctrlKey;
  const shortcut = SHORTCUTS.find((s) => s.id === id);
  if (!shortcut) return false;

  const needsShift = shortcut.keys.includes('⇧');
  if (needsShift !== event.shiftKey) return false;

  // Terminal (non-modifier) key is always the last entry.
  const terminal = shortcut.keys[shortcut.keys.length - 1].toLowerCase();

  if (!isMod && terminal !== '?' && terminal !== '/') return false;

  return event.key.toLowerCase() === terminal;
}

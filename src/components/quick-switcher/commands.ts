/**
 * Action command catalog for the QuickSwitcher.
 *
 * These are the typed commands the user can invoke from the same `⌘P` palette
 * as note search. Keeping the data here (separate from the React component)
 * lets us unit-test the filter logic without rendering anything.
 */

export type QuickSwitcherCommandCategory =
  | 'navigation'
  | 'notes'
  | 'view'
  | 'preferences'
  | 'help'
  | 'system';

export interface QuickSwitcherCommand {
  id: string;
  title: string;
  /** One-line description / keyboard hint shown on the right. */
  category: QuickSwitcherCommandCategory;
  /** Lower-cased haystack used by the fuzzy matcher. */
  keywords?: string[];
}

/**
 * Static command catalog. The handler for each id lives in QuickSwitcher.tsx
 * (it needs hooks/stores), but the metadata is colocated here so it's easy to
 * audit at a glance and to test the filtering rules in isolation.
 *
 * Order here is the canonical order shown when the input is empty.
 */
export const QUICK_SWITCHER_COMMANDS: readonly QuickSwitcherCommand[] = [
  {
    id: 'open-today',
    title: "Open Today's Note",
    category: 'notes',
    keywords: ['today', 'daily', 'journal'],
  },
  {
    id: 'new-note',
    title: 'New Note',
    category: 'notes',
    keywords: ['create', 'new', 'note'],
  },
  {
    id: 'new-note-from-template',
    title: 'New Note from Template…',
    category: 'notes',
    keywords: ['template', 'new', 'create'],
  },
  {
    id: 'open-graph',
    title: 'Open Graph View',
    category: 'view',
    keywords: ['graph', 'connections', 'view'],
  },
  {
    id: 'toggle-timeline',
    title: 'Toggle Timeline',
    category: 'view',
    keywords: ['timeline', 'history', 'right panel'],
  },
  {
    id: 'toggle-theme',
    title: 'Toggle Theme',
    category: 'preferences',
    keywords: ['theme', 'light', 'dark', 'appearance'],
  },
  {
    id: 'open-settings',
    title: 'Open Settings',
    category: 'preferences',
    keywords: ['settings', 'preferences', 'config'],
  },
  {
    id: 'shortcut-help',
    title: 'Show Keyboard Shortcuts',
    category: 'help',
    keywords: ['shortcuts', 'help', 'keys'],
  },
];

const CATEGORY_LABEL: Record<QuickSwitcherCommandCategory, string> = {
  navigation: 'Navigation',
  notes: 'Notes',
  view: 'View',
  preferences: 'Preferences',
  help: 'Help',
  system: 'System',
};

export function commandCategoryLabel(
  cat: QuickSwitcherCommandCategory,
): string {
  return CATEGORY_LABEL[cat];
}

/**
 * Fuzzy-match a query against a command. A command matches if every character
 * in the query appears (in order) in either the title or any keyword token.
 * Returns the indices of the matched characters within the title for
 * highlighting; if the match came purely from keywords, the title is shown
 * un-highlighted.
 */
export function matchCommand(
  query: string,
  command: QuickSwitcherCommand,
): { matches: boolean; titleIndices: number[] } {
  const trimmed = query.trim();
  if (!trimmed) return { matches: true, titleIndices: [] };

  const lowerQuery = trimmed.toLowerCase();
  const titleResult = fuzzyChars(lowerQuery, command.title.toLowerCase());
  if (titleResult.matches) {
    return { matches: true, titleIndices: titleResult.indices };
  }

  // Fall back to keyword haystack — title indices stay empty so we don't
  // pretend characters matched the visible title.
  const keywordHaystack = (command.keywords ?? []).join(' ').toLowerCase();
  if (keywordHaystack && fuzzyChars(lowerQuery, keywordHaystack).matches) {
    return { matches: true, titleIndices: [] };
  }

  return { matches: false, titleIndices: [] };
}

function fuzzyChars(
  query: string,
  haystack: string,
): { matches: boolean; indices: number[] } {
  const indices: number[] = [];
  let qi = 0;
  for (let i = 0; i < haystack.length && qi < query.length; i++) {
    if (haystack[i] === query[qi]) {
      indices.push(i);
      qi++;
    }
  }
  return { matches: qi === query.length, indices };
}

/**
 * Filter the command catalog by query. When the query is empty, every command
 * is returned in its canonical order (caller decides whether to render them
 * under a "Quick actions" header). When non-empty, matched commands are
 * returned in catalog order — they always appear AFTER any matching notes in
 * the final result list.
 */
export function filterCommands(
  query: string,
  commands: readonly QuickSwitcherCommand[] = QUICK_SWITCHER_COMMANDS,
): { command: QuickSwitcherCommand; titleIndices: number[] }[] {
  const out: { command: QuickSwitcherCommand; titleIndices: number[] }[] = [];
  for (const command of commands) {
    const { matches, titleIndices } = matchCommand(query, command);
    if (matches) out.push({ command, titleIndices });
  }
  return out;
}

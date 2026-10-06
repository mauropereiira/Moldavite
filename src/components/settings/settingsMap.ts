/**
 * Every tab, group and setting in Settings, with its visible label and its (i)
 * text. Rows read their label and info from here by id, so the search box and
 * the screen cannot drift apart; `settingsMap.test.tsx` renders each tab and
 * checks every id below is on screen inside its own group.
 */

import type { SettingsTab } from '@/stores';

type Only = 'desktop' | 'phone';

export interface SettingsItem {
  id: string;
  label: string;
  info?: string;
  /** Extra words people might search for. */
  keys?: string;
  only?: Only;
}

export interface SettingsGroup extends SettingsItem {
  /** Folded under a disclosure at the bottom of its tab. */
  fold?: true;
  rows: SettingsItem[];
}

export interface SettingsTabSpec {
  id: SettingsTab;
  label: string;
  blurb: string;
  info?: string;
  nav: 'Basics' | 'Connections' | 'Your data';
  only?: Only;
  groups: SettingsGroup[];
}

const MODE_INFO =
  'Overlay opens it over the note, Pinned keeps it as a column beside the note, Off hides it.';
const NEEDS_BACKLINKS = 'Needs Backlinks turned on in Writing.';
const WIDTH_INFO = 'Shown while it is pinned. You can also drag its edge.';

export const SETTINGS_TABS: SettingsTabSpec[] = [
  {
    id: 'general',
    label: 'General',
    blurb: 'Where your notes live and how they are saved.',
    nav: 'Basics',
    groups: [
      {
        id: 'forge',
        label: 'Forge',
        info: 'A Forge is a folder of plain .md files. You can sync it, back it up or open it in any other app.',
        rows: [
          {
            id: 'forges-folder',
            label: 'Forges folder',
            info: "Where Moldavite looks for your Forges. Changing it doesn't move any files. To move a Forge, quit Moldavite, move the folder yourself, then choose it here.",
            keys: 'location directory path change move',
            only: 'desktop',
          },
          {
            id: 'this-forge',
            label: 'This Forge',
            info: 'Rescan picks up notes added or changed outside Moldavite.',
            keys: 'finder explorer open rescan refresh reload path',
          },
          {
            id: 'synced-forge',
            label: 'Synced Forge (iCloud)',
            info: 'One Forge shared through iCloud Drive with your other Apple devices. Turn it on there too. Your local Forges stay separate.',
            keys: 'icloud sync apple',
          },
          {
            id: 'default-app',
            label: 'Default app for .md files',
            info: 'Open a double-clicked .md file in Moldavite.',
            keys: 'markdown double-click',
            only: 'desktop',
          },
        ],
      },
      {
        id: 'saving',
        label: 'Saving and auto-lock',
        fold: true,
        rows: [
          {
            id: 'autosave-delay',
            label: 'Auto-save delay',
            info: 'How long Moldavite waits after you stop typing before it saves.',
            keys: 'save speed milliseconds',
          },
          {
            id: 'save-status',
            label: 'Show save status',
            info: 'Shows "Saving..." in the editor footer while a note saves.',
            keys: 'indicator',
          },
          {
            id: 'auto-lock',
            label: 'Auto-lock',
            info: 'Locks your encrypted notes again after this long without activity.',
            keys: 'lock password security timeout encrypted',
          },
        ],
      },
      {
        id: 'danger',
        label: 'Danger zone',
        fold: true,
        rows: [
          {
            id: 'delete-all',
            label: 'Delete all notes',
            info: "Permanently deletes all your notes. This can't be undone.",
            keys: 'clear reset erase',
          },
        ],
      },
    ],
  },
  {
    id: 'appearance',
    label: 'Appearance',
    blurb: 'Theme, colour and type.',
    nav: 'Basics',
    groups: [
      {
        id: 'theme',
        label: 'Theme',
        rows: [
          {
            id: 'mode',
            label: 'Mode',
            info: "System follows your device's light or dark setting.",
            keys: 'light dark system theme',
          },
          {
            id: 'preset',
            label: 'Colour preset',
            info: 'Each palette has a light and a dark version.',
            keys: 'color palette theme cream sage slate clay plum graphite autumn',
          },
        ],
      },
      {
        id: 'text',
        label: 'Text and spacing',
        rows: [
          { id: 'font-size', label: 'Font size', keys: 'text bigger smaller' },
          { id: 'font', label: 'Font', keys: 'typeface family serif mono sans' },
          { id: 'line-height', label: 'Line height', keys: 'spacing leading' },
          {
            id: 'compact',
            label: 'Compact mode',
            info: 'Tighter spacing throughout the app.',
            keys: 'density',
          },
        ],
      },
      {
        id: 'home',
        label: 'Home screen',
        fold: true,
        rows: [
          { id: 'constellations', label: 'Constellations', keys: 'stars dots welcome sky' },
          {
            id: 'live-counts',
            label: 'Live counts',
            info: 'Your note and word counts on the home screen.',
            keys: 'stats welcome',
          },
          { id: 'welcome-date', label: 'Date', keys: 'welcome today' },
          {
            id: 'asteroid-cursor',
            label: 'Asteroid cursor',
            info: 'A small meteor that follows the pointer on the home screen.',
            keys: 'pointer mouse welcome',
            only: 'desktop',
          },
          {
            id: 'seasonal',
            label: 'Seasonal touches',
            info: "The season's decorations, like this autumn's leaves and pumpkin.",
            keys: 'autumn pumpkin leaves',
          },
        ],
      },
    ],
  },
  {
    id: 'layout',
    label: 'Layout',
    blurb: 'What stays on screen around your note.',
    nav: 'Basics',
    groups: [
      {
        id: 'navigation',
        label: 'Navigation',
        rows: [
          {
            id: 'icon-rail',
            label: 'Icon rail',
            info: "The column of icons along the window's edge.",
            keys: 'sidebar icons',
            only: 'desktop',
          },
          {
            id: 'rail-side',
            label: 'Rail side',
            info: 'The Index opens on the same side as the rail, the Agenda on the other.',
            keys: 'left right',
          },
          {
            id: 'index-mode',
            label: 'Index',
            info: MODE_INFO,
            keys: 'sidebar overlay pinned',
            only: 'desktop',
          },
          {
            id: 'agenda-mode',
            label: 'Agenda',
            info: MODE_INFO,
            keys: 'right panel calendar overlay pinned',
            only: 'desktop',
          },
          {
            id: 'focus-mode',
            label: 'Focus mode',
            info: 'Hides every panel and leaves just the note.',
            keys: 'distraction zen',
            only: 'desktop',
          },
        ],
      },
      {
        id: 'note',
        label: 'Around the note',
        rows: [
          {
            id: 'writing-width',
            label: 'Writing width',
            keys: 'column measure wide narrow',
            only: 'desktop',
          },
          { id: 'note-header', label: 'Note header', keys: 'title' },
          { id: 'tab-bar', label: 'Tab bar', keys: 'tabs' },
          {
            id: 'editor-footer',
            label: 'Editor footer',
            info: 'The bar under the note. Word count and save status show here.',
          },
          {
            id: 'backlinks-panel',
            label: 'Backlinks panel',
            info: `Notes that link here, listed under the note. ${NEEDS_BACKLINKS}`,
          },
        ],
      },
      {
        id: 'index',
        label: 'Index sections, sorting and widths',
        fold: true,
        rows: [
          { id: 'folders-section', label: 'Folders section', keys: 'sidebar' },
          {
            id: 'backlinks-section',
            label: 'Backlinks section',
            info: NEEDS_BACKLINKS,
            keys: 'sidebar',
          },
          {
            id: 'sort',
            label: 'Sort notes by',
            info: 'Manual lets you drag notes and folders into your own order. Daily notes always stay in date order.',
            keys: 'order name modified created manual',
          },
          {
            id: 'index-width',
            label: 'Index width',
            info: WIDTH_INFO,
            keys: 'sidebar size',
            only: 'desktop',
          },
          {
            id: 'agenda-width',
            label: 'Agenda width',
            info: WIDTH_INFO,
            keys: 'right panel size',
            only: 'desktop',
          },
        ],
      },
    ],
  },
  {
    id: 'writing',
    label: 'Writing',
    blurb: 'How the editor behaves as you type.',
    nav: 'Basics',
    groups: [
      {
        id: 'typing',
        label: 'Typing',
        rows: [
          {
            id: 'writing-toolbar',
            label: 'Writing toolbar',
            info: 'Styles and a + above the line you are writing.',
            keys: 'format formatting bar plus block insert',
            only: 'desktop',
          },
          { id: 'spell-check', label: 'Spell check', keys: 'spelling' },
          {
            id: 'auto-capitalize',
            label: 'Auto-capitalize',
            info: 'Capitalizes the first letter of each sentence.',
          },
          {
            id: 'word-count',
            label: 'Word count',
            info: 'Shown in the editor footer.',
            keys: 'words',
          },
        ],
      },
      {
        id: 'linking',
        label: 'Linking',
        rows: [
          {
            id: 'tags',
            label: 'Tags',
            info: 'Type #tag to tag a note. You can filter by tag in the Index.',
            keys: 'hashtags',
          },
          {
            id: 'backlinks',
            label: 'Backlinks',
            info: 'Shows which notes link to the one you are reading.',
            keys: 'links references',
          },
        ],
      },
      {
        id: 'templates',
        label: 'Templates',
        fold: true,
        rows: [
          {
            id: 'template-list',
            label: 'Templates',
            keys: 'daily template new default pinned',
          },
        ],
      },
    ],
  },
  {
    id: 'calendar',
    label: 'Calendar',
    blurb: 'Your calendars and the Agenda.',
    nav: 'Connections',
    groups: [
      {
        id: 'agenda',
        label: 'Agenda',
        rows: [
          {
            id: 'month-calendar',
            label: 'Month calendar',
            info: 'A month view for jumping to daily and weekly notes.',
            keys: 'widget daily weekly',
            only: 'desktop',
          },
          {
            id: 'timeline',
            label: 'Timeline',
            info: "Today's calendar events, hour by hour.",
            keys: 'hourly events schedule day widget',
          },
        ],
      },
      {
        id: 'accounts',
        label: 'Accounts',
        rows: [
          {
            id: 'apple-calendar',
            label: 'Apple Calendar',
            info: 'Events from the Calendar app, after you allow access.',
            keys: 'icloud permission access',
          },
          {
            id: 'google-calendar',
            label: 'Google Calendar',
            info: 'Read-only. Moldavite never creates or changes your events.',
            keys: 'account connect',
          },
        ],
      },
      {
        id: 'events',
        label: 'Events',
        rows: [
          {
            id: 'show-events',
            label: 'Show events',
            info: 'Hide calendar events without disconnecting.',
          },
          {
            id: 'all-day',
            label: 'All-day events',
            keys: 'all day',
          },
          {
            id: 'refresh',
            label: 'Refresh every',
            info: 'How often connected accounts are checked for changes.',
            keys: 'interval sync minutes',
          },
          {
            id: 'calendar-list',
            label: 'Calendars shown',
            info: 'All calendars show until you tick some.',
            keys: 'choose select filter',
          },
        ],
      },
    ],
  },
  {
    id: 'agents',
    label: 'AI & Agents',
    blurb: 'Let AI tools work with your notes.',
    info: 'Your notes are plain Markdown files, so an AI tool can already read them in your Forge folder. These options help it follow your conventions and connect safely.',
    nav: 'Connections',
    only: 'desktop',
    groups: [
      {
        id: 'agent-ready',
        label: 'Agent-ready Forge',
        info: 'Writes AGENTS.md, a short guide that tells AI tools how this Forge is organised: note names, frontmatter, links and tags. Also writes a .gitignore for the folders Moldavite manages.',
        rows: [{ id: 'agents-md', label: 'AGENTS.md', keys: 'agent ready ai claude codex' }],
      },
      {
        id: 'mcp',
        label: 'MCP server',
        info: 'Lets AI apps that support MCP search, read and follow links in your notes through Moldavite. Your AI app starts it on this Mac. Nothing listens on the network.',
        rows: [
          {
            id: 'mcp-client',
            label: 'Set up',
            info: 'Pick your AI app, then copy its setup.',
            keys: 'claude code desktop cursor snippet config',
          },
          {
            id: 'mcp-writes',
            label: 'Allow agents to write notes',
            info: 'Adds tools to create notes, replace notes and add to daily notes. Reading is always on. Locked notes stay out of reach.',
            keys: 'write access permission',
          },
          {
            id: 'mcp-path',
            label: 'App path',
            info: 'The Moldavite program your AI app runs. The setup above already includes it.',
            keys: 'binary install location',
          },
        ],
      },
      {
        id: 'search',
        label: 'Search',
        rows: [
          {
            id: 'semantic',
            label: 'Semantic search',
            info: 'Search by meaning, and see related notes under each note. A small model runs on your Mac, so your notes never leave it.',
            keys: 'meaning related embeddings ai',
          },
          { id: 'semantic-model', label: 'Model', keys: 'semantic embeddings minilm bge e5' },
          {
            id: 'search-index',
            label: 'Search index',
            info: "A keyword index of your notes, so search doesn't rescan your Forge every time.",
            keys: 'keyword rebuild fts',
          },
        ],
      },
    ],
  },
  {
    id: 'plugins',
    label: 'Plugins',
    blurb: 'Add features made by the community.',
    info: 'Plugins live in your Forge under .plugins/. They stay off until you turn them on and approve what they ask for, and they can read your notes only if you allow it. Only turn on plugins you trust.',
    nav: 'Connections',
    only: 'desktop',
    groups: [
      {
        id: 'installed',
        label: 'Installed',
        rows: [{ id: 'plugin-list', label: 'Installed plugins', keys: 'enable disable' }],
      },
      {
        id: 'add-plugins',
        label: 'Add plugins',
        info: 'A plugin is a folder, or a .zip of one, holding manifest.json and plugin.js. Browsing the community list contacts GitHub only when you click it.',
        rows: [
          {
            id: 'plugin-install',
            label: 'Install',
            keys: 'community browse zip folder wordpress example build',
          },
        ],
      },
      {
        id: 'clipper',
        label: 'Browser clipper',
        rows: [
          {
            id: 'clipper-card',
            label: 'Browser extension',
            info: "Save the page you are reading as a Markdown note. Links survive, images and styling don't.",
            keys: 'clipper chrome firefox edge web clip',
          },
        ],
      },
    ],
  },
  {
    id: 'data',
    label: 'Data',
    blurb: 'Export, back up, restore and import.',
    nav: 'Your data',
    groups: [
      {
        id: 'backups',
        label: 'Backups',
        rows: [
          {
            id: 'notes-zip',
            label: 'Notes (.zip)',
            info: 'Every note and template in one .zip. Importing lets you merge or replace.',
            keys: 'export import backup restore archive',
          },
          {
            id: 'encrypted-backup',
            label: 'Encrypted backup',
            info: "A password-protected copy of your notes (AES-256). Without the password it can't be opened.",
            keys: 'export import backup restore password',
          },
          {
            id: 'settings-file',
            label: 'Settings file',
            info: "Your preferences, theme and folders as JSON, to carry them to another device. Notes aren't included.",
            keys: 'export import json preferences',
          },
        ],
      },
      {
        id: 'import',
        label: 'Import from Obsidian',
        fold: true,
        only: 'desktop',
        rows: [
          {
            id: 'obsidian',
            label: 'Obsidian vault',
            info: 'Copies notes, daily notes, wiki-links and attachments into a new Forge. Hidden items, Canvas files, trash and symlinks are skipped.',
            keys: 'migrate copy vault',
          },
        ],
      },
    ],
  },
  {
    id: 'about',
    label: 'About',
    blurb: 'Version, updates and help.',
    nav: 'Your data',
    groups: [
      {
        id: 'app',
        label: 'Moldavite',
        rows: [{ id: 'version', label: 'Version', keys: "what's new release notes" }],
      },
      {
        id: 'updates',
        label: 'Updates',
        only: 'desktop',
        rows: [
          {
            id: 'update-check',
            label: 'Software update',
            keys: 'install new version',
          },
          {
            id: 'auto-update',
            label: 'Check for updates automatically',
            info: 'On launch, every 24 hours, and when you come back to Moldavite.',
          },
        ],
      },
      {
        id: 'help',
        label: 'Help',
        rows: [
          { id: 'onboarding', label: 'Onboarding', keys: 'tour welcome replay' },
          { id: 'shortcuts', label: 'Keyboard shortcuts', keys: 'keys', only: 'desktop' },
          { id: 'links', label: 'Privacy and support', keys: 'policy help', only: 'phone' },
        ],
      },
    ],
  },
];

export interface SettingsEntry {
  item: SettingsItem;
  tab: SettingsTabSpec;
  /** The group a row sits in, or the group itself. */
  group: SettingsGroup;
}

const ENTRIES = new Map<string, SettingsEntry>();
for (const tab of SETTINGS_TABS) {
  for (const group of tab.groups) {
    ENTRIES.set(group.id, { item: group, tab, group });
    for (const item of group.rows) ENTRIES.set(item.id, { item, tab, group });
  }
}

export const settingsEntry = (id: string) => ENTRIES.get(id) as SettingsEntry;

export const settingsTab = (id: SettingsTab) =>
  SETTINGS_TABS.find((tab) => tab.id === id) as SettingsTabSpec;

const shows = (only: Only | undefined, mobile: boolean) =>
  !only || only === (mobile ? 'phone' : 'desktop');

export const visibleTabs = (mobile: boolean) => SETTINGS_TABS.filter((t) => shows(t.only, mobile));

/**
 * Rows and groups whose words contain every word typed, best matches first: a
 * label starting with the query, then a label containing it, then the rest.
 */
export function searchSettings(query: string, mobile: boolean): SettingsEntry[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];
  const hits: [number, SettingsEntry][] = [];
  for (const entry of ENTRIES.values()) {
    const { item, tab, group } = entry;
    if (![tab.only, group.only, item.only].every((only) => shows(only, mobile))) continue;
    if (item !== group && item.label === group.label) continue;
    const label = item.label.toLowerCase();
    const text = [label, item.keys, item.info, group.label, tab.label].join(' ').toLowerCase();
    if (!words.every((word) => text.includes(word))) continue;
    const q = words.join(' ');
    hits.push([label.startsWith(q) ? 0 : label.includes(q) ? 1 : 2, entry]);
  }
  return hits.sort((a, b) => a[0] - b[0]).map(([, entry]) => entry);
}

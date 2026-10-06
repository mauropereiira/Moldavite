import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import {
  useCalendarStore,
  useForgeStore,
  useSemanticStore,
  useSettingsStore,
  type SettingsState,
  type SettingsTab,
} from '@/stores';
import { SETTINGS_TABS, searchSettings, settingsEntry, visibleTabs } from './settingsMap';
import { SettingsModal } from './SettingsModal';

const platform = vi.hoisted(() => ({ mobile: false }));
vi.mock('@/lib/platform', () => ({ isMobilePlatform: () => platform.mobile }));
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: vi.fn(), save: vi.fn() }));
vi.mock('@tauri-apps/plugin-shell', () => ({ open: vi.fn() }));
vi.mock('@tauri-apps/api/app', () => ({ getVersion: vi.fn(async () => '2.10.1') }));
vi.mock('@/lib/plugins/host', () => ({
  listPlugins: vi.fn(async () => []),
  reconcilePlugins: vi.fn(async () => []),
  setPluginsPaused: vi.fn(),
}));

const BACKEND: Record<string, unknown> = {
  default_markdown_app_status: { mode: 'set', isDefault: false },
  get_forges_root_path: '/forges',
  get_notes_directory: '/forges/Default',
  search_index_status: { ready: true, building: false, noteCount: 3, lastReconcileMs: null },
  get_app_binary_path: '/Applications/Moldavite.app/Contents/MacOS/moldavite',
  get_mcp_writes_enabled: false,
  list_templates: [],
  browser_bridge_status: [],
};

/** Every conditional row on screen: a synced Forge, both calendars connected, pinned columns. */
function everythingAvailable() {
  vi.mocked(invoke).mockImplementation(async (cmd: string) => BACKEND[cmd]);
  useForgeStore.setState({
    forges: [
      { id: 'Default', name: 'Default', path: '/forges/Default', isActive: true },
      { id: 'icloud', name: 'Synced', path: '/icloud', isActive: false, isSynced: true },
    ],
    loadForges: vi.fn(async () => {}),
  } as never);
  useCalendarStore.setState({
    isAuthorized: true,
    sources: [
      {
        source: 'apple',
        available: true,
        connected: true,
        account: null,
        permission: null,
        error: null,
      },
      {
        source: 'google',
        available: true,
        connected: true,
        account: 'me@example.com',
        permission: null,
        error: null,
      },
    ],
    calendars: [{ id: 'a', title: 'Home', color: '', source: 'apple' }],
    checkPermission: vi.fn(async () => {}),
  } as never);
  useSemanticStore.setState({
    state: 'disabled',
    models: [
      {
        id: 'm',
        label: 'MiniLM',
        downloadSizeMb: 90,
        dims: 384,
        description: 'Fast',
        active: true,
      },
    ],
    refreshStatus: vi.fn(async () => {}),
  } as never);
}

async function renderTab(tab: SettingsTab, settings: Partial<SettingsState> = {}) {
  useSettingsStore.setState({ isSettingsOpen: true, ...settings });
  if (platform.mobile) useSettingsStore.getState().setSettingsSection(tab);
  else useSettingsStore.getState().setActiveSettingsTab(tab);
  const view = render(<SettingsModal />);
  await act(async () => {});
  for (const fold of document.querySelectorAll<HTMLElement>('.settings-fold-toggle')) {
    if (fold.getAttribute('aria-expanded') === 'false') fireEvent.click(fold);
  }
  await act(async () => {});
  return view;
}

const PINNED: Partial<SettingsState> = { indexMode: 'pinned', agendaMode: 'pinned' };

describe('settingsMap', () => {
  it('gives every tab, group and setting its own id', () => {
    const ids = SETTINGS_TABS.flatMap((tab) =>
      tab.groups.flatMap((group) => [group.id, ...group.rows.map((row) => row.id)])
    );
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.every((id) => settingsEntry(id))).toBe(true);
  });

  it('keeps em dashes out of every label and (i) text', () => {
    const text = JSON.stringify(SETTINGS_TABS);
    expect(text).not.toContain(String.fromCharCode(0x2014));
  });

  it('finds a setting by its label, its (i) text or a word people use for it', () => {
    expect(searchSettings('spell', false)[0].item.id).toBe('spell-check');
    expect(searchSettings('icloud', false).map((hit) => hit.item.id)).toContain('synced-forge');
    expect(searchSettings('hashtags', false)[0].item.id).toBe('tags');
    expect(searchSettings('obsidian', false)[0].group.id).toBe('import');
    expect(searchSettings('xyzzy', false)).toEqual([]);
  });

  it('leaves out what a phone cannot do when searching there', () => {
    expect(searchSettings('obsidian', true)).toEqual([]);
    expect(searchSettings('mcp', true)).toEqual([]);
    expect(searchSettings('focus mode', true)).toEqual([]);
    expect(searchSettings('month calendar', true)).toEqual([]);
    expect(searchSettings('apple calendar', true)[0].item.id).toBe('apple-calendar');
  });

  it('no longer lists the removed Timeline switch', () => {
    expect(settingsEntry('timeline')).toBeUndefined();
    for (const mobile of [false, true]) expect(searchSettings('timeline', mobile)).toEqual([]);
  });
});

describe.each([false, true])(
  'every setting is on screen in its own group (phone: %s)',
  (mobile) => {
    beforeEach(() => {
      platform.mobile = mobile;
      localStorage.clear();
      useSettingsStore.getState().resetToDefaults();
      everythingAvailable();
    });

    it.each(SETTINGS_TABS.map((tab) => [tab.id, tab] as const))('%s', async (id, tab) => {
      if (!visibleTabs(mobile).includes(tab)) return;
      const view = await renderTab(id, PINNED);
      const missing: string[] = [];
      for (const group of tab.groups) {
        if (group.only && group.only !== (mobile ? 'phone' : 'desktop')) continue;
        const groupEl = view.container.querySelector(`[data-setting="${group.id}"]`);
        if (!groupEl) {
          missing.push(group.id);
          continue;
        }
        for (const row of group.rows) {
          if (row.only && row.only !== (mobile ? 'phone' : 'desktop')) continue;
          const rowEl = groupEl.querySelector(`[data-setting="${row.id}"]`);
          if (!rowEl) missing.push(row.id);
          else {
            const label = rowEl.querySelector('.settings-row-label > span');
            if (label) expect(label.textContent).toBe(row.label);
          }
        }
      }
      expect(missing).toEqual([]);
    });
  }
);

/**
 * One control per stored setting, and that control still writes the same key.
 * A store setter or persisted key added without a control fails here.
 */
type Interaction =
  | { switch: string }
  | { radio: string; group: string }
  | { slider: string; value: number }
  | { select: string; value: string }
  | { button: string };

const CONTROLS: Record<string, [SettingsTab, Interaction, unknown, Partial<SettingsState>?]> = {
  autoSaveDelay: ['general', { slider: 'Auto-save delay', value: 500 }, 500],
  showAutoSaveStatus: ['general', { switch: 'Show save status' }, false],
  autoLockTimeout: ['general', { group: 'Auto-lock', radio: '1 hour' }, 60],
  fontSize: ['appearance', { group: 'Font Size', radio: 'XL' }, 'extra-large'],
  fontFamily: ['appearance', { select: 'Font', value: 'inter' }, 'inter'],
  lineHeight: ['appearance', { group: 'Line height', radio: 'Compact' }, 'compact'],
  compactMode: ['appearance', { switch: 'Compact mode' }, true],
  showWelcomeDots: ['appearance', { switch: 'Constellations' }, false],
  showWelcomeStats: ['appearance', { switch: 'Live counts' }, false],
  showWelcomeDate: ['appearance', { switch: 'Date' }, false],
  showAsteroidCursor: ['appearance', { switch: 'Asteroid cursor' }, false],
  showSeasonalTouches: ['appearance', { switch: 'Seasonal touches' }, false],
  showIconRail: ['layout', { switch: 'Icon rail' }, false],
  iconRailSide: ['layout', { group: 'Rail side', radio: 'Right' }, 'right'],
  indexMode: ['layout', { group: 'Index', radio: 'Pinned' }, 'pinned'],
  agendaMode: ['layout', { group: 'Agenda', radio: 'Off' }, 'off'],
  focusModeEnabled: ['layout', { switch: 'Focus mode' }, true],
  editorWidth: ['layout', { group: 'Writing width', radio: 'Narrow' }, 'narrow'],
  showNoteHeader: ['layout', { switch: 'Note header' }, false],
  showTabBar: ['layout', { switch: 'Tab bar' }, false],
  showEditorFooter: ['layout', { switch: 'Editor footer' }, false],
  showBacklinksPanel: ['layout', { switch: 'Backlinks panel' }, false],
  showFoldersSection: ['layout', { switch: 'Folders section' }, false],
  showBacklinksSection: ['layout', { switch: 'Backlinks section' }, false],
  sortOption: ['layout', { group: 'Sort notes by', radio: 'Manual' }, 'manual'],
  sidebarWidth: ['layout', { slider: 'Index width', value: 300 }, 300, PINNED],
  rightPanelWidth: ['layout', { slider: 'Agenda width', value: 400 }, 400, PINNED],
  showWritingToolbar: ['writing', { switch: 'Writing toolbar' }, false],
  spellCheck: ['writing', { switch: 'Spell check' }, false],
  autoCapitalize: ['writing', { switch: 'Auto-capitalize' }, false],
  showWordCount: ['writing', { switch: 'Word count' }, true],
  tagsEnabled: ['writing', { switch: 'Tags' }, false],
  backlinksEnabled: ['writing', { switch: 'Backlinks' }, false],
  showCalendarWidget: ['calendar', { switch: 'Month calendar' }, false],
  hasSeenAppOnboarding: [
    'about',
    { button: 'Show onboarding again' },
    false,
    { hasSeenAppOnboarding: true },
  ],
};

/** Stored, but not a choice anyone makes in Settings. */
const NOT_SETTINGS: Record<string, string> = {
  notesDirectory: 'nothing reads it; the Forges folder lives in the backend config',
  lastSeenOnboardingVersion: 'onboarding bookkeeping',
  isSettingsOpen: 'Settings UI state',
  activeSettingsTab: 'Settings UI state',
  settingsSection: 'Settings UI state',
  settingsAnchor: 'Settings UI state',
};

describe('every stored setting has a control that writes it', () => {
  beforeEach(() => {
    platform.mobile = false;
    localStorage.clear();
    useSettingsStore.getState().resetToDefaults();
    everythingAvailable();
  });

  it('covers every setter and every persisted key', () => {
    const state = useSettingsStore.getState() as unknown as Record<string, unknown>;
    const setterKeys = Object.keys(state)
      .filter((key) => /^set[A-Z]/.test(key) && typeof state[key] === 'function')
      .map((key) => key[3].toLowerCase() + key.slice(4));
    const persisted = Object.keys(
      useSettingsStore.persist.getOptions().partialize?.(useSettingsStore.getState()) ?? {}
    );
    const uncovered = [...new Set([...setterKeys, ...persisted])].filter(
      (key) => !(key in CONTROLS) && !(key in NOT_SETTINGS)
    );
    expect(uncovered).toEqual([]);
    for (const key of setterKeys) expect(key in state).toBe(true);
  });

  it.each(Object.entries(CONTROLS))('%s', async (key, [tab, how, expected, preset]) => {
    await renderTab(tab, preset);
    if ('switch' in how) fireEvent.click(screen.getByRole('switch', { name: how.switch }));
    if ('radio' in how) {
      const group = screen.getByRole('radiogroup', { name: how.group });
      fireEvent.click(within(group).getByRole('radio', { name: how.radio }));
    }
    if ('slider' in how) {
      fireEvent.change(screen.getByRole('slider', { name: how.slider }), {
        target: { value: String(how.value) },
      });
    }
    if ('select' in how) {
      fireEvent.change(screen.getByRole('combobox', { name: how.select }), {
        target: { value: how.value },
      });
    }
    if ('button' in how) fireEvent.click(screen.getByRole('button', { name: how.button }));
    expect((useSettingsStore.getState() as unknown as Record<string, unknown>)[key]).toBe(expected);
  });
});

describe('jumping to a folded setting', () => {
  beforeEach(() => {
    platform.mobile = false;
    localStorage.clear();
    useSettingsStore.getState().resetToDefaults();
    everythingAvailable();
  });

  it('opens the fold, marks the row and focuses its control', async () => {
    useSettingsStore.setState({ isSettingsOpen: true, activeSettingsTab: 'general' });
    render(<SettingsModal />);
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search settings' }), {
      target: { value: 'seasonal' },
    });
    fireEvent.click(screen.getByRole('button', { name: /^Seasonal touches/ }));
    await act(async () => {
      await new Promise((resolve) => requestAnimationFrame(resolve));
    });

    expect(screen.getByRole('button', { name: 'Home screen' })).toHaveAttribute(
      'aria-expanded',
      'true'
    );
    const control = screen.getByRole('switch', { name: 'Seasonal touches' });
    expect(control.closest('.settings-row')).toHaveClass('settings-flash');
    expect(document.activeElement).toBe(control);
    expect(useSettingsStore.getState().settingsAnchor).toBeNull();
  });

  it('opens Templates in Writing for the old Templates tab id', async () => {
    useSettingsStore.setState({ isSettingsOpen: true });
    useSettingsStore.getState().setActiveSettingsTab('templates');
    render(<SettingsModal />);
    await act(async () => {});

    expect(screen.getByRole('heading', { level: 1, name: 'Writing' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Templates' })).toHaveAttribute(
      'aria-expanded',
      'true'
    );
  });
});

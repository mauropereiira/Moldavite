import { beforeEach, describe, expect, it } from 'vitest';
import { migrateSettingsState, resolveSettingsTarget, useSettingsStore } from './settingsStore';

describe('migrateSettingsState', () => {
  beforeEach(() => {
    localStorage.clear();
    useSettingsStore.getState().resetToDefaults();
  });

  it('drops the obsolete pin booleans without mutating the caller payload', () => {
    const legacy = {
      showSidebar: true,
      showRightPanel: false,
      fontSize: 'large',
    };

    expect(migrateSettingsState(legacy, 0)).toEqual({
      indexMode: 'overlay',
      agendaMode: 'overlay',
      fontSize: 'large',
    });
    expect(legacy).toHaveProperty('showSidebar', true);
  });

  // `merge` re-runs the migration on every hydration, including on payloads it
  // has already migrated — so a 2.0 user's own width must survive the rerun.
  it('keeps a 2.0 editorWidth choice, and keeps it across repeated migrations', () => {
    const chosen = { indexMode: 'overlay', agendaMode: 'overlay', editorWidth: 'medium' };

    expect(migrateSettingsState(chosen, 1)).toHaveProperty('editorWidth', 'medium');
    expect(migrateSettingsState(migrateSettingsState(chosen, 1), 1)).toEqual(chosen);
  });

  // The payload a real 1.9.0 install leaves behind: `showSidebar` was never in
  // that version's allow-list, while `showRightPanel` was and defaulted true.
  // Read literally, that migrates the two halves of the frame in opposite
  // directions — Index summoned, Agenda parked — which is the one first
  // impression 2.0 must not give.
  it('lands both halves of the frame in overlay for a real 1.9.0 upgrade', () => {
    const shipped = {
      showRightPanel: true,
      editorWidth: 'medium',
      fontSize: 'large',
    };

    expect(migrateSettingsState(shipped, 0)).toEqual({
      indexMode: 'overlay',
      agendaMode: 'overlay',
      fontSize: 'large',
    });
  });

  // 1.9.0 shipped `editorWidth: 'medium'` as a dead setting nothing read. It is
  // live in 2.0, so a value nobody ever chose would otherwise outrank the new
  // default and hand upgraders a narrower column than a fresh install.
  it('drops the stale editorWidth so upgraders inherit the new default', () => {
    expect(migrateSettingsState({ editorWidth: 'medium' }, 0)).not.toHaveProperty('editorWidth');
    expect(useSettingsStore.getState().editorWidth).toBe('wide');
  });

  // Someone who turned the panel off in 1.9.0 chose "not in my way", not
  // "remove the feature" — overlay honours that; 'off' would overreach.
  it('treats an explicitly hidden 1.9.0 panel as overlay, not off', () => {
    expect(migrateSettingsState({ showRightPanel: false }, 0).agendaMode).toBe('overlay');
  });

  it('preserves valid modes while removing obsolete pin fields', () => {
    expect(
      migrateSettingsState(
        {
          indexMode: 'off',
          agendaMode: 'pinned',
          showSidebar: true,
          showRightPanel: false,
        },
        1
      )
    ).toEqual({ indexMode: 'off', agendaMode: 'pinned' });
  });

  it('persists the quiet home screen through the settings allow-list', () => {
    useSettingsStore.getState().setQuietHomeScreen(true);

    const persisted = JSON.parse(localStorage.getItem('moldavite-settings') ?? '{}') as {
      state?: Record<string, unknown>;
    };
    expect(persisted.state).toHaveProperty('quietHomeScreen', true);
  });

  it('persists the rail side through the settings allow-list', () => {
    expect(useSettingsStore.getState().iconRailSide).toBe('left');
    useSettingsStore.getState().setIconRailSide('right');

    const persisted = JSON.parse(localStorage.getItem('moldavite-settings') ?? '{}') as {
      state?: Record<string, unknown>;
    };
    expect(persisted.state).toHaveProperty('iconRailSide', 'right');
  });

  it('keeps a valid rail side and puts an unknown one back on the left', () => {
    expect(migrateSettingsState({ iconRailSide: 'right' }, 1)).toHaveProperty(
      'iconRailSide',
      'right'
    );
    expect(migrateSettingsState({ iconRailSide: 'top' }, 1)).toHaveProperty('iconRailSide', 'left');
    expect(migrateSettingsState({ iconRailSide: null }, 1)).toHaveProperty('iconRailSide', 'left');
  });

  it('hydrates an unknown rail side as the left edge', async () => {
    localStorage.setItem(
      'moldavite-settings',
      JSON.stringify({ state: { iconRailSide: 'upside-down' }, version: 1 })
    );
    await useSettingsStore.persist.rehydrate();
    expect(useSettingsStore.getState().iconRailSide).toBe('left');
  });

  it('drops the removed Timeline widget switch from a saved payload, whatever it held', async () => {
    expect(migrateSettingsState({ showTimelineWidget: false, fontSize: 'large' }, 1)).toEqual({
      indexMode: 'overlay',
      agendaMode: 'overlay',
      fontSize: 'large',
    });

    localStorage.setItem(
      'moldavite-settings',
      JSON.stringify({
        state: { showTimelineWidget: false, showCalendarWidget: false },
        version: 1,
      })
    );
    await useSettingsStore.persist.rehydrate();
    expect(useSettingsStore.getState()).not.toHaveProperty('showTimelineWidget');
    expect(useSettingsStore.getState().showCalendarWidget).toBe(false);

    useSettingsStore.getState().setFontSize('small');
    const saved = JSON.parse(localStorage.getItem('moldavite-settings') ?? '{}');
    expect(saved.state).not.toHaveProperty('showTimelineWidget');
  });
});

/** What a 2.10 install left in localStorage, before version 2 removed settings. */
function storedV1(state: Record<string, unknown>) {
  localStorage.setItem(
    'moldavite-settings',
    JSON.stringify({
      state: {
        notesDirectory: '~/Documents/Moldavite/',
        autoSaveDelay: 300,
        showAutoSaveStatus: true,
        backlinksEnabled: true,
        showBacklinksPanel: true,
        showBacklinksSection: true,
        showWelcomeDots: true,
        showWelcomeStats: true,
        showWelcomeDate: true,
        showAsteroidCursor: true,
        showSeasonalTouches: true,
        indexMode: 'overlay',
        agendaMode: 'overlay',
        ...state,
      },
      version: 1,
    })
  );
}

const persistedState = () =>
  (JSON.parse(localStorage.getItem('moldavite-settings') ?? '{}') as { state: object }).state;

describe('version 2 removals', () => {
  beforeEach(() => {
    localStorage.clear();
    useSettingsStore.getState().resetToDefaults();
  });

  it('turns both backlinks places off for someone who had Backlinks off', async () => {
    storedV1({ backlinksEnabled: false });
    await useSettingsStore.persist.rehydrate();

    expect(useSettingsStore.getState()).toMatchObject({
      showBacklinksPanel: false,
      showBacklinksSection: false,
    });
    expect(persistedState()).not.toHaveProperty('backlinksEnabled');
  });

  it('leaves the backlinks places as they were when Backlinks was on', async () => {
    storedV1({ showBacklinksPanel: false });
    await useSettingsStore.persist.rehydrate();

    expect(useSettingsStore.getState()).toMatchObject({
      showBacklinksPanel: false,
      showBacklinksSection: true,
    });
  });

  it.each(['showWelcomeDots', 'showWelcomeStats', 'showWelcomeDate'])(
    'gives a quiet home screen to someone who turned %s off',
    async (key) => {
      storedV1({ [key]: false });
      await useSettingsStore.persist.rehydrate();

      expect(useSettingsStore.getState().quietHomeScreen).toBe(true);
      expect(useSettingsStore.getState().showSeasonalTouches).toBe(true);
      expect(persistedState()).not.toHaveProperty(key);
    }
  );

  it('drops the removed asteroid cursor without quieting the home screen', async () => {
    storedV1({ showAsteroidCursor: false });
    await useSettingsStore.persist.rehydrate();

    expect(useSettingsStore.getState().quietHomeScreen).toBe(false);
    expect(persistedState()).not.toHaveProperty('showAsteroidCursor');
  });

  it('keeps the full home screen when every decoration was on', async () => {
    storedV1({ showSeasonalTouches: false });
    await useSettingsStore.persist.rehydrate();

    expect(useSettingsStore.getState().quietHomeScreen).toBe(false);
    expect(useSettingsStore.getState().showSeasonalTouches).toBe(false);
  });

  it('drops the auto-save and Forge folder keys, keeping everything else', async () => {
    storedV1({ autoSaveDelay: 1500, showAutoSaveStatus: false, fontSize: 'large' });
    await useSettingsStore.persist.rehydrate();

    const state = persistedState();
    for (const key of ['autoSaveDelay', 'showAutoSaveStatus', 'notesDirectory']) {
      expect(state).not.toHaveProperty(key);
      expect(useSettingsStore.getState()).not.toHaveProperty(key);
    }
    expect(useSettingsStore.getState().fontSize).toBe('large');
  });

  // An exported settings file is written back to localStorage as-is and the app
  // reloads, so an old file takes this same path, with or without a version.
  it('imports an old settings file without a version the same way', async () => {
    localStorage.setItem(
      'moldavite-settings',
      JSON.stringify({ state: { notesDirectory: '/old', backlinksEnabled: false } })
    );
    await useSettingsStore.persist.rehydrate();

    expect(useSettingsStore.getState()).not.toHaveProperty('notesDirectory');
    expect(useSettingsStore.getState().showBacklinksPanel).toBe(false);
  });

  it('is a no-op on a payload it already migrated', () => {
    const once = migrateSettingsState({ backlinksEnabled: false, showWelcomeDate: false }, 1);
    expect(migrateSettingsState(once, 2)).toEqual(once);
    expect(once).toMatchObject({
      quietHomeScreen: true,
      showBacklinksPanel: false,
      showBacklinksSection: false,
    });
  });
});

describe('resolveSettingsTarget', () => {
  it('sends the Danger zone and Import to Data from their old places', () => {
    expect(resolveSettingsTarget('general#danger')).toEqual({ tab: 'data', anchor: 'danger' });
    expect(resolveSettingsTarget('general#delete-all')).toEqual({
      tab: 'data',
      anchor: 'delete-all',
    });
    expect(resolveSettingsTarget('import')).toEqual({ tab: 'data', anchor: 'import' });
  });
});

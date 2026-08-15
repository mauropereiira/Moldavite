import { beforeEach, describe, expect, it } from 'vitest';
import { migrateSettingsState, useSettingsStore } from './settingsStore';

describe('migrateSettingsState', () => {
  beforeEach(() => {
    localStorage.clear();
    useSettingsStore.getState().resetToDefaults();
  });

  it('converts legacy pin booleans into chrome modes', () => {
    const legacy = {
      showSidebar: true,
      showRightPanel: false,
      fontSize: 'large',
    };

    expect(migrateSettingsState(legacy, 0)).toEqual({
      indexMode: 'pinned',
      agendaMode: 'overlay',
      fontSize: 'large',
    });
    expect(legacy).toHaveProperty('showSidebar', true);
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

  it('persists the asteroid cursor preference through the settings allow-list', () => {
    useSettingsStore.setState({ showAsteroidCursor: false });

    const persisted = JSON.parse(localStorage.getItem('moldavite-settings') ?? '{}') as {
      state?: Record<string, unknown>;
    };
    expect(persisted.state).toHaveProperty('showAsteroidCursor', false);
  });
});

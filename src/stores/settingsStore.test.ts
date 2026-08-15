import { beforeEach, describe, expect, it } from 'vitest';
import { migrateSettingsState, useSettingsStore } from './settingsStore';

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

  it('persists the asteroid cursor preference through the settings allow-list', () => {
    useSettingsStore.setState({ showAsteroidCursor: false });

    const persisted = JSON.parse(localStorage.getItem('moldavite-settings') ?? '{}') as {
      state?: Record<string, unknown>;
    };
    expect(persisted.state).toHaveProperty('showAsteroidCursor', false);
  });
});

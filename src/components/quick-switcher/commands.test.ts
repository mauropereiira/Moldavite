import { describe, it, expect } from 'vitest';
import {
  filterCommands,
  matchCommand,
  QUICK_SWITCHER_COMMANDS,
} from './commands';

describe('QuickSwitcher command filter', () => {
  it('returns the full catalog when the query is empty', () => {
    const results = filterCommands('');
    expect(results).toHaveLength(QUICK_SWITCHER_COMMANDS.length);
    expect(results[0].command.id).toBe(QUICK_SWITCHER_COMMANDS[0].id);
  });

  it('filters by fuzzy match on the title and reports highlight indices', () => {
    const results = filterCommands('settings');
    const ids = results.map((r) => r.command.id);
    expect(ids).toContain('open-settings');
    const settings = results.find((r) => r.command.id === 'open-settings')!;
    // "settings" appears verbatim in "Open Settings", so we expect indices for
    // each matched character.
    expect(settings.titleIndices.length).toBe('settings'.length);
  });

  it('matches via keywords without highlighting the title', () => {
    // "dark" is a keyword for Toggle Theme but does not appear in the title.
    const result = matchCommand('dark', {
      id: 'toggle-theme',
      title: 'Toggle Theme',
      category: 'preferences',
      keywords: ['theme', 'light', 'dark', 'appearance'],
    });
    expect(result.matches).toBe(true);
    expect(result.titleIndices).toEqual([]);
  });

  it('rejects queries that do not appear in title or keywords', () => {
    const results = filterCommands('zzzqqqxxx');
    expect(results).toEqual([]);
  });

  it('preserves catalog order in filtered results', () => {
    // Both "Open Today's Note" and "Open Settings" match a fuzzy "open".
    const results = filterCommands('open');
    const matchedOpenItems = results
      .map((r) => r.command.id)
      .filter((id) => id.startsWith('open-'));
    // Catalog order has 'open-today' before 'open-settings'.
    const todayIdx = matchedOpenItems.indexOf('open-today');
    const settingsIdx = matchedOpenItems.indexOf('open-settings');
    expect(todayIdx).toBeGreaterThanOrEqual(0);
    expect(settingsIdx).toBeGreaterThanOrEqual(0);
    expect(todayIdx).toBeLessThan(settingsIdx);
  });
});

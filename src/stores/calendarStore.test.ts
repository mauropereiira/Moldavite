import { describe, expect, it } from 'vitest';
import { hasNoConnectableCalendarSource, migrateCalendarState } from './calendarStore';

describe('calendar persisted-state migration', () => {
  it('namespaces a v0 single calendar selection as an Apple id', () => {
    const migrated = migrateCalendarState(
      {
        selectedCalendarId: 'ABC-123',
        calendarEnabled: true,
        showAllDayEvents: false,
        hasSeenOnboarding: true,
      },
      0
    );

    expect(migrated.selectedCalendarIds).toEqual(['apple:ABC-123']);
    expect(migrated.selectedCalendarId).toBeUndefined();
    // Unrelated preferences must survive untouched.
    expect(migrated.calendarEnabled).toBe(true);
    expect(migrated.showAllDayEvents).toBe(false);
    expect(migrated.hasSeenOnboarding).toBe(true);
  });

  it('treats a v0 null selection as "all calendars"', () => {
    expect(migrateCalendarState({ selectedCalendarId: null }, 0).selectedCalendarIds).toEqual([]);
    expect(migrateCalendarState({}, 0).selectedCalendarIds).toEqual([]);
    expect(migrateCalendarState({ selectedCalendarId: '' }, 0).selectedCalendarIds).toEqual([]);
  });

  it('leaves an already-migrated blob alone', () => {
    const current = { selectedCalendarIds: ['google:me@example.com', 'apple:X'] };
    expect(migrateCalendarState(current, 1)).toEqual(current);
  });
});

describe('calendar source availability', () => {
  it('requires a non-empty report where every source is unavailable', () => {
    expect(hasNoConnectableCalendarSource([])).toBe(false);
    expect(
      hasNoConnectableCalendarSource([
        {
          source: 'apple',
          available: false,
          connected: false,
          account: null,
          permission: null,
          error: 'Apple Calendar is only available on macOS.',
        },
        {
          source: 'google',
          available: false,
          connected: false,
          account: null,
          permission: null,
          error: 'Google Calendar is not available in this build.',
        },
      ])
    ).toBe(true);
    expect(
      hasNoConnectableCalendarSource([
        {
          source: 'google',
          available: true,
          connected: false,
          account: null,
          permission: null,
          error: null,
        },
      ])
    ).toBe(false);
  });
});

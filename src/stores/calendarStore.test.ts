import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CalendarEvent, CalendarInfo, CalendarSourceStatus } from '@/types';

const calendarApi = vi.hoisted(() => ({
  connectGoogleCalendar: vi.fn(),
  disconnectGoogleCalendar: vi.fn(),
  fetchCalendarEvents: vi.fn(),
  getCalendarPermission: vi.fn(),
  isCalendarAuthorized: vi.fn(),
  listCalendarSources: vi.fn(),
  requestCalendarPermission: vi.fn(),
}));

vi.mock('@/lib/calendar', () => calendarApi);

import {
  hasNoConnectableCalendarSource,
  migrateCalendarState,
  useCalendarStore,
} from './calendarStore';

function calendar(
  id: string,
  source: CalendarInfo['source'],
  title: string,
  extras: Record<string, unknown> = {}
): CalendarInfo {
  return {
    id,
    source,
    title,
    color: '#336699',
    isSubscribed: false,
    allowsModify: false,
    ...extras,
  };
}

function event(id: string): CalendarEvent {
  return {
    id,
    source: 'google',
    title: id,
    start: '2026-08-15T09:00:00+01:00',
    end: '2026-08-15T10:00:00+01:00',
    isAllDay: false,
    location: '',
    notes: '',
    calendarId: 'google:primary',
    calendarTitle: 'Primary',
    calendarColor: '#336699',
    url: '',
  };
}

const connectedGoogle: CalendarSourceStatus = {
  source: 'google',
  available: true,
  connected: true,
  account: null,
  permission: null,
  error: null,
};

describe('calendar store requests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    calendarApi.disconnectGoogleCalendar.mockResolvedValue(undefined);
    calendarApi.fetchCalendarEvents.mockResolvedValue({ events: [], errors: [] });
    calendarApi.listCalendarSources.mockResolvedValue([]);
    useCalendarStore.getState().clearEvents();
    useCalendarStore.setState({
      sources: [connectedGoogle],
      calendars: [],
      selectedCalendarIds: [],
      selectedCalendarSources: {},
      legacySelectedAppleCalendarId: null,
      calendarEnabled: true,
      showAllDayEvents: true,
      events: [],
      sourceErrors: [],
      eventsError: null,
      isLoadingEvents: false,
    });
  });

  it('prunes only calendars whose source enumerated successfully', async () => {
    const appleWork = calendar('apple:work', 'apple', 'Work');
    const googleOld = calendar('google:old', 'google', 'Old Google calendar');
    const googleLive = calendar('google:live', 'google', 'Live Google calendar');
    useCalendarStore.setState({
      calendars: [appleWork, googleOld],
      selectedCalendarIds: [appleWork.id, googleOld.id],
    });
    calendarApi.listCalendarSources.mockResolvedValue([
      {
        source: 'apple',
        available: true,
        connected: true,
        account: null,
        permission: 'FullAccess',
        error: 'EventKit was temporarily unavailable.',
        calendars: [],
        calendarsEnumerated: false,
      },
      {
        ...connectedGoogle,
        calendars: [googleLive],
        calendarsEnumerated: true,
      },
    ]);

    await useCalendarStore.getState().fetchCalendars();

    expect(useCalendarStore.getState().selectedCalendarIds).toEqual([appleWork.id]);
    expect(useCalendarStore.getState().calendars).toEqual([appleWork, googleLive]);
  });

  it('uses persisted CalendarInfo source metadata when pruning after restart', async () => {
    useCalendarStore.setState({
      calendars: [],
      selectedCalendarIds: ['google:removed'],
      selectedCalendarSources: { 'google:removed': 'google' },
    });
    calendarApi.listCalendarSources.mockResolvedValue([
      {
        ...connectedGoogle,
        calendars: [],
        calendarsEnumerated: true,
      },
    ]);

    await useCalendarStore.getState().fetchCalendars();

    expect(useCalendarStore.getState().selectedCalendarIds).toEqual([]);
  });

  it('lets a cache hit supersede an older in-flight request', async () => {
    const cached = event('cached-day');
    const stale = event('stale-day');
    const cachedDay = new Date(2026, 7, 15, 12);
    const staleDay = new Date(2026, 7, 14, 12);

    calendarApi.fetchCalendarEvents.mockResolvedValueOnce({ events: [cached], errors: [] });
    await useCalendarStore.getState().fetchEvents(cachedDay);

    let resolveStale: ((value: { events: CalendarEvent[]; errors: [] }) => void) | undefined;
    calendarApi.fetchCalendarEvents.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveStale = resolve;
        })
    );
    const staleRequest = useCalendarStore
      .getState()
      .fetchEvents(staleDay, undefined, { force: true });

    await useCalendarStore.getState().fetchEvents(cachedDay);
    resolveStale?.({ events: [stale], errors: [] });
    await staleRequest;

    expect(useCalendarStore.getState().events).toEqual([cached]);
  });

  it('does not broaden a pending v0 Apple selection to all calendars', async () => {
    useCalendarStore.setState({ legacySelectedAppleCalendarId: 'ABC-123' });

    await useCalendarStore.getState().fetchEvents(new Date(2026, 7, 15, 12));

    expect(calendarApi.fetchCalendarEvents).not.toHaveBeenCalled();
  });

  it('keeps comma-bearing opaque ids from colliding in the event cache', async () => {
    const first = event('two-calendar-selection');
    const second = event('one-comma-bearing-calendar');
    const day = new Date(2026, 7, 15, 12);
    calendarApi.fetchCalendarEvents
      .mockResolvedValueOnce({ events: [first], errors: [] })
      .mockResolvedValueOnce({ events: [second], errors: [] });

    useCalendarStore.setState({ selectedCalendarIds: ['apple:a', 'google:b'] });
    await useCalendarStore.getState().fetchEvents(day);
    useCalendarStore.setState({ selectedCalendarIds: ['apple:a,google:b'] });
    await useCalendarStore.getState().fetchEvents(day);

    expect(calendarApi.fetchCalendarEvents).toHaveBeenCalledTimes(2);
    expect(useCalendarStore.getState().events).toEqual([second]);
  });

  it('uses CalendarInfo.source when removing a disconnected source', async () => {
    const opaqueGoogle = calendar('opaque-calendar-id', 'google', 'Primary');
    useCalendarStore.setState({
      calendars: [opaqueGoogle],
      selectedCalendarIds: [opaqueGoogle.id],
    });

    await useCalendarStore.getState().disconnectGoogle();

    expect(useCalendarStore.getState().selectedCalendarIds).toEqual([]);
  });

  it('resolves a v0 Apple selection from backend-owned calendar metadata', async () => {
    const appleWork = calendar('apple:namespaced-by-rust', 'apple', 'Work', {
      legacyId: 'ABC-123',
    });
    useCalendarStore.setState({
      selectedCalendarIds: [],
      legacySelectedAppleCalendarId: 'ABC-123',
    });
    calendarApi.listCalendarSources.mockResolvedValue([
      {
        source: 'apple',
        available: true,
        connected: true,
        account: null,
        permission: 'FullAccess',
        error: null,
        calendars: [appleWork],
        calendarsEnumerated: true,
      },
    ]);

    await useCalendarStore.getState().fetchCalendars();

    expect(useCalendarStore.getState().selectedCalendarIds).toEqual([appleWork.id]);
  });
});

describe('calendar persisted-state migration', () => {
  it('defers a v0 Apple selection until Rust returns its namespaced id', () => {
    const migrated = migrateCalendarState(
      {
        selectedCalendarId: 'ABC-123',
        calendarEnabled: true,
        showAllDayEvents: false,
        hasSeenOnboarding: true,
      },
      0
    );

    expect(migrated.selectedCalendarIds).toEqual([]);
    expect(migrated.selectedCalendarSources).toEqual({});
    expect(migrated.legacySelectedAppleCalendarId).toBe('ABC-123');
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

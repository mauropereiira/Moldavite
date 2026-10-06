import { fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CalendarEvent, CalendarSourceStatus } from '@/types';
import { useCalendarStore, useNoteStore } from '@/stores';
import { DayEvents } from './DayEvents';

const platform = vi.hoisted(() => ({ mobile: false }));
vi.mock('@/lib/platform', () => ({ isMobilePlatform: () => platform.mobile }));

const unavailableSources: CalendarSourceStatus[] = [
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
];

const availableGoogle: CalendarSourceStatus = {
  source: 'google',
  available: true,
  connected: false,
  account: null,
  permission: null,
  error: null,
};

const event: CalendarEvent = {
  id: 'google:event-1',
  source: 'google',
  title: 'Product review',
  start: '2025-03-14T09:00:00',
  end: '2025-03-14T10:00:00',
  isAllDay: false,
  location: '',
  notes: '',
  calendarId: 'google:primary',
  calendarTitle: 'Primary',
  calendarColor: 'var(--calendar-google)',
  url: '',
};

function buildEvent(overrides: Partial<CalendarEvent>): CalendarEvent {
  return { ...event, ...overrides };
}

describe('DayEvents', () => {
  beforeEach(() => {
    localStorage.clear();
    useNoteStore.setState({ selectedDate: new Date(2025, 2, 14, 12) });
    useCalendarStore.setState({
      permissionStatus: 'NotDetermined',
      sources: [],
      events: [],
      isLoadingEvents: false,
      eventsError: null,
      sourceErrors: [],
      lastSynced: null,
      calendarEnabled: true,
      selectedCalendarIds: [],
      showAllDayEvents: true,
      checkPermission: vi.fn(async () => {}),
      fetchEvents: vi.fn(async () => {}),
      connectGoogle: vi.fn(async () => true),
      isConnectingGoogle: false,
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    platform.mobile = false;
  });

  const deniedApple: CalendarSourceStatus = {
    source: 'apple',
    available: true,
    connected: false,
    account: null,
    permission: 'Denied',
    error: null,
  };

  it('points a denied Mac at System Settings with a button', () => {
    useCalendarStore.setState({ permissionStatus: 'Denied', sources: [deniedApple] });

    render(<DayEvents />);

    expect(screen.getByText('Calendar Access Denied')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Open Settings' })).toBeInTheDocument();
  });

  it('tells a denied phone where Full Access is instead of offering a dead button', () => {
    platform.mobile = true;
    useCalendarStore.setState({ permissionStatus: 'Denied', sources: [deniedApple] });

    render(<DayEvents />);

    expect(screen.getByText('Calendar Access Denied')).toBeInTheDocument();
    expect(
      screen.getByText(/Privacy & Security → Calendars and choose Full Access/)
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Open Settings' })).not.toBeInTheDocument();
  });

  it('offers both sources on a phone and names the sign-in sheet while it is open', () => {
    platform.mobile = true;
    useCalendarStore.setState({
      sources: [{ ...deniedApple, permission: 'NotDetermined' }, availableGoogle],
      isConnectingGoogle: true,
    });

    render(<DayEvents />);

    expect(screen.getByRole('button', { name: 'Connect Apple Calendar' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Waiting for Google sign-in…' })).toBeInTheDocument();
  });

  it('shows a coming-soon state when every reported source is unavailable', () => {
    useCalendarStore.setState({ sources: unavailableSources });

    render(<DayEvents />);

    expect(screen.getByText("Calendar sync isn't available here yet.")).toBeInTheDocument();
    expect(screen.getByText('Events will appear here when it arrives.')).toBeInTheDocument();
    expect(screen.queryByText('Connect Your Calendar')).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Open Calendar Settings' })
    ).not.toBeInTheDocument();
  });

  it('keeps the connect-calendar prompt when a source is available but disconnected', () => {
    useCalendarStore.setState({ sources: [availableGoogle] });

    render(<DayEvents />);

    expect(screen.getByText('Connect Your Calendar')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Connect Google Calendar' })).toBeInTheDocument();
    expect(screen.queryByText("Calendar sync isn't available here yet.")).not.toBeInTheDocument();
  });

  it('renders events unchanged when a source is connected', () => {
    useCalendarStore.setState({
      sources: [{ ...availableGoogle, connected: true }],
      events: [event],
    });

    render(<DayEvents />);

    expect(screen.getByText('Product review')).toBeInTheDocument();
    expect(screen.queryByText('Connect Your Calendar')).not.toBeInTheDocument();
    expect(screen.queryByText("Calendar sync isn't available here yet.")).not.toBeInTheDocument();
  });

  it.each([
    [new Date(2025, 2, 14, 12), 'No events on this day.'],
    [new Date(), 'No events today.'],
  ])('names the empty day it shows: %s', (selectedDate, line) => {
    useNoteStore.setState({ selectedDate });
    useCalendarStore.setState({ sources: [{ ...availableGoogle, connected: true }] });

    render(<DayEvents />);

    expect(screen.getByText(line)).toBeInTheDocument();
  });

  it('lists all-day events first, then timed ones with their times', () => {
    useCalendarStore.setState({
      sources: [{ ...availableGoogle, connected: true }],
      events: [
        buildEvent({
          id: 'google:late',
          title: 'Late',
          start: '2025-03-14T16:00:00',
          end: '2025-03-14T17:30:00',
        }),
        buildEvent({
          id: 'google:holiday',
          title: 'Holiday',
          start: '2025-03-14T00:00:00',
          end: '2025-03-15T00:00:00',
          isAllDay: true,
        }),
        event,
      ],
    });

    render(<DayEvents />);

    const items = within(screen.getByRole('list', { name: 'Events' })).getAllByRole('listitem');
    expect(items.map((item) => item.textContent)).toEqual([
      'HolidayAll day',
      'Product review09:00 – 10:00',
      'Late16:00 – 17:30',
    ]);
  });

  it('keeps the sync control and a failing source beside the events that loaded', () => {
    const fetchEvents = vi.fn(async () => {});
    useCalendarStore.setState({
      sources: [{ ...availableGoogle, connected: true }],
      events: [event],
      sourceErrors: [{ source: 'apple', message: 'Access was revoked' }],
      fetchEvents,
    });

    render(<DayEvents />);

    expect(screen.getByText('Apple Calendar: Access was revoked')).toBeInTheDocument();
    expect(screen.getByText('Product review')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Sync calendar events' }));
    expect(fetchEvents).toHaveBeenLastCalledWith(expect.any(Date), undefined, { force: true });
  });

  it('says when calendar sync is off instead of showing a stale list', () => {
    useCalendarStore.setState({
      sources: [{ ...availableGoogle, connected: true }],
      events: [event],
      calendarEnabled: false,
    });

    render(<DayEvents />);

    expect(screen.getByText('Calendar sync is disabled.')).toBeInTheDocument();
    expect(screen.queryByText('Product review')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Sync calendar events' })).not.toBeInTheDocument();
  });

  it('orders provider timestamps by instant rather than serialized text', () => {
    vi.stubEnv('TZ', 'Europe/Lisbon');
    useNoteStore.setState({ selectedDate: new Date(2026, 7, 7, 12) });
    useCalendarStore.setState({
      sources: [{ ...availableGoogle, connected: true }],
      events: [
        buildEvent({
          id: 'apple:later',
          source: 'apple',
          title: 'Later instant',
          start: '2026-08-07T07:00:00Z',
          end: '2026-08-07T08:00:00Z',
        }),
        buildEvent({
          id: 'google:earlier',
          title: 'Earlier instant',
          start: '2026-08-07T09:00:00+03:00',
          end: '2026-08-07T10:00:00+03:00',
        }),
      ],
    });

    const { container } = render(<DayEvents />);

    expect(
      Array.from(container.querySelectorAll('.event-title')).map((node) => node.textContent)
    ).toEqual(['Earlier instant', 'Later instant']);
  });

  it('lists an event crossing midnight on both Lisbon days it touches', () => {
    vi.stubEnv('TZ', 'Europe/Lisbon');
    const overnight = buildEvent({
      id: 'google:overnight',
      title: 'Overnight event',
      start: '2026-08-14T23:30:00+01:00',
      end: '2026-08-15T01:00:00+01:00',
    });
    useCalendarStore.setState({
      sources: [{ ...availableGoogle, connected: true }],
      events: [overnight],
    });

    useNoteStore.setState({ selectedDate: new Date(2026, 7, 15, 12) });
    const { unmount } = render(<DayEvents />);
    expect(screen.getByText('23:30 – 01:00')).toBeInTheDocument();
    unmount();

    useNoteStore.setState({ selectedDate: new Date(2026, 7, 16, 12) });
    render(<DayEvents />);
    expect(screen.queryByText('Overnight event')).not.toBeInTheDocument();
  });

  it('orders the two 01:30s of the New York fall-back day by instant', () => {
    vi.stubEnv('TZ', 'America/New_York');
    const selectedDate = new Date(2026, 10, 1, 12);
    expect(selectedDate.getTimezoneOffset()).toBe(300);
    useNoteStore.setState({ selectedDate });
    useCalendarStore.setState({
      sources: [{ ...availableGoogle, connected: true }],
      events: [
        buildEvent({
          id: 'google:second-fold',
          title: 'Second 01:30',
          start: '2026-11-01T01:30:00-05:00',
          end: '2026-11-01T02:00:00-05:00',
        }),
        buildEvent({
          id: 'google:first-fold',
          title: 'First 01:30',
          start: '2026-11-01T01:30:00-04:00',
          end: '2026-11-01T01:30:00-05:00',
        }),
      ],
    });

    const { container } = render(<DayEvents />);

    expect(
      Array.from(container.querySelectorAll('.event-title')).map((node) => node.textContent)
    ).toEqual(['First 01:30', 'Second 01:30']);
  });
});

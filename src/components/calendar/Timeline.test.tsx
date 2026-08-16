import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CalendarEvent, CalendarSourceStatus } from '@/types';
import { useCalendarStore, useNoteStore } from '@/stores';
import { Timeline } from './Timeline';

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

describe('Timeline calendar source states', () => {
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
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('shows a coming-soon state when every reported source is unavailable', () => {
    useCalendarStore.setState({ sources: unavailableSources });

    render(<Timeline />);

    expect(screen.getByText("Calendar sync isn't available here yet.")).toBeInTheDocument();
    expect(screen.getByText('Events will appear here when it arrives.')).toBeInTheDocument();
    expect(screen.queryByText('Connect Your Calendar')).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Open Calendar Settings' })
    ).not.toBeInTheDocument();
  });

  it('keeps the connect-calendar prompt when a source is available but disconnected', () => {
    useCalendarStore.setState({ sources: [availableGoogle] });

    render(<Timeline />);

    expect(screen.getByText('Connect Your Calendar')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Connect Google Calendar' })).toBeInTheDocument();
    expect(screen.queryByText("Calendar sync isn't available here yet.")).not.toBeInTheDocument();
  });

  it('renders events unchanged when a source is connected', () => {
    useCalendarStore.setState({
      sources: [{ ...availableGoogle, connected: true }],
      events: [event],
    });

    render(<Timeline />);

    expect(screen.getByText('Product review')).toBeInTheDocument();
    expect(screen.queryByText('Connect Your Calendar')).not.toBeInTheDocument();
    expect(screen.queryByText("Calendar sync isn't available here yet.")).not.toBeInTheDocument();
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

    const { container } = render(<Timeline />);

    expect(
      Array.from(container.querySelectorAll('.event-title')).map((node) => node.textContent)
    ).toEqual(['Earlier instant', 'Later instant']);
  });

  it('clips an event crossing midnight to the selected Lisbon day', () => {
    vi.stubEnv('TZ', 'Europe/Lisbon');
    useNoteStore.setState({ selectedDate: new Date(2026, 7, 15, 12) });
    useCalendarStore.setState({
      sources: [{ ...availableGoogle, connected: true }],
      events: [
        buildEvent({
          id: 'google:overnight',
          title: 'Overnight event',
          start: '2026-08-14T23:30:00+01:00',
          end: '2026-08-15T01:00:00+01:00',
        }),
      ],
    });

    render(<Timeline />);

    const block = screen.getByText('Overnight event').closest('.event-item-enter');
    expect(block).toHaveStyle({ top: '0px', height: '60px' });
  });

  it('uses elapsed hours on the 25-hour New York fall-back day', () => {
    vi.stubEnv('TZ', 'America/New_York');
    const selectedDate = new Date(2026, 10, 1, 12);
    expect(selectedDate.getTimezoneOffset()).toBe(300);
    useNoteStore.setState({ selectedDate });
    useCalendarStore.setState({
      sources: [{ ...availableGoogle, connected: true }],
      events: [
        buildEvent({
          id: 'google:first-fold',
          title: 'First 01:30',
          start: '2026-11-01T01:30:00-04:00',
          end: '2026-11-01T01:30:00-05:00',
        }),
        buildEvent({
          id: 'google:second-fold',
          title: 'Second 01:30',
          start: '2026-11-01T01:30:00-05:00',
          end: '2026-11-01T02:00:00-05:00',
        }),
      ],
    });

    render(<Timeline />);

    const grid = screen.getByRole('region', { name: 'Hourly timeline' }).firstElementChild;
    const first = screen.getByText('First 01:30').closest('.event-item-enter');
    const second = screen.getByText('Second 01:30').closest('.event-item-enter');
    expect(grid).toHaveStyle({ height: '1500px' });
    expect(first).toHaveStyle({ top: '90px', height: '60px' });
    expect(second).toHaveStyle({ top: '150px' });
  });
});

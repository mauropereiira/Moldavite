import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
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
});

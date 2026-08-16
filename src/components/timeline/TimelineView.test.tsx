import { render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CalendarEvent } from '@/types';
import { useCalendarStore, useNoteStore } from '@/stores';
import { TimelineView } from './TimelineView';

const calendarApi = vi.hoisted(() => ({
  fetchCalendarEvents: vi.fn(),
  listCalendarSources: vi.fn(),
}));

vi.mock('@/lib/calendar', () => calendarApi);
vi.mock('@/lib', () => ({
  noteFileBackendPath: vi.fn(),
  readNote: vi.fn(),
}));
vi.mock('@/hooks', () => ({
  useNotes: () => ({ loadNote: vi.fn() }),
}));

function calendarEvent(overrides: Partial<CalendarEvent>): CalendarEvent {
  return {
    id: 'google:event',
    source: 'google',
    title: 'Event',
    start: '2026-08-15T09:00:00+01:00',
    end: '2026-08-15T10:00:00+01:00',
    isAllDay: false,
    location: '',
    notes: '',
    calendarId: 'google:primary',
    calendarTitle: 'Primary',
    calendarColor: '#336699',
    url: '',
    ...overrides,
  };
}

describe('TimelineView calendar day buckets', () => {
  beforeEach(() => {
    vi.stubEnv('TZ', 'Europe/Lisbon');
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-08-15T12:00:00+01:00'));
    expect(new Date().getTimezoneOffset()).toBe(-60);
    useNoteStore.setState({ notes: [] });
    useCalendarStore.setState({ selectedCalendarIds: [] });
    calendarApi.listCalendarSources.mockResolvedValue([
      {
        source: 'google',
        available: true,
        connected: true,
        account: null,
        permission: null,
        error: null,
      },
    ]);
    calendarApi.fetchCalendarEvents.mockResolvedValue({
      events: [
        calendarEvent({
          id: 'google:overnight',
          title: 'Overnight deployment',
          start: '2026-08-14T23:30:00+01:00',
          end: '2026-08-15T01:00:00+01:00',
        }),
        calendarEvent({
          id: 'google:conference',
          title: 'Three-day conference',
          start: '2026-08-14',
          end: '2026-08-17',
          isAllDay: true,
        }),
      ],
      errors: [],
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });

  it('includes cross-midnight and multi-day events in every overlapping local day', async () => {
    render(<TimelineView />);

    const today = (await screen.findByRole('heading', { name: 'Today' })).closest('section');
    const yesterday = screen.getByRole('heading', { name: 'Yesterday' }).closest('section');

    expect(today).not.toBeNull();
    expect(yesterday).not.toBeNull();
    expect(within(today as HTMLElement).getByText('Overnight deployment')).toBeInTheDocument();
    expect(within(today as HTMLElement).getByText('Three-day conference')).toBeInTheDocument();
    expect(within(yesterday as HTMLElement).getByText('Overnight deployment')).toBeInTheDocument();
    expect(within(yesterday as HTMLElement).getByText('Three-day conference')).toBeInTheDocument();
  });
});

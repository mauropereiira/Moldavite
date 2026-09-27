import { act, render, screen, within } from '@testing-library/react';
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
  noteFileBackendPath: vi.fn((note: { name: string }) => note.name),
  readNote: vi.fn(),
  readNoteSnapshot: vi.fn(async () => ({
    content: 'Plan \\[\\[draft\\]\\]\n| A | B |\n| --- | --- |\n| 1 | 2 |',
  })),
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
    useCalendarStore.setState({
      selectedCalendarIds: [],
      calendarEnabled: true,
      showAllDayEvents: true,
    });
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

  it('shows no events while calendar sync is turned off', async () => {
    useCalendarStore.setState({ calendarEnabled: false });
    calendarApi.fetchCalendarEvents.mockClear();
    render(<TimelineView />);

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });

    expect(calendarApi.fetchCalendarEvents).not.toHaveBeenCalled();
    expect(screen.queryByText('Overnight deployment')).not.toBeInTheDocument();
  });

  it('leaves out all-day events when they are hidden', async () => {
    useCalendarStore.setState({ showAllDayEvents: false });
    render(<TimelineView />);

    expect((await screen.findAllByText('Overnight deployment')).length).toBeGreaterThan(0);
    expect(screen.queryByText('Three-day conference')).not.toBeInTheDocument();
  });
});

describe('TimelineView rows', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-08-15T12:00:00+01:00'));
    calendarApi.listCalendarSources.mockResolvedValue([]);
    calendarApi.fetchCalendarEvents.mockResolvedValue({ events: [], errors: [] });
    useNoteStore.setState({
      notes: [
        {
          name: '2026-08-15.md',
          path: 'daily/2026-08-15.md',
          isDaily: true,
          isWeekly: false,
          isLocked: false,
          date: '2026-08-15',
        },
      ],
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('names a daily note by its date and previews plain text, not Markdown', async () => {
    render(<TimelineView />);

    expect(await screen.findByText('15 August')).toBeInTheDocument();
    expect(await screen.findByText('Plan [[draft]] A B 1 2')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Close Timeline' })).toHaveTextContent('×');
  });
});

describe('TimelineView buckets', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-08-15T12:00:00+01:00'));
    calendarApi.listCalendarSources.mockResolvedValue([]);
    calendarApi.fetchCalendarEvents.mockResolvedValue({ events: [], errors: [] });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('puts a future daily note under Upcoming, not This week', async () => {
    useNoteStore.setState({
      notes: [
        {
          name: '2026-08-20.md',
          path: 'daily/2026-08-20.md',
          isDaily: true,
          isWeekly: false,
          isLocked: false,
          date: '2026-08-20',
        },
      ],
    });

    render(<TimelineView />);

    expect(screen.queryByRole('heading', { name: 'This week' })).not.toBeInTheDocument();
    const upcoming = screen.getByRole('heading', { name: 'Upcoming' }).closest('section');
    expect(within(upcoming as HTMLElement).getByText('20 August')).toBeInTheDocument();
  });
});

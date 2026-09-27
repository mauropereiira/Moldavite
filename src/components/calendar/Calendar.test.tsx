import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { format } from 'date-fns';
import type { CalendarEvent } from '@/types';
import { useCalendarStore, useNoteStore } from '@/stores';
import { Calendar } from './Calendar';

const calendarApi = vi.hoisted(() => ({
  fetchCalendarEvents: vi.fn(),
}));

vi.mock('@/lib/calendar', () => ({
  fetchCalendarEvents: calendarApi.fetchCalendarEvents,
}));

const notesApi = vi.hoisted(() => ({
  loadDailyNote: vi.fn(),
  loadWeeklyNote: vi.fn<(date: Date) => void>(),
}));
const platform = vi.hoisted(() => ({ mobile: false }));
vi.mock('@/lib/platform', () => ({ isMobilePlatform: () => platform.mobile }));

vi.mock('@/hooks', () => ({
  useNotes: () => notesApi,
}));

function buildEvents(count: number): CalendarEvent[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `google:event-${index}`,
    source: 'google',
    title: `Event ${index + 1}`,
    start: `2025-03-14T${String(9 + index).padStart(2, '0')}:00:00`,
    end: `2025-03-14T${String(10 + index).padStart(2, '0')}:00:00`,
    isAllDay: false,
    location: '',
    notes: '',
    calendarId: 'google:primary',
    calendarTitle: 'Primary',
    calendarColor: 'var(--calendar-google)',
    url: '',
  }));
}

describe('Calendar day indicators', () => {
  beforeEach(() => {
    platform.mobile = false;
    calendarApi.fetchCalendarEvents.mockReset();
    calendarApi.fetchCalendarEvents.mockResolvedValue({ events: buildEvents(4), errors: [] });
    useNoteStore.setState({
      notes: [],
      selectedDate: new Date(2025, 2, 14, 12),
      selectedWeek: null,
    });
    useCalendarStore.setState({
      sources: [
        {
          source: 'google',
          available: true,
          connected: true,
          account: null,
          permission: null,
          error: null,
        },
      ],
      calendarEnabled: true,
      selectedCalendarIds: [],
      showAllDayEvents: true,
      checkPermission: vi.fn(async () => {}),
    });
  });

  // Dots mark what *kind* of thing is on a day, not how many. Counting events
  // made a day with six back-to-back meetings and a day with one long one look
  // equally busy while saying nothing about either.
  it('marks a day with events using the events colour, once', async () => {
    const { container } = render(<Calendar />);

    await waitFor(() => {
      expect(calendarApi.fetchCalendarEvents).toHaveBeenCalledWith('2025-02-23', '2025-04-05', []);
    });

    const day = container.querySelector('button[data-date="2025-03-14"]');
    expect(day).toBeInTheDocument();

    await waitFor(() => {
      const marks = day?.querySelectorAll('circle');
      // Three events that day, but "has events" is one fact about it.
      expect(marks).toHaveLength(1);
      expect(marks?.[0].getAttribute('fill')).toBe('var(--accent)');
    });
  });

  // A colour-coded grid with no key is decoration.
  it('names every mark colour in a legend', async () => {
    render(<Calendar />);
    const legend = await screen.findByLabelText('What the marks under each date mean');
    for (const label of ['To-do', 'Events', 'Note']) {
      expect(within(legend).getByText(label)).toBeInTheDocument();
    }
  });

  it('marks event days and names them in the legend on a phone too', async () => {
    platform.mobile = true;
    const { container } = render(<Calendar />);

    await waitFor(() => {
      expect(calendarApi.fetchCalendarEvents).toHaveBeenCalledWith('2025-02-23', '2025-04-05', []);
    });
    await waitFor(() => {
      const marks = container
        .querySelector('button[data-date="2025-03-14"]')
        ?.querySelectorAll('circle');
      expect(marks?.[0]?.getAttribute('fill')).toBe('var(--accent)');
    });
    const legend = screen.getByLabelText('What the marks under each date mean');
    expect(within(legend).getByText('Events')).toBeInTheDocument();
    expect(useCalendarStore.getState().checkPermission).toHaveBeenCalled();
  });

  it('keeps the month grid and daily-note indicators when every source is unavailable', () => {
    useNoteStore.setState({
      notes: [
        {
          name: '2025-03-14.md',
          path: 'daily/2025-03-14.md',
          isDaily: true,
          isWeekly: false,
          date: '2025-03-14',
          isLocked: false,
        },
      ],
    });
    useCalendarStore.setState({
      sources: [
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
      ],
    });

    const { container } = render(<Calendar />);

    // By date: 30 March's row is ISO week 14, so its week button is also named "14".
    const dailyNoteDay = container.querySelector('button[data-date="2025-03-14"]');
    expect(screen.getByText('March 2025')).toBeInTheDocument();
    expect(dailyNoteDay).toHaveStyle({ fontWeight: 500 });
    expect(calendarApi.fetchCalendarEvents).not.toHaveBeenCalled();
  });
});

describe('Calendar week column', () => {
  beforeEach(() => {
    notesApi.loadWeeklyNote.mockReset();
    useCalendarStore.setState({
      sources: [],
      calendarEnabled: true,
      checkPermission: vi.fn(async () => {}),
    });
  });

  it('numbers, marks and opens a Sunday-first row by the ISO week of its Monday', () => {
    useNoteStore.setState({
      notes: [
        {
          name: '2026-W40.md',
          path: 'weekly/2026-W40.md',
          isDaily: false,
          isWeekly: true,
          week: '2026-W40',
          isLocked: false,
        },
      ],
      selectedDate: new Date(2026, 9, 1, 12),
      selectedWeek: null,
    });

    render(<Calendar />);

    const firstRow = screen.getAllByTitle(/^Week \d+: open the weekly note$/)[0];
    expect(firstRow).toHaveAccessibleName('40');
    expect(firstRow).toHaveStyle({ color: 'var(--text-primary)' });

    fireEvent.click(firstRow);
    const opened = notesApi.loadWeeklyNote.mock.calls[0][0];
    expect(format(opened, "RRRR-'W'II")).toBe('2026-W40');
    expect(useNoteStore.getState().selectedWeek).toEqual(new Date(2026, 8, 28));
    expect(firstRow).toHaveStyle({ fontWeight: 600 });
  });

  it('opens the next ISO year for the row that straddles New Year', () => {
    useNoteStore.setState({
      notes: [],
      selectedDate: new Date(2025, 11, 15, 12),
      selectedWeek: null,
    });

    render(<Calendar />);

    const rows = screen.getAllByTitle(/^Week \d+: open the weekly note$/);
    const lastRow = rows[rows.length - 1];
    expect(lastRow).toHaveAccessibleName('1');
    fireEvent.click(lastRow);
    const opened = notesApi.loadWeeklyNote.mock.calls[0][0];
    expect(format(opened, "RRRR-'W'II")).toBe('2026-W01');
  });
});

describe('Calendar follows the selection', () => {
  beforeEach(() => {
    calendarApi.fetchCalendarEvents.mockReset();
    calendarApi.fetchCalendarEvents.mockResolvedValue({ events: [], errors: [] });
    useNoteStore.setState({
      notes: [],
      selectedDate: new Date(2025, 2, 14, 12),
      selectedWeek: null,
    });
    useCalendarStore.setState({
      sources: [
        {
          source: 'google',
          available: true,
          connected: true,
          account: null,
          permission: null,
          error: null,
        },
      ],
      calendarEnabled: true,
      selectedCalendarIds: [],
      showAllDayEvents: true,
      lastSynced: null,
      checkPermission: vi.fn(async () => {}),
    });
  });

  it('shows the month of a selection made elsewhere, such as Today', () => {
    render(<Calendar />);
    expect(screen.getByText('March 2025')).toBeInTheDocument();

    act(() => useNoteStore.getState().setSelectedDate(new Date(2025, 5, 2, 12)));

    expect(screen.getByText('June 2025')).toBeInTheDocument();
  });

  it('keeps a browsed month when the selection moves within it', () => {
    render(<Calendar />);
    fireEvent.click(screen.getByLabelText('Next month'));
    expect(screen.getByText('April 2025')).toBeInTheDocument();

    act(() => useNoteStore.getState().setSelectedDate(new Date(2025, 3, 10, 12)));

    expect(screen.getByText('April 2025')).toBeInTheDocument();
  });

  it('refetches the month dots after a sync', async () => {
    render(<Calendar />);
    await waitFor(() => expect(calendarApi.fetchCalendarEvents).toHaveBeenCalledTimes(1));

    act(() => useCalendarStore.setState({ lastSynced: new Date() }));

    await waitFor(() => expect(calendarApi.fetchCalendarEvents).toHaveBeenCalledTimes(2));
  });
});

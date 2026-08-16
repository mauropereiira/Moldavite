import { render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CalendarEvent } from '@/types';
import { useCalendarStore, useNoteStore } from '@/stores';
import { Calendar } from './Calendar';

const calendarApi = vi.hoisted(() => ({
  fetchCalendarEvents: vi.fn(),
}));

vi.mock('@/lib/calendar', () => ({
  fetchCalendarEvents: calendarApi.fetchCalendarEvents,
}));

vi.mock('@/hooks', () => ({
  useNotes: () => ({
    loadDailyNote: vi.fn(),
    loadWeeklyNote: vi.fn(),
  }),
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

    render(<Calendar />);

    const dailyNoteDay = screen.getByRole('button', {
      name: '14',
    });
    expect(screen.getByText('March 2025')).toBeInTheDocument();
    expect(dailyNoteDay).toHaveStyle({ fontWeight: 500 });
    expect(calendarApi.fetchCalendarEvents).not.toHaveBeenCalled();
  });
});

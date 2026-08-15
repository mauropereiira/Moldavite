import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CalendarSourceStatus } from '@/types';
import { useCalendarStore } from '@/stores/calendarStore';
import { CalendarSection } from './CalendarSection';

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

describe('CalendarSection', () => {
  beforeEach(() => {
    localStorage.clear();
    useCalendarStore.setState({
      sources: unavailableSources,
      calendars: [],
      selectedCalendarIds: [],
      connectError: null,
      isConnectingGoogle: false,
      isRequestingPermission: false,
      checkPermission: vi.fn(async () => {}),
    });
  });

  it('replaces unavailable source controls with the shared coming-soon state', () => {
    render(<CalendarSection />);

    expect(screen.getByText("Calendar sync isn't available here yet.")).toBeInTheDocument();
    expect(screen.getByText('Events will appear here when it arrives.')).toBeInTheDocument();
    expect(screen.queryByText('Google Calendar')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /connect/i })).not.toBeInTheDocument();
  });
});

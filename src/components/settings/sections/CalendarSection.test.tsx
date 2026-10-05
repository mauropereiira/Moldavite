import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CalendarSourceStatus } from '@/types';
import { useCalendarStore } from '@/stores/calendarStore';
import { useSettingsStore } from '@/stores';
import { CalendarSection } from './CalendarSection';

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

describe('CalendarSection', () => {
  beforeEach(() => {
    localStorage.clear();
    platform.mobile = false;
    useSettingsStore.getState().resetToDefaults();
    useCalendarStore.setState({
      isAuthorized: false,
      permissionStatus: 'NotDetermined',
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

  const googleReady: CalendarSourceStatus = {
    source: 'google',
    available: true,
    connected: false,
    account: null,
    permission: null,
    error: null,
  };

  it('says plainly on Windows and Linux that Apple Calendar needs Apple hardware', () => {
    useCalendarStore.setState({
      sources: [
        {
          ...unavailableSources[0],
          error: 'Apple Calendar is only available on a Mac, iPhone or iPad.',
        },
        googleReady,
      ],
    });

    render(<CalendarSection />);

    expect(screen.getByText('Apple Calendar')).toBeInTheDocument();
    expect(
      screen.getByText('Apple Calendar is only available on a Mac, iPhone or iPad.')
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Allow access' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Connect account' })).toBeInTheDocument();
  });

  it('offers both sources on a phone', () => {
    platform.mobile = true;
    useCalendarStore.setState({
      sources: [
        {
          source: 'apple',
          available: true,
          connected: false,
          account: null,
          permission: 'NotDetermined',
          error: null,
        },
        googleReady,
      ],
    });

    render(<CalendarSection />);

    expect(screen.getByRole('button', { name: 'Allow access' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Connect account' })).toBeInTheDocument();
  });

  it('sends a denied phone to Settings for Full Access', () => {
    platform.mobile = true;
    useCalendarStore.setState({
      permissionStatus: 'Denied',
      sources: [
        {
          source: 'apple',
          available: true,
          connected: false,
          account: null,
          permission: 'Denied',
          error: null,
        },
        googleReady,
      ],
    });

    render(<CalendarSection />);

    expect(screen.getByText('Open Settings')).toBeInTheDocument();
    expect(screen.getByText('Choose Full Access for Moldavite')).toBeInTheDocument();
    expect(screen.queryByText('Open System Settings')).not.toBeInTheDocument();
  });

  it('names the sign-in sheet rather than a browser while a phone connects Google', () => {
    platform.mobile = true;
    useCalendarStore.setState({ sources: [googleReady], isConnectingGoogle: true });

    render(<CalendarSection />);

    expect(screen.getByText('Waiting for Google sign-in...')).toBeInTheDocument();
    expect(screen.queryByText('Waiting for your browser...')).not.toBeInTheDocument();
  });

  // The Agenda switches lived in Features; they belong with the calendars now,
  // and stay even where no calendar source can connect yet.
  it('shows the Agenda switches above the sources, even when none can connect', () => {
    platform.mobile = false;
    useCalendarStore.setState({ sources: unavailableSources });

    render(<CalendarSection />);

    fireEvent.click(screen.getByRole('switch', { name: 'Timeline' }));
    expect(useSettingsStore.getState().showTimelineWidget).toBe(false);
    fireEvent.click(screen.getByRole('switch', { name: 'Month calendar' }));
    expect(useSettingsStore.getState().showCalendarWidget).toBe(false);
  });

  it('keeps the month calendar on a phone, where it is how daily notes are reached', () => {
    platform.mobile = true;
    useCalendarStore.setState({ sources: [googleReady] });

    render(<CalendarSection />);

    expect(screen.queryByRole('switch', { name: 'Month calendar' })).not.toBeInTheDocument();
    expect(screen.getByRole('switch', { name: 'Timeline' })).toBeInTheDocument();
  });
});

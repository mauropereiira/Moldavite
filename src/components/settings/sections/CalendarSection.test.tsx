import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CalendarSourceStatus } from '@/types';
import { useCalendarStore } from '@/stores/calendarStore';
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

    expect(screen.getByRole('heading', { name: 'Apple Calendar' })).toBeInTheDocument();
    expect(
      screen.getByText('Apple Calendar is only available on a Mac, iPhone or iPad.')
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /Enable Calendar Access/ })
    ).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Connect Google Account/ })).toBeInTheDocument();
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

    expect(screen.getByRole('button', { name: /Enable Calendar Access/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Connect Google Account/ })).toBeInTheDocument();
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
});

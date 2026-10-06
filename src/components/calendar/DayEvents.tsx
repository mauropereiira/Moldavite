import { useEffect, useMemo } from 'react';
import { format, isToday, parseISO } from 'date-fns';
import { hasNoConnectableCalendarSource, useCalendarStore } from '@/stores/calendarStore';
import { useNoteStore, useSettingsStore } from '@/stores';
import type { CalendarEvent } from '@/types';
import { open } from '@tauri-apps/plugin-shell';
import { EventRow } from './EventRow';
import { ConnectCalendarEmptyState } from '@/components/ui/EmptyState';
import { CalendarSyncComingSoon } from './CalendarSyncComingSoon';
import { isMobilePlatform } from '@/lib/platform';
import { eventsOverlappingLocalDay } from './timeLayout';

function LoadingState() {
  return (
    <div className="flex flex-col p-4">
      {[1, 2, 3].map((i) => (
        <div
          key={i}
          className="animate-pulse"
          style={{ borderBottom: '1px solid var(--border-muted)' }}
        >
          <div className="flex items-start gap-2 py-3">
            <div
              className="mt-1.5 h-1.5 w-1.5"
              style={{ backgroundColor: 'var(--border-default)' }}
            />
            <div className="flex-1">
              <div
                className="mb-1 h-3 w-3/4"
                style={{ backgroundColor: 'var(--border-default)' }}
              />
              <div className="h-2 w-16" style={{ backgroundColor: 'var(--border-default)' }} />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function ErrorState({ error, onRetry }: { error: string; onRetry: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center py-8 text-center">
      <span
        className="mb-2 text-[10px] uppercase"
        style={{ color: 'var(--error)', letterSpacing: '0.14em' }}
      >
        Sync error
      </span>
      <p className="text-sm mb-2" style={{ color: 'var(--error)' }}>
        {error}
      </p>
      <button
        onClick={onRetry}
        className="text-xs transition-colors"
        style={{ color: 'var(--text-primary)', borderBottom: '1px solid currentColor' }}
        onMouseEnter={(e) => (e.currentTarget.style.opacity = '0.8')}
        onMouseLeave={(e) => (e.currentTarget.style.opacity = '1')}
      >
        Retry
      </button>
    </div>
  );
}

function PermissionDeniedState() {
  const mobile = isMobilePlatform();
  const handleOpenSettings = async () => {
    try {
      // Open macOS System Settings to Calendar privacy pane
      await open('x-apple.systempreferences:com.apple.preference.security?Privacy_Calendars');
    } catch (error) {
      console.error('[DayEvents] Failed to open System Settings:', error);
    }
  };

  return (
    <div className="flex-1 flex flex-col items-center justify-center p-4 text-center">
      <span
        className="mb-3 text-[10px] uppercase"
        style={{ color: 'var(--text-muted)', letterSpacing: '0.14em' }}
      >
        Calendar
      </span>
      <h3 className="text-sm font-medium mb-1" style={{ color: 'var(--text-primary)' }}>
        Calendar Access Denied
      </h3>
      <p className="text-xs mb-3" style={{ color: 'var(--text-muted)' }}>
        {mobile
          ? 'To see your events, open Settings → Privacy & Security → Calendars and choose Full Access for Moldavite'
          : 'To see your events, grant calendar access in System Settings'}
      </p>
      {/* The deep link is a macOS URL, and the phone webview has no shell opener. */}
      {!mobile && (
        <button
          onClick={handleOpenSettings}
          className="text-xs font-medium transition-colors"
          style={{
            color: 'var(--text-primary)',
            borderBottom: '1px solid currentColor',
          }}
          onMouseEnter={(e) => (e.currentTarget.style.opacity = '0.8')}
          onMouseLeave={(e) => (e.currentTarget.style.opacity = '1')}
        >
          Open Settings
        </button>
      )}
    </div>
  );
}

export function ConnectCalendarPrompt() {
  const {
    requestPermission,
    isRequestingPermission,
    permissionStatus,
    sources,
    connectGoogle,
    isConnectingGoogle,
  } = useCalendarStore();
  const setIsSettingsOpen = useSettingsStore((s) => s.setIsSettingsOpen);
  const setActiveSettingsTab = useSettingsStore((s) => s.setActiveSettingsTab);

  const apple = sources.find((s) => s.source === 'apple');
  const google = sources.find((s) => s.source === 'google');
  const appleBlocked = permissionStatus === 'Denied' || permissionStatus === 'Restricted';

  // Offer every source this build actually has rather than assuming Apple.
  // Picking one for the user was wrong on macOS (where both exist) and
  // impossible on Windows and Linux (where only Google does).
  const actions: { label: string; onClick: () => void; variant?: 'primary' | 'secondary' }[] = [];

  if (apple?.available && !apple.connected && !appleBlocked) {
    actions.push({
      label: isRequestingPermission ? 'Connecting…' : 'Connect Apple Calendar',
      onClick: () => void requestPermission(),
      variant: 'primary',
    });
  }
  if (google?.available && !google.connected) {
    actions.push({
      label: isConnectingGoogle
        ? isMobilePlatform()
          ? 'Waiting for Google sign-in…'
          : 'Waiting for your browser…'
        : 'Connect Google Calendar',
      onClick: () => void connectGoogle(),
      variant: actions.length === 0 ? 'primary' : 'secondary',
    });
  }

  // Apple denied at the OS level and nothing else to offer: the only way out is
  // System Settings, so keep the dedicated instructions for that case.
  if (actions.length === 0 && appleBlocked) {
    return <PermissionDeniedState />;
  }

  // Nothing connectable from here: a build with no EventKit and no Google
  // credentials. Settings explains why rather than leaving a dead button.
  if (actions.length === 0) {
    actions.push({
      label: 'Open Calendar Settings',
      onClick: () => {
        setActiveSettingsTab('calendar');
        setIsSettingsOpen(true);
      },
      variant: 'primary',
    });
  }

  return (
    <div className="flex-1 flex flex-col items-center justify-center p-2">
      <ConnectCalendarEmptyState actions={actions} />
      {appleBlocked && (
        <p className="text-xs mt-2 text-center" style={{ color: 'var(--text-muted)' }}>
          Apple Calendar access was denied in {isMobilePlatform() ? 'Settings' : 'System Settings'}.
        </p>
      )}
    </div>
  );
}

const KICKER_STYLE = { color: 'var(--text-muted)', letterSpacing: '0.14em' } as const;

function DayEventList({ events, selectedDate }: { events: CalendarEvent[]; selectedDate: Date }) {
  const dayEvents = useMemo(() => {
    const overlapping = eventsOverlappingLocalDay(events, selectedDate);
    const startOf = (event: CalendarEvent) => parseISO(event.start).getTime();
    return [
      ...overlapping.filter((event) => event.isAllDay),
      ...overlapping.filter((event) => !event.isAllDay).sort((a, b) => startOf(a) - startOf(b)),
    ];
  }, [events, selectedDate]);

  if (dayEvents.length === 0) {
    return (
      <p className="py-2 text-xs" style={{ color: 'var(--text-muted)' }}>
        {isToday(selectedDate) ? 'No events today.' : 'No events on this day.'}
      </p>
    );
  }

  return (
    <ul aria-label="Events" className="flex flex-col gap-1">
      {dayEvents.map((event, index) => (
        <li key={event.id}>
          <EventRow event={event} index={index} />
        </li>
      ))}
    </ul>
  );
}

/**
 * The selected day's calendar events as a short list, with the controls the
 * calendar sources need: connect, permission, sync and per-source errors.
 */
export function DayEvents() {
  const selectedDate = useNoteStore((state) => state.selectedDate);
  const {
    sources,
    events,
    isLoadingEvents,
    eventsError,
    sourceErrors,
    lastSynced,
    calendarEnabled,
    refreshIntervalMinutes,
    selectedCalendarIds,
    showAllDayEvents,
    fetchEvents,
    checkPermission,
  } = useCalendarStore();

  const anyConnected = sources.some((s) => s.available && s.connected);
  const noConnectableSource = hasNoConnectableCalendarSource(sources);

  useEffect(() => {
    checkPermission();
  }, [checkPermission]);

  // Refetch when the date, the connected sources, the calendar selection, or
  // the all-day preference changes. Leaving the last two out meant ticking a
  // calendar in Settings did nothing visible until the next poll, up to the
  // full refresh interval away. Both re-reads usually hit the range cache, so
  // this is instant rather than another round trip.
  useEffect(() => {
    if (anyConnected && calendarEnabled) {
      fetchEvents(selectedDate);
    }
  }, [
    selectedDate,
    anyConnected,
    calendarEnabled,
    selectedCalendarIds,
    showAllDayEvents,
    fetchEvents,
  ]);

  // Poll while the app is open. EventKit is local and cheap, but Google is a
  // rate-limited remote API, so the interval is a user setting rather than a
  // constant.
  useEffect(() => {
    if (!anyConnected || !calendarEnabled) return;
    const id = window.setInterval(
      () => {
        void fetchEvents(selectedDate, undefined, { force: true });
      },
      refreshIntervalMinutes * 60 * 1000
    );
    return () => window.clearInterval(id);
  }, [anyConnected, calendarEnabled, refreshIntervalMinutes, selectedDate, fetchEvents]);

  if (noConnectableSource) {
    return <CalendarSyncComingSoon />;
  }

  if (!anyConnected) {
    return <ConnectCalendarPrompt />;
  }

  const handleRefresh = () => {
    fetchEvents(selectedDate, undefined, { force: true });
  };

  return (
    <section aria-label="Calendar events" className="flex min-w-0 flex-col">
      <div className="flex items-baseline justify-between gap-3 pb-2">
        <h3 className="text-[10px] uppercase" style={KICKER_STYLE}>
          Events
        </h3>
        {calendarEnabled && (
          <div className="flex items-baseline gap-3">
            {lastSynced && !isLoadingEvents && (
              <span className="text-[10px] uppercase" style={KICKER_STYLE}>
                Synced {format(lastSynced, 'HH:mm')}
              </span>
            )}
            <button
              onClick={handleRefresh}
              disabled={isLoadingEvents}
              className="focus-ring text-xs transition-colors disabled:opacity-50"
              style={{ color: 'var(--text-muted)', borderBottom: '1px solid currentColor' }}
              onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--text-primary)')}
              onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--text-muted)')}
              title={lastSynced ? `Last synced: ${format(lastSynced, 'HH:mm')}` : 'Refresh'}
              aria-label="Sync calendar events"
            >
              {isLoadingEvents ? 'Syncing…' : 'Sync'}
            </button>
          </div>
        )}
      </div>

      {/* One source failing must not hide the events that did load, so this is
          a notice above the list rather than a replacement for it. */}
      {calendarEnabled && sourceErrors.length > 0 && (
        <div className="pb-2 text-[10px]" style={{ color: 'var(--error)' }}>
          {sourceErrors.map((e) => (
            <div key={e.source}>
              {e.source === 'google' ? 'Google Calendar' : 'Apple Calendar'}: {e.message}
            </div>
          ))}
        </div>
      )}

      {!calendarEnabled ? (
        <p className="py-2 text-xs" style={{ color: 'var(--text-muted)' }}>
          Calendar sync is disabled.
        </p>
      ) : isLoadingEvents && events.length === 0 ? (
        <LoadingState />
      ) : eventsError ? (
        <ErrorState error={eventsError} onRetry={handleRefresh} />
      ) : (
        <DayEventList events={events} selectedDate={selectedDate} />
      )}
    </section>
  );
}

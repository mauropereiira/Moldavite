import { useEffect, useRef, useMemo } from 'react';
import { format, isToday } from 'date-fns';
import { hasNoConnectableCalendarSource, useCalendarStore } from '@/stores/calendarStore';
import { useNoteStore, useSettingsStore } from '@/stores';
import type { CalendarEvent } from '@/types';
import { open } from '@tauri-apps/plugin-shell';
import { EventBlock, AllDayEvent } from './EventBlock';
import { CurrentTimeLine, HOUR_HEIGHT } from './CurrentTimeLine';
import { NoEventsEmptyState, ConnectCalendarEmptyState } from '@/components/ui/EmptyState';
import { CalendarSyncComingSoon } from './CalendarSyncComingSoon';
import { eventsOverlappingLocalDay, localDayInterval, MILLISECONDS_PER_HOUR } from './timeLayout';

const TIME_COLUMN_WIDTH = 60; // pixels

// Helper to detect overlapping events and assign columns
interface EventWithColumn extends CalendarEvent {
  columnIndex: number;
  totalColumns: number;
}

function calculateEventColumns(events: CalendarEvent[]): EventWithColumn[] {
  if (events.length === 0) return [];

  // Sort events by start time, then by duration (longer events first)
  const sortedEvents = [...events].sort((a, b) => {
    const startDiff = new Date(a.start).getTime() - new Date(b.start).getTime();
    if (startDiff !== 0) return startDiff;
    // Longer events first
    const durationA = new Date(a.end).getTime() - new Date(a.start).getTime();
    const durationB = new Date(b.end).getTime() - new Date(b.start).getTime();
    return durationB - durationA;
  });

  const result: EventWithColumn[] = [];
  const columns: CalendarEvent[][] = [];

  for (const event of sortedEvents) {
    const eventStart = new Date(event.start).getTime();
    const eventEnd = new Date(event.end).getTime();

    // Find the first column where this event doesn't overlap
    let columnIndex = 0;
    let placed = false;

    for (let i = 0; i < columns.length; i++) {
      const column = columns[i];
      const canPlace = column.every((existing) => {
        const existingStart = new Date(existing.start).getTime();
        const existingEnd = new Date(existing.end).getTime();
        // No overlap if event ends before existing starts or event starts after existing ends
        return eventEnd <= existingStart || eventStart >= existingEnd;
      });

      if (canPlace) {
        column.push(event);
        columnIndex = i;
        placed = true;
        break;
      }
    }

    if (!placed) {
      // Create new column
      columns.push([event]);
      columnIndex = columns.length - 1;
    }

    result.push({ ...event, columnIndex, totalColumns: 0 });
  }

  // Calculate total columns for each event group
  // Events that overlap need to know how many columns are in their group
  for (const event of result) {
    const eventStart = new Date(event.start).getTime();
    const eventEnd = new Date(event.end).getTime();

    // Find all overlapping events
    const overlapping = result.filter((other) => {
      const otherStart = new Date(other.start).getTime();
      const otherEnd = new Date(other.end).getTime();
      return !(eventEnd <= otherStart || eventStart >= otherEnd);
    });

    // Find max column index among overlapping events
    const maxColumn = Math.max(...overlapping.map((e) => e.columnIndex));
    event.totalColumns = maxColumn + 1;
  }

  // Update all overlapping events to have the same totalColumns
  for (const event of result) {
    const eventStart = new Date(event.start).getTime();
    const eventEnd = new Date(event.end).getTime();

    const overlapping = result.filter((other) => {
      const otherStart = new Date(other.start).getTime();
      const otherEnd = new Date(other.end).getTime();
      return !(eventEnd <= otherStart || eventStart >= otherEnd);
    });

    const maxTotalColumns = Math.max(...overlapping.map((e) => e.totalColumns));
    overlapping.forEach((e) => {
      e.totalColumns = maxTotalColumns;
    });
  }

  return result;
}

// Loading state component
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

// Error state component
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

// Permission denied state
function PermissionDeniedState() {
  const handleOpenSettings = async () => {
    try {
      // Open macOS System Settings to Calendar privacy pane
      await open('x-apple.systempreferences:com.apple.preference.security?Privacy_Calendars');
    } catch (error) {
      console.error('[Timeline] Failed to open System Settings:', error);
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
        To see your events, grant calendar access in System Settings
      </p>
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
    </div>
  );
}

// Connect prompt for the no-source-connected state
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
      label: isConnectingGoogle ? 'Waiting for your browser…' : 'Connect Google Calendar',
      onClick: () => void connectGoogle(),
      variant: actions.length === 0 ? 'primary' : 'secondary',
    });
  }

  // Apple denied at the OS level and nothing else to offer: the only way out is
  // System Settings, so keep the dedicated instructions for that case.
  if (actions.length === 0 && appleBlocked) {
    return <PermissionDeniedState />;
  }

  // Nothing connectable from here — a build with no EventKit and no Google
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
          Apple Calendar access was denied in System Settings.
        </p>
      )}
    </div>
  );
}

// Time grid component
interface TimeGridProps {
  events: CalendarEvent[];
  selectedDate: Date;
}

function TimeGrid({ events, selectedDate }: TimeGridProps) {
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const isTodaySelected = isToday(selectedDate);
  const day = useMemo(() => localDayInterval(selectedDate), [selectedDate]);
  const dayEvents = useMemo(
    () => eventsOverlappingLocalDay(events, selectedDate),
    [events, selectedDate]
  );
  const hourRows = useMemo(
    () =>
      Array.from({ length: Math.ceil(day.elapsedHours) }, (_, index) => ({
        instant: new Date(day.start.getTime() + index * MILLISECONDS_PER_HOUR),
        top: index * HOUR_HEIGHT,
        height: Math.min(HOUR_HEIGHT, (day.elapsedHours - index) * HOUR_HEIGHT),
      })),
    [day]
  );

  // Separate all-day and timed events
  const allDayEvents = dayEvents.filter((e) => e.isAllDay);
  const timedEvents = dayEvents.filter((e) => !e.isAllDay);

  // Calculate columns for overlapping events
  const eventsWithColumns = useMemo(() => calculateEventColumns(timedEvents), [timedEvents]);

  // Scroll to current time on mount if viewing today
  useEffect(() => {
    if (isTodaySelected && scrollContainerRef.current) {
      const now = new Date();
      const elapsedHours = (now.getTime() - day.start.getTime()) / MILLISECONDS_PER_HOUR;
      const scrollPosition = Math.max(0, (elapsedHours - 1) * HOUR_HEIGHT);
      scrollContainerRef.current.scrollTop = scrollPosition;
    }
  }, [day, isTodaySelected]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* All-day events section */}
      {allDayEvents.length > 0 && (
        <section
          aria-label="All-day events"
          className="flex-shrink-0 px-3 py-2"
          style={{
            maxHeight: '35%',
            overflowY: 'auto',
            borderBottom: '1px solid var(--border-strong)',
          }}
        >
          <div
            className="mb-1 text-[10px] uppercase"
            style={{ color: 'var(--text-muted)', letterSpacing: '0.14em' }}
          >
            All Day
          </div>
          {allDayEvents.map((event, index) => (
            <AllDayEvent key={event.id} event={event} index={index} />
          ))}
        </section>
      )}

      {/* Scrollable time grid */}
      <div
        ref={scrollContainerRef}
        role="region"
        aria-label="Hourly timeline"
        className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden"
        style={{ minHeight: '50%' }}
      >
        <div className="relative" style={{ height: `${day.elapsedHours * HOUR_HEIGHT}px` }}>
          {/* Hour rows */}
          {hourRows.map((row, index) => (
            <div
              key={row.instant.getTime()}
              className="absolute left-0 right-0"
              style={{
                top: `${row.top}px`,
                height: `${row.height}px`,
                borderBottom: '1px solid var(--border-muted)',
              }}
            >
              {/* Time label */}
              <div
                className="absolute top-0 text-[11px] text-right pr-2"
                style={{
                  width: `${TIME_COLUMN_WIDTH}px`,
                  transform: 'translateY(-50%)',
                  color: 'var(--text-muted)',
                }}
              >
                {index === 0 ? '' : format(row.instant, 'HH:mm')}
              </div>

              {/* Half-hour dashed line */}
              <div
                className="absolute left-0 right-0 border-b border-dashed"
                style={{
                  top: `${HOUR_HEIGHT / 2}px`,
                  left: `${TIME_COLUMN_WIDTH}px`,
                  borderColor: 'var(--border-muted)',
                }}
              />
            </div>
          ))}

          {/* Current time indicator */}
          <CurrentTimeLine isToday={isTodaySelected} dayStart={day.start} />

          {/* Event blocks */}
          {eventsWithColumns.map((event, index) => (
            <EventBlock
              key={event.id}
              event={event}
              columnIndex={event.columnIndex}
              totalColumns={event.totalColumns}
              index={index}
              dayStart={day.start}
              dayEnd={day.end}
            />
          ))}

          {/* Empty state message (show even when no events) */}
          {timedEvents.length === 0 && allDayEvents.length === 0 && (
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <NoEventsEmptyState />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// Main Timeline component
export function Timeline() {
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

  // Check source state on mount
  useEffect(() => {
    checkPermission();
  }, [checkPermission]);

  // Refetch when the date, the connected sources, the calendar selection, or
  // the all-day preference changes. Leaving the last two out meant ticking a
  // calendar in Settings did nothing visible until the next poll — up to the
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

  // A source exists but nothing is connected - show the existing connect prompt.
  if (!anyConnected) {
    return <ConnectCalendarPrompt />;
  }

  // Calendar disabled
  if (!calendarEnabled) {
    return (
      <div className="flex-1 p-4">
        <h3 className="text-sm font-medium mb-3" style={{ color: 'var(--text-muted)' }}>
          Calendar
        </h3>
        <p className="text-sm italic" style={{ color: 'var(--text-muted)' }}>
          Calendar sync is disabled
        </p>
      </div>
    );
  }

  const handleRefresh = () => {
    fetchEvents(selectedDate, undefined, { force: true });
  };

  // Format the header date
  const headerDate = isToday(selectedDate) ? 'Today' : format(selectedDate, 'EEE, MMM d');

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      {/* Header */}
      <div
        className="flex items-center justify-between px-4 py-3"
        style={{ borderBottom: '1px solid var(--border-muted)' }}
      >
        <div>
          <h3
            style={{
              color: 'var(--text-primary)',
              fontFamily: 'var(--font-display)',
              fontSize: '15px',
              fontWeight: 400,
              letterSpacing: 0,
            }}
          >
            {headerDate}
          </h3>
          {lastSynced && !isLoadingEvents && (
            <div
              className="text-[10px] uppercase"
              style={{ color: 'var(--text-muted)', letterSpacing: '0.14em' }}
            >
              Synced {format(lastSynced, 'h:mm a')}
            </div>
          )}
        </div>
        <button
          onClick={handleRefresh}
          disabled={isLoadingEvents}
          className="focus-ring text-xs transition-colors disabled:opacity-50"
          style={{ color: 'var(--text-muted)', borderBottom: '1px solid currentColor' }}
          onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--text-primary)')}
          onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--text-muted)')}
          title={lastSynced ? `Last synced: ${format(lastSynced, 'h:mm a')}` : 'Refresh'}
          aria-label="Sync calendar events"
        >
          {isLoadingEvents ? 'Syncing…' : 'Sync'}
        </button>
      </div>

      {/* One source failing must not hide the events that did load, so this is
          a notice above the grid rather than a replacement for it. */}
      {sourceErrors.length > 0 && (
        <div
          className="px-3 py-1.5 text-[10px]"
          style={{ color: 'var(--error)', borderBottom: '1px solid var(--border-default)' }}
        >
          {sourceErrors.map((e) => (
            <div key={e.source}>
              {e.source === 'google' ? 'Google Calendar' : 'Apple Calendar'}: {e.message}
            </div>
          ))}
        </div>
      )}

      {/* Content */}
      {isLoadingEvents && events.length === 0 ? (
        <LoadingState />
      ) : eventsError ? (
        <ErrorState error={eventsError} onRetry={handleRefresh} />
      ) : (
        <TimeGrid events={events} selectedDate={selectedDate} />
      )}
    </div>
  );
}

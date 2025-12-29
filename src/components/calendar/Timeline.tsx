import { useEffect, useRef, useMemo } from 'react';
import { format, isToday } from 'date-fns';
import { useCalendarStore } from '@/stores/calendarStore';
import { useNoteStore } from '@/stores';
import type { CalendarEvent } from '@/types';
import {
  Clock,
  RefreshCw,
  AlertCircle,
  Lock,
  ExternalLink,
} from 'lucide-react';
import { open } from '@tauri-apps/plugin-shell';
import { EventBlock, AllDayEvent } from './EventBlock';
import { CurrentTimeLine, HOUR_HEIGHT } from './CurrentTimeLine';
import { NoEventsEmptyState, ConnectCalendarEmptyState } from '@/components/ui/EmptyState';

// Time grid hours (0-23)
const HOURS = Array.from({ length: 24 }, (_, i) => i);
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
    const startDiff = a.start.localeCompare(b.start);
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
      const canPlace = column.every(existing => {
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
    const overlapping = result.filter(other => {
      const otherStart = new Date(other.start).getTime();
      const otherEnd = new Date(other.end).getTime();
      return !(eventEnd <= otherStart || eventStart >= otherEnd);
    });

    // Find max column index among overlapping events
    const maxColumn = Math.max(...overlapping.map(e => e.columnIndex));
    event.totalColumns = maxColumn + 1;
  }

  // Update all overlapping events to have the same totalColumns
  for (const event of result) {
    const eventStart = new Date(event.start).getTime();
    const eventEnd = new Date(event.end).getTime();

    const overlapping = result.filter(other => {
      const otherStart = new Date(other.start).getTime();
      const otherEnd = new Date(other.end).getTime();
      return !(eventEnd <= otherStart || eventStart >= otherEnd);
    });

    const maxTotalColumns = Math.max(...overlapping.map(e => e.totalColumns));
    overlapping.forEach(e => {
      e.totalColumns = maxTotalColumns;
    });
  }

  return result;
}

// Loading state component
function LoadingState() {
  return (
    <div className="flex flex-col gap-2 p-4">
      {[1, 2, 3].map((i) => (
        <div key={i} className="animate-pulse">
          <div className="flex items-start gap-2 p-2">
            <div
              className="w-2 h-2 rounded-full mt-1"
              style={{ backgroundColor: 'var(--border-default)' }}
            />
            <div className="flex-1">
              <div
                className="h-3 rounded w-16 mb-1"
                style={{ backgroundColor: 'var(--border-default)' }}
              />
              <div
                className="h-4 rounded w-3/4"
                style={{ backgroundColor: 'var(--border-default)' }}
              />
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
      <AlertCircle className="w-8 h-8 mb-2" style={{ color: 'var(--error)' }} />
      <p className="text-sm mb-2" style={{ color: 'var(--error)' }}>
        {error}
      </p>
      <button
        onClick={onRetry}
        className="text-xs flex items-center gap-1 transition-colors"
        style={{ color: 'var(--accent-primary)' }}
        onMouseEnter={(e) => e.currentTarget.style.opacity = '0.8'}
        onMouseLeave={(e) => e.currentTarget.style.opacity = '1'}
      >
        <RefreshCw className="w-3 h-3" />
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
      <Lock className="w-10 h-10 mb-3" style={{ color: 'var(--text-muted)' }} />
      <h3 className="text-sm font-medium mb-1" style={{ color: 'var(--text-primary)' }}>
        Calendar Access Denied
      </h3>
      <p className="text-xs mb-3" style={{ color: 'var(--text-muted)' }}>
        To see your events, grant calendar access in System Settings
      </p>
      <button
        onClick={handleOpenSettings}
        className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium transition-colors"
        style={{
          color: 'var(--accent-primary)',
          backgroundColor: 'var(--accent-subtle)',
          borderRadius: 'var(--radius-md)',
        }}
        onMouseEnter={(e) => e.currentTarget.style.opacity = '0.8'}
        onMouseLeave={(e) => e.currentTarget.style.opacity = '1'}
      >
        <ExternalLink className="w-3 h-3" />
        Open Settings
      </button>
    </div>
  );
}

// Connect prompt for unauthenticated state
export function ConnectCalendarPrompt() {
  const { requestPermission, isRequestingPermission, permissionStatus } = useCalendarStore();

  const handleEnableAccess = async () => {
    await requestPermission();
  };

  // Show denied state if permission was denied
  if (permissionStatus === 'Denied' || permissionStatus === 'Restricted') {
    return <PermissionDeniedState />;
  }

  return (
    <div className="flex-1 flex flex-col items-center justify-center p-2">
      <ConnectCalendarEmptyState
        onConnect={handleEnableAccess}
        isConnecting={isRequestingPermission}
      />
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

  // Separate all-day and timed events
  const allDayEvents = events.filter(e => e.isAllDay);
  const timedEvents = events.filter(e => !e.isAllDay);

  // Calculate columns for overlapping events
  const eventsWithColumns = useMemo(
    () => calculateEventColumns(timedEvents),
    [timedEvents]
  );

  // Scroll to current time on mount if viewing today
  useEffect(() => {
    if (isTodaySelected && scrollContainerRef.current) {
      const now = new Date();
      const currentHour = now.getHours();
      const scrollPosition = Math.max(0, (currentHour - 1) * HOUR_HEIGHT);
      scrollContainerRef.current.scrollTop = scrollPosition;
    }
  }, [isTodaySelected]);

  return (
    <div className="flex flex-col h-full">
      {/* All-day events section */}
      {allDayEvents.length > 0 && (
        <div className="p-2 space-y-1" style={{ borderBottom: '1px solid var(--border-default)' }}>
          <div
            className="text-[10px] uppercase font-medium mb-1"
            style={{ color: 'var(--text-muted)' }}
          >
            All Day
          </div>
          {allDayEvents.map(event => (
            <AllDayEvent key={event.id} event={event} />
          ))}
        </div>
      )}

      {/* Scrollable time grid */}
      <div
        ref={scrollContainerRef}
        className="flex-1 overflow-y-auto overflow-x-hidden"
      >
        <div
          className="relative"
          style={{ height: `${24 * HOUR_HEIGHT}px` }}
        >
          {/* Hour rows */}
          {HOURS.map(hour => (
            <div
              key={hour}
              className="absolute left-0 right-0"
              style={{
                top: `${hour * HOUR_HEIGHT}px`,
                height: `${HOUR_HEIGHT}px`,
                borderBottom: '1px solid var(--border-default)',
              }}
            >
              {/* Time label */}
              <div
                className="absolute top-0 text-[11px] text-right pr-2"
                style={{
                  width: `${TIME_COLUMN_WIDTH}px`,
                  transform: 'translateY(-50%)',
                  color: 'var(--text-tertiary)',
                }}
              >
                {hour === 0 ? '' : format(new Date().setHours(hour, 0), 'HH:mm')}
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
          <CurrentTimeLine isToday={isTodaySelected} />

          {/* Event blocks */}
          {eventsWithColumns.map(event => (
            <EventBlock
              key={event.id}
              event={event}
              columnIndex={event.columnIndex}
              totalColumns={event.totalColumns}
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
  const { selectedDate } = useNoteStore();
  const {
    isAuthorized,
    events,
    isLoadingEvents,
    eventsError,
    lastSynced,
    calendarEnabled,
    fetchEvents,
    checkPermission,
  } = useCalendarStore();

  // Check permission status on mount
  useEffect(() => {
    checkPermission();
  }, [checkPermission]);

  // Fetch events when date changes
  useEffect(() => {
    if (isAuthorized && calendarEnabled) {
      fetchEvents(selectedDate);
    }
  }, [selectedDate, isAuthorized, calendarEnabled, fetchEvents]);

  // Not authorized - show connect prompt
  if (!isAuthorized) {
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
    fetchEvents(selectedDate);
  };

  // Format the header date
  const headerDate = isToday(selectedDate)
    ? 'Today'
    : format(selectedDate, 'EEE, MMM d');

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Header */}
      <div
        className="flex items-center justify-between p-3"
        style={{ borderBottom: '1px solid var(--border-default)' }}
      >
        <div>
          <h3 className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
            {headerDate}
          </h3>
          {lastSynced && !isLoadingEvents && (
            <div className="flex items-center gap-1 text-[10px]" style={{ color: 'var(--text-muted)' }}>
              <Clock className="w-2.5 h-2.5" />
              <span>Synced {format(lastSynced, 'h:mm a')}</span>
            </div>
          )}
        </div>
        <button
          onClick={handleRefresh}
          disabled={isLoadingEvents}
          className="p-1.5 transition-colors"
          style={{ borderRadius: 'var(--radius-sm)', color: 'var(--text-muted)' }}
          onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'var(--hover-overlay)'}
          onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
          title={lastSynced ? `Last synced: ${format(lastSynced, 'h:mm a')}` : 'Refresh'}
        >
          <RefreshCw
            className={`w-3.5 h-3.5 ${isLoadingEvents ? 'animate-spin' : ''}`}
          />
        </button>
      </div>

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

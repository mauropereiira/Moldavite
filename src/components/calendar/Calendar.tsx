import React from 'react';
import {
  format,
  startOfMonth,
  endOfMonth,
  startOfWeek,
  endOfWeek,
  eachDayOfInterval,
  isSameMonth,
  isSameDay,
  addMonths,
  subMonths,
  getISOWeek,
  getISOWeekYear,
  startOfISOWeek,
  startOfDay,
  addDays,
  parseISO,
} from 'date-fns';
import { fetchCalendarEvents } from '@/lib/calendar';
import { useCalendarStore, useNoteStore, useTaskStatusStore } from '@/stores';
import { useNotes } from '@/hooks';
import type { CalendarEvent } from '@/types';

interface CalendarProps {
  onNavigate?: () => void;
}

/**
 * What a dot under a date means. One per *kind*, never one per event: counting
 * events made a day with six back-to-back meetings and a day with one long one
 * look equally busy while saying nothing about what was actually on it.
 *
 * Shared with the legend below the grid, so the two can never drift — a
 * colour-coded grid with no key is decoration, and a key that disagrees with
 * the grid is worse than none.
 */
const DAY_MARKS = [
  { kind: 'tasks', label: 'To-do', color: 'var(--warning)' },
  { kind: 'events', label: 'Events', color: 'var(--accent)' },
  { kind: 'note', label: 'Note', color: 'var(--text-secondary)' },
] as const;

export function Calendar({ onNavigate }: CalendarProps = {}) {
  // Narrow selectors: none of these change on a content-only edit, unlike
  // `currentNote` (not read here), so the calendar does not re-render while typing.
  const selectedDate = useNoteStore((state) => state.selectedDate);
  const setSelectedDate = useNoteStore((state) => state.setSelectedDate);
  const selectedWeek = useNoteStore((state) => state.selectedWeek);
  const setSelectedWeek = useNoteStore((state) => state.setSelectedWeek);
  const notes = useNoteStore((state) => state.notes);
  const taskStatusByDate = useTaskStatusStore((state) => state.taskStatusByDate);
  const {
    sources,
    calendarEnabled,
    selectedCalendarIds,
    legacySelectedAppleCalendarId,
    showAllDayEvents,
    checkPermission,
  } = useCalendarStore();
  const { loadDailyNote, loadWeeklyNote } = useNotes();
  const [viewDate, setViewDate] = React.useState(selectedDate);
  const [monthEvents, setMonthEvents] = React.useState<CalendarEvent[]>([]);

  // Get all days to display in the calendar grid
  const monthStart = startOfMonth(viewDate);
  const monthEnd = endOfMonth(viewDate);
  const calendarStart = startOfWeek(monthStart);
  const calendarEnd = endOfWeek(monthEnd);
  const days = eachDayOfInterval({ start: calendarStart, end: calendarEnd });
  const calendarStartKey = format(calendarStart, 'yyyy-MM-dd');
  const calendarEndKey = format(calendarEnd, 'yyyy-MM-dd');
  const anyConnected = sources.some((source) => source.available && source.connected);

  React.useEffect(() => {
    void checkPermission();
  }, [checkPermission]);

  // The timeline owns a selected-day event range in the shared store. Fetch
  // the visible six-week range locally so month indicators cannot overwrite it.
  React.useEffect(() => {
    let cancelled = false;

    if (!calendarEnabled || !anyConnected || legacySelectedAppleCalendarId) {
      setMonthEvents([]);
      return () => {
        cancelled = true;
      };
    }

    void fetchCalendarEvents(calendarStartKey, calendarEndKey, selectedCalendarIds)
      .then((result) => {
        if (!cancelled) {
          setMonthEvents(
            showAllDayEvents ? result.events : result.events.filter((event) => !event.isAllDay)
          );
        }
      })
      .catch(() => {
        if (!cancelled) setMonthEvents([]);
      });

    return () => {
      cancelled = true;
    };
  }, [
    anyConnected,
    calendarEnabled,
    calendarEndKey,
    calendarStartKey,
    legacySelectedAppleCalendarId,
    selectedCalendarIds,
    showAllDayEvents,
  ]);

  // Group days into weeks (7 days per row)
  const weeks: Date[][] = [];
  for (let i = 0; i < days.length; i += 7) {
    weeks.push(days.slice(i, i + 7));
  }

  // Check if a day has a note
  const hasNote = (date: Date): boolean => {
    const dateStr = format(date, 'yyyy-MM-dd');
    return notes.some((n) => n.isDaily && n.date === dateStr);
  };

  // Check if a week has a note
  const hasWeeklyNote = (date: Date): boolean => {
    const weekYear = getISOWeekYear(date);
    const weekNum = getISOWeek(date);
    const weekStr = `${weekYear}-W${weekNum.toString().padStart(2, '0')}`;
    return notes.some((n) => n.isWeekly && n.week === weekStr);
  };

  // Count overlapping events rather than starts, so an event crossing midnight
  // marks both days. All-day event end dates are exclusive and work naturally.
  const eventCount = (date: Date): number => {
    const dayStart = startOfDay(date).getTime();
    const dayEnd = addDays(startOfDay(date), 1).getTime();
    let count = 0;

    for (const event of monthEvents) {
      const eventStart = parseISO(event.start).getTime();
      const eventEnd = parseISO(event.end).getTime();
      if (
        Number.isFinite(eventStart) &&
        Number.isFinite(eventEnd) &&
        eventStart < dayEnd &&
        eventEnd > dayStart
      ) {
        count += 1;
        if (count === 3) break;
      }
    }

    return count;
  };

  // Check if a week is selected
  const isWeekSelected = (date: Date): boolean => {
    if (!selectedWeek) return false;
    return (
      getISOWeek(date) === getISOWeek(selectedWeek) &&
      getISOWeekYear(date) === getISOWeekYear(selectedWeek)
    );
  };

  const handleDayClick = (date: Date) => {
    setSelectedDate(date);
    setSelectedWeek(null); // Clear week selection when selecting a day
    loadDailyNote(date);
    onNavigate?.();
  };

  const handleWeekClick = (date: Date) => {
    const weekStart = startOfISOWeek(date);
    setSelectedWeek(weekStart);
    loadWeeklyNote(date);
    onNavigate?.();
  };

  const handlePrevMonth = () => {
    setViewDate(subMonths(viewDate, 1));
  };

  const handleNextMonth = () => {
    setViewDate(addMonths(viewDate, 1));
  };

  return (
    <div className="select-none min-w-0 w-full">
      {/* Header */}
      <div className="flex items-center justify-between mb-4 min-w-0 gap-3">
        <button
          onClick={handlePrevMonth}
          aria-label="Previous month"
          className="focus-ring flex-shrink-0 px-1 text-base leading-none transition-colors"
          style={{ color: 'var(--text-muted)' }}
          onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--text-primary)')}
          onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--text-muted)')}
        >
          <span aria-hidden="true">←</span>
        </button>
        <span
          className="truncate min-w-0 text-center"
          style={{
            color: 'var(--text-primary)',
            fontFamily: 'var(--font-display)',
            fontSize: '18px',
            fontWeight: 400,
            letterSpacing: '-0.015em',
          }}
        >
          {format(viewDate, 'MMMM yyyy')}
        </span>
        <button
          onClick={handleNextMonth}
          aria-label="Next month"
          className="focus-ring flex-shrink-0 px-1 text-base leading-none transition-colors"
          style={{ color: 'var(--text-muted)' }}
          onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--text-primary)')}
          onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--text-muted)')}
        >
          <span aria-hidden="true">→</span>
        </button>
      </div>

      {/* Day headers with week column */}
      <div
        className="grid pb-2 mb-1"
        style={{
          borderBottom: '1px solid var(--border-muted)',
          gridTemplateColumns: '20px repeat(7, minmax(0, 1fr))',
        }}
      >
        {/* Week header */}
        <div
          className="text-center uppercase"
          style={{ color: 'var(--text-muted)', fontSize: '10px', letterSpacing: '0.14em' }}
          title="Week number"
        >
          W
        </div>
        {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((day, index) => (
          <div
            key={`${day}-${index}`}
            className="text-center uppercase"
            style={{ color: 'var(--text-muted)', fontSize: '10px', letterSpacing: '0.14em' }}
          >
            {day}
          </div>
        ))}
      </div>

      {/* Days grid with week numbers */}
      <div key={format(viewDate, 'yyyy-MM')} className="calendar-month-enter flex flex-col">
        {weeks.map((week, weekIndex) => {
          const weekNum = getISOWeek(week[0]);
          const weekHasNote = hasWeeklyNote(week[0]);
          const weekSelected = isWeekSelected(week[0]);

          return (
            <div
              key={weekIndex}
              className="grid"
              style={{ gridTemplateColumns: '20px repeat(7, minmax(0, 1fr))' }}
            >
              {/* Week number */}
              <button
                onClick={() => handleWeekClick(week[0])}
                className="calendar-date list-item-stagger focus-ring flex h-8 items-center justify-center transition-colors"
                style={
                  {
                    color:
                      weekSelected || weekHasNote ? 'var(--text-primary)' : 'var(--text-muted)',
                    fontWeight: weekSelected ? 600 : 400,
                    fontSize: '10px',
                    '--index': Math.min(weekIndex * 8, 10),
                  } as React.CSSProperties
                }
                title={`Week ${weekNum} - Click to open weekly note`}
              >
                <span style={{ borderBottom: weekSelected ? '2px solid currentColor' : 'none' }}>
                  {weekNum}
                </span>
              </button>

              {/* Days */}
              {week.map((day, dayIndex) => {
                const isCurrentMonth = isSameMonth(day, viewDate);
                const isSelected = isSameDay(day, selectedDate) && !selectedWeek;
                const isToday = isSameDay(day, new Date());
                const dayHasNote = hasNote(day);
                const dayEventCount = eventCount(day);
                const dayKey = format(day, 'yyyy-MM-dd');
                const taskStatus = taskStatusByDate.get(dayKey);
                const hasOpenTasks = Boolean(
                  taskStatus && taskStatus.totalTasks > taskStatus.completedTasks
                );
                const dayMarks = DAY_MARKS.filter(({ kind }) =>
                  kind === 'tasks'
                    ? hasOpenTasks
                    : kind === 'events'
                      ? dayEventCount > 0
                      : dayHasNote
                );

                return (
                  <button
                    key={day.toISOString()}
                    data-date={format(day, 'yyyy-MM-dd')}
                    onClick={() => handleDayClick(day)}
                    className="calendar-date list-item-stagger focus-ring flex h-8 items-center justify-center text-xs transition-colors"
                    style={
                      {
                        // Today is the one date you look for, and a 1px rule
                        // under a number in a grid of numbers is not enough to
                        // find at a glance — especially beside the 2px rule
                        // that marks the selection.
                        color: isToday
                          ? 'var(--accent)'
                          : isCurrentMonth
                            ? dayHasNote
                              ? 'var(--text-primary)'
                              : 'var(--text-secondary)'
                            : 'var(--text-muted)',
                        fontWeight: isToday || dayHasNote ? 500 : 400,
                        '--index': Math.min(weekIndex * 8 + dayIndex + 1, 10),
                      } as React.CSSProperties
                    }
                  >
                    <span
                      style={{
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                      }}
                    >
                      <span
                        style={{
                          boxSizing: 'border-box',
                          height: '16px',
                          borderBottom: isSelected
                            ? '2px solid currentColor'
                            : isToday
                              ? '1px solid currentColor'
                              : '2px solid transparent',
                          lineHeight: 1.35,
                        }}
                      >
                        {format(day, 'd')}
                      </span>
                      {/* One dot per *kind* of thing on that day rather than
                          one per event. Counting events made a busy day and a
                          day with a single long meeting look equally noisy
                          while telling you nothing about what was on it. The
                          legend beneath the grid names the colours; without it
                          this is decoration. */}
                      <svg
                        aria-hidden="true"
                        data-event-count={dayEventCount}
                        width="10"
                        height="2"
                        viewBox="0 0 10 2"
                        style={{
                          display: 'block',
                          marginTop: '2px',
                          opacity: isCurrentMonth ? 1 : 0.55,
                        }}
                      >
                        {dayMarks.map((mark, markIndex) => (
                          <circle
                            key={mark.kind}
                            cx={5 - ((dayMarks.length - 1) * 3) / 2 + markIndex * 3}
                            cy="1"
                            r="1"
                            fill={mark.color}
                          />
                        ))}
                      </svg>
                    </span>
                  </button>
                );
              })}
            </div>
          );
        })}
      </div>

      {/* Without this the colours are decoration. Kept to the same quiet
          register as the rest of the chrome — it should be readable when you
          look for it and invisible when you are not. */}
      <div className="calendar-legend" aria-label="What the marks under each date mean">
        {DAY_MARKS.map(({ kind, label, color }) => (
          <span key={kind} className="calendar-legend-item">
            <svg width="6" height="6" viewBox="0 0 6 6" aria-hidden="true">
              <circle cx="3" cy="3" r="3" fill={color} />
            </svg>
            {label}
          </span>
        ))}
      </div>
    </div>
  );
}

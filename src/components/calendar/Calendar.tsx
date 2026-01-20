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
} from 'date-fns';
import { useNoteStore, useTaskStatusStore } from '@/stores';
import { useNotes } from '@/hooks';

export function Calendar() {
  const { selectedDate, setSelectedDate, selectedWeek, setSelectedWeek, notes } = useNoteStore();
  const { loadDailyNote, loadWeeklyNote } = useNotes();
  const [viewDate, setViewDate] = React.useState(selectedDate);

  // Get all days to display in the calendar grid
  const monthStart = startOfMonth(viewDate);
  const monthEnd = endOfMonth(viewDate);
  const calendarStart = startOfWeek(monthStart);
  const calendarEnd = endOfWeek(monthEnd);
  const days = eachDayOfInterval({ start: calendarStart, end: calendarEnd });

  // Group days into weeks (7 days per row)
  const weeks: Date[][] = [];
  for (let i = 0; i < days.length; i += 7) {
    weeks.push(days.slice(i, i + 7));
  }

  // Check if a day has a note
  const hasNote = (date: Date): boolean => {
    const dateStr = format(date, 'yyyy-MM-dd');
    return notes.some(n => n.isDaily && n.date === dateStr);
  };

  // Check if a week has a note
  const hasWeeklyNote = (date: Date): boolean => {
    const weekYear = getISOWeekYear(date);
    const weekNum = getISOWeek(date);
    const weekStr = `${weekYear}-W${weekNum.toString().padStart(2, '0')}`;
    return notes.some(n => n.isWeekly && n.week === weekStr);
  };

  // Check if a day has incomplete tasks
  const { hasIncompleteTasks } = useTaskStatusStore();
  const dayHasIncompleteTasks = (date: Date): boolean => {
    const dateStr = format(date, 'yyyy-MM-dd');
    return hasIncompleteTasks(dateStr);
  };

  // Check if a week is selected
  const isWeekSelected = (date: Date): boolean => {
    if (!selectedWeek) return false;
    return getISOWeek(date) === getISOWeek(selectedWeek) &&
           getISOWeekYear(date) === getISOWeekYear(selectedWeek);
  };

  const handleDayClick = (date: Date) => {
    setSelectedDate(date);
    setSelectedWeek(null); // Clear week selection when selecting a day
    loadDailyNote(date);
  };

  const handleWeekClick = (date: Date) => {
    const weekStart = startOfISOWeek(date);
    setSelectedWeek(weekStart);
    loadWeeklyNote(date);
  };

  const handlePrevMonth = () => {
    setViewDate(subMonths(viewDate, 1));
  };

  const handleNextMonth = () => {
    setViewDate(addMonths(viewDate, 1));
  };

  return (
    <div className="select-none">
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <button
          onClick={handlePrevMonth}
          className="p-1 transition-colors"
          style={{ borderRadius: 'var(--radius-sm)', color: 'var(--text-secondary)' }}
          onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'var(--hover-overlay)'}
          onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <span className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
          {format(viewDate, 'MMMM yyyy')}
        </span>
        <button
          onClick={handleNextMonth}
          className="p-1 transition-colors"
          style={{ borderRadius: 'var(--radius-sm)', color: 'var(--text-secondary)' }}
          onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'var(--hover-overlay)'}
          onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
        </button>
      </div>

      {/* Day headers with week column */}
      <div className="grid gap-0.5 mb-1" style={{ gridTemplateColumns: '24px repeat(7, 1fr)' }}>
        {/* Week header */}
        <div
          className="text-center text-xs font-medium py-1"
          style={{ color: 'var(--text-muted)' }}
          title="Week number"
        >
          Wk
        </div>
        {['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'].map(day => (
          <div
            key={day}
            className="text-center text-xs font-medium py-1"
            style={{ color: 'var(--text-muted)' }}
          >
            {day}
          </div>
        ))}
      </div>

      {/* Days grid with week numbers */}
      <div className="flex flex-col gap-0.5">
        {weeks.map((week, weekIndex) => {
          const weekNum = getISOWeek(week[0]);
          const weekHasNote = hasWeeklyNote(week[0]);
          const weekSelected = isWeekSelected(week[0]);

          return (
            <div
              key={weekIndex}
              className="grid gap-0.5"
              style={{ gridTemplateColumns: '24px repeat(7, 1fr)' }}
            >
              {/* Week number */}
              <button
                onClick={() => handleWeekClick(week[0])}
                className="flex items-center justify-center text-xs relative transition-colors"
                style={{
                  borderRadius: 'var(--radius-sm)',
                  color: weekSelected
                    ? 'white'
                    : 'var(--text-muted)',
                  backgroundColor: weekSelected ? 'var(--accent-secondary, var(--accent-primary))' : 'transparent',
                  fontWeight: weekSelected ? 600 : 400,
                  fontSize: '10px',
                }}
                onMouseEnter={(e) => {
                  if (!weekSelected) e.currentTarget.style.backgroundColor = 'var(--hover-overlay)';
                }}
                onMouseLeave={(e) => {
                  if (!weekSelected) e.currentTarget.style.backgroundColor = 'transparent';
                }}
                title={`Week ${weekNum} - Click to open weekly note`}
              >
                {weekNum}
                {weekHasNote && !weekSelected && (
                  <span
                    className="absolute bottom-0.5 w-1 h-1 rounded-full"
                    style={{ backgroundColor: 'var(--accent-primary)' }}
                  />
                )}
              </button>

              {/* Days */}
              {week.map(day => {
                const isCurrentMonth = isSameMonth(day, viewDate);
                const isSelected = isSameDay(day, selectedDate) && !selectedWeek;
                const isToday = isSameDay(day, new Date());
                const dayHasNote = hasNote(day);

                return (
                  <button
                    key={day.toISOString()}
                    onClick={() => handleDayClick(day)}
                    className="aspect-square flex items-center justify-center text-xs relative transition-colors"
                    style={{
                      borderRadius: 'var(--radius-sm)',
                      color: isSelected
                        ? 'white'
                        : isToday
                          ? 'var(--accent-primary)'
                          : isCurrentMonth
                            ? 'var(--text-primary)'
                            : 'var(--text-muted)',
                      backgroundColor: isSelected ? 'var(--accent-primary)' : 'transparent',
                      fontWeight: isToday && !isSelected ? 600 : 400,
                    }}
                    onMouseEnter={(e) => {
                      if (!isSelected) e.currentTarget.style.backgroundColor = 'var(--hover-overlay)';
                    }}
                    onMouseLeave={(e) => {
                      if (!isSelected) e.currentTarget.style.backgroundColor = 'transparent';
                    }}
                  >
                    {format(day, 'd')}
                    {/* Indicator dots container */}
                    {!isSelected && (dayHasNote || dayHasIncompleteTasks(day)) && (
                      <span className="absolute bottom-0.5 flex gap-0.5 justify-center">
                        {dayHasNote && (
                          <span
                            className="w-1 h-1 rounded-full"
                            style={{ backgroundColor: 'var(--accent-primary)' }}
                          />
                        )}
                        {dayHasIncompleteTasks(day) && (
                          <span
                            className="w-1 h-1 rounded-full"
                            style={{ backgroundColor: 'var(--status-error, #ef4444)' }}
                          />
                        )}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}

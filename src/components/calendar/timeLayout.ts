import { isValid, parseISO } from 'date-fns';
import type { CalendarEvent } from '@/types';

export const MILLISECONDS_PER_HOUR = 60 * 60 * 1000;

export interface LocalDayInterval {
  start: Date;
  end: Date;
  elapsedHours: number;
}

export function localDayInterval(date: Date): LocalDayInterval {
  const start = new Date(date);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(start.getDate() + 1);
  return {
    start,
    end,
    elapsedHours: (end.getTime() - start.getTime()) / MILLISECONDS_PER_HOUR,
  };
}

function eventInstants(event: CalendarEvent): { start: Date; end: Date } | null {
  const start = parseISO(event.start);
  const end = parseISO(event.end);
  if (!isValid(start) || !isValid(end) || end.getTime() <= start.getTime()) return null;
  return { start, end };
}

export function eventOverlapsLocalDay(event: CalendarEvent, date: Date): boolean {
  const interval = eventInstants(event);
  if (!interval) return false;
  const day = localDayInterval(date);
  return interval.start < day.end && interval.end > day.start;
}

export function eventsOverlappingLocalDay(events: CalendarEvent[], date: Date): CalendarEvent[] {
  return events.filter((event) => eventOverlapsLocalDay(event, date));
}

export interface EventDayLayout {
  start: Date;
  end: Date;
  top: number;
  height: number;
}

export function eventLayoutForDay(
  event: CalendarEvent,
  hourHeight: number,
  dayStart?: Date,
  dayEnd?: Date
): EventDayLayout | null {
  const interval = eventInstants(event);
  if (!interval) return null;
  const fallbackDay = localDayInterval(interval.start);
  const startBoundary = dayStart ?? fallbackDay.start;
  const endBoundary = dayEnd ?? fallbackDay.end;
  const clippedStart = new Date(Math.max(interval.start.getTime(), startBoundary.getTime()));
  const clippedEnd = new Date(Math.min(interval.end.getTime(), endBoundary.getTime()));
  if (clippedEnd <= clippedStart) return null;

  return {
    start: clippedStart,
    end: clippedEnd,
    top: ((clippedStart.getTime() - startBoundary.getTime()) / MILLISECONDS_PER_HOUR) * hourHeight,
    height: Math.max(
      ((clippedEnd.getTime() - clippedStart.getTime()) / MILLISECONDS_PER_HOUR) * hourHeight,
      20
    ),
  };
}

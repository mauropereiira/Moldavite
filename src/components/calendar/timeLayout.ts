import { isValid, parseISO } from 'date-fns';
import type { CalendarEvent } from '@/types';

export interface LocalDayInterval {
  start: Date;
  end: Date;
}

export function localDayInterval(date: Date): LocalDayInterval {
  const start = new Date(date);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(start.getDate() + 1);
  return { start, end };
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

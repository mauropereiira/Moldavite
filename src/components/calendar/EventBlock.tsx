import { useState, type CSSProperties } from 'react';
import { format } from 'date-fns';
import { open } from '@tauri-apps/plugin-shell';
import type { CalendarEvent } from '@/types';
import { eventLayoutForDay } from './timeLayout';

const HOUR_HEIGHT = 60; // pixels per hour
const EVENT_WASH_ALPHA = 0.09;
const EVENT_WASH_HOVER_ALPHA = 0.14;

function sourceColorWash(sourceColor: string, alpha: number, fallback: string): string {
  let resolvedColor = sourceColor.trim();
  const variable = /^var\((--[a-zA-Z0-9-]+)\)$/.exec(resolvedColor);

  if (variable && typeof window !== 'undefined') {
    resolvedColor = window
      .getComputedStyle(document.documentElement)
      .getPropertyValue(variable[1])
      .trim();
  }

  const hex = /^#([0-9a-fA-F]{2})([0-9a-fA-F]{2})([0-9a-fA-F]{2})$/.exec(resolvedColor);
  if (!hex) return fallback;

  const [, red, green, blue] = hex;
  return `rgba(${Number.parseInt(red, 16)}, ${Number.parseInt(green, 16)}, ${Number.parseInt(blue, 16)}, ${alpha})`;
}

interface EventBlockProps {
  event: CalendarEvent;
  columnIndex: number;
  totalColumns: number;
  index?: number;
  dayStart?: Date;
  dayEnd?: Date;
}

export function EventBlock({
  event,
  columnIndex,
  totalColumns,
  index = 0,
  dayStart,
  dayEnd,
}: EventBlockProps) {
  const [showTooltip, setShowTooltip] = useState(false);

  const handleClick = async () => {
    if (event.url) {
      await open(event.url);
    }
  };

  // Position by elapsed instants and clip to the displayed local day. Wall
  // clock fields collide during a fall-back hour and go negative overnight.
  const layout = eventLayoutForDay(event, HOUR_HEIGHT, dayStart, dayEnd);
  if (!layout) return null;
  const { start, end, top: topPosition, height } = layout;

  // Calculate width and left position for overlapping events
  const width = `calc((100% - 60px - ${(totalColumns - 1) * 2}px) / ${totalColumns})`;
  const left = `calc(60px + ${columnIndex} * ((100% - 60px) / ${totalColumns}) + ${columnIndex * 2}px)`;

  // Format time for display
  const timeDisplay = `${format(start, 'h:mm a')} - ${format(end, 'h:mm a')}`;

  const sourceColor = event.calendarColor || 'var(--calendar-google)';
  const wash = sourceColorWash(
    sourceColor,
    showTooltip ? EVENT_WASH_HOVER_ALPHA : EVENT_WASH_ALPHA,
    showTooltip ? 'var(--active-overlay)' : 'var(--hover-overlay)'
  );

  return (
    <div
      className={`absolute event-item-enter ${event.url ? 'cursor-pointer' : ''}`}
      style={
        {
          top: `${topPosition}px`,
          height: `${height}px`,
          left,
          width,
          backgroundColor: wash,
          borderTop: '1px solid var(--border-muted)',
          borderBottom: '1px solid var(--border-muted)',
          '--index': Math.min(index, 10),
        } as CSSProperties
      }
      onClick={handleClick}
      role={event.url ? 'button' : undefined}
      tabIndex={event.url ? 0 : undefined}
      onKeyDown={(e) => {
        if (event.url && (e.key === 'Enter' || e.key === ' ')) {
          e.preventDefault();
          void handleClick();
        }
      }}
      onMouseEnter={() => setShowTooltip(true)}
      onMouseLeave={() => setShowTooltip(false)}
    >
      <span
        className="absolute"
        style={{ top: 0, bottom: 0, left: 0, width: '2px', backgroundColor: sourceColor }}
        aria-hidden="true"
      />

      {/* Content */}
      <div className="relative flex h-full min-w-0 items-start overflow-hidden py-1 pl-2 pr-1">
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-baseline gap-1.5">
            <span
              className="event-title min-w-0 flex-1 truncate text-xs leading-tight"
              style={{
                color: showTooltip ? 'var(--text-primary)' : 'var(--text-secondary)',
              }}
            >
              {event.title}
            </span>
            <span
              className="flex-shrink-0 text-[10px] leading-tight"
              style={{ color: 'var(--text-muted)' }}
            >
              {format(start, 'h:mm a')}
            </span>
          </div>

          {event.location && height > 40 && (
            <div
              className="mt-0.5 truncate text-[10px] leading-tight"
              style={{ color: 'var(--text-muted)' }}
            >
              {event.location}
            </div>
          )}
        </div>
      </div>

      {/* Tooltip on hover */}
      {showTooltip && (
        <div
          className="absolute left-full top-0 ml-2 z-30 p-3 min-w-[200px] max-w-[280px] modal-content-enter"
          style={{
            backgroundColor: 'var(--bg-elevated)',
            border: '1px solid var(--border-muted)',
          }}
        >
          <div className="flex items-start gap-2">
            <span
              className="mt-1.5 h-1.5 w-1.5 flex-shrink-0"
              style={{ backgroundColor: sourceColor }}
              aria-hidden="true"
            />
            <div className="min-w-0">
              <div className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                {event.title}
              </div>
              <div className="text-[10px]" style={{ color: 'var(--text-muted)' }}>
                {timeDisplay}
              </div>
            </div>
          </div>
          {event.location && (
            <div className="mt-1 text-[10px]" style={{ color: 'var(--text-muted)' }}>
              Location: {event.location}
            </div>
          )}
          {event.notes && (
            <div
              className="mt-2 pt-2 text-xs line-clamp-3"
              style={{
                borderTop: '1px solid var(--border-muted)',
                color: 'var(--text-secondary)',
              }}
            >
              {event.notes}
            </div>
          )}
          {event.url && (
            <div
              className="mt-2 inline-block text-[10px]"
              style={{ color: 'var(--text-primary)', borderBottom: '1px solid currentColor' }}
            >
              Open in calendar
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// All-day event component
interface AllDayEventProps {
  event: CalendarEvent;
  index?: number;
}

export function AllDayEvent({ event, index = 0 }: AllDayEventProps) {
  const [isHovered, setIsHovered] = useState(false);

  const handleClick = async () => {
    if (event.url) {
      await open(event.url);
    }
  };

  const sourceColor = event.calendarColor || 'var(--calendar-google)';
  const wash = sourceColorWash(
    sourceColor,
    isHovered ? EVENT_WASH_HOVER_ALPHA : EVENT_WASH_ALPHA,
    isHovered ? 'var(--active-overlay)' : 'var(--hover-overlay)'
  );

  return (
    <div
      className={`event-item-enter relative flex min-h-8 items-start py-2 pl-2 ${event.url ? 'cursor-pointer' : ''}`}
      style={
        {
          backgroundColor: wash,
          borderTop: '1px solid var(--border-muted)',
          borderBottom: '1px solid var(--border-muted)',
          '--index': Math.min(index, 10),
        } as CSSProperties
      }
      onClick={handleClick}
      role={event.url ? 'button' : undefined}
      tabIndex={event.url ? 0 : undefined}
      onKeyDown={(e) => {
        if (event.url && (e.key === 'Enter' || e.key === ' ')) {
          e.preventDefault();
          void handleClick();
        }
      }}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      <span
        className="absolute"
        style={{ top: 0, bottom: 0, left: 0, width: '2px', backgroundColor: sourceColor }}
        aria-hidden="true"
      />
      <span className="min-w-0 flex-1">
        <span
          className="event-title block truncate text-xs"
          style={{ color: isHovered ? 'var(--text-primary)' : 'var(--text-secondary)' }}
        >
          {event.title}
        </span>
        <span className="block truncate text-[10px]" style={{ color: 'var(--text-muted)' }}>
          {event.location || 'All day'}
        </span>
      </span>
    </div>
  );
}

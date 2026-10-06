import { useState, type CSSProperties } from 'react';
import { format, isValid, parseISO } from 'date-fns';
import { open } from '@tauri-apps/plugin-shell';
import { safeInvoke as invoke } from '@/lib/ipc';
import { isMobilePlatform } from '@/lib/platform';
import type { CalendarEvent } from '@/types';

const EVENT_WASH_ALPHA = 0.09;
const EVENT_WASH_HOVER_ALPHA = 0.14;

// The phone grants the webview no shell permissions, so it uses the native opener.
async function openEventUrl(url: string) {
  if (!url) return;
  try {
    await (isMobilePlatform() ? invoke('open_external_link', { url }) : open(url));
  } catch (error) {
    console.error('[EventRow] Failed to open event link:', error);
  }
}

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

/** "09:00 – 10:30" on the 24-hour clock, or null when either end is unreadable. */
function timeRange(event: CalendarEvent): string | null {
  const start = parseISO(event.start);
  const end = parseISO(event.end);
  if (!isValid(start) || !isValid(end)) return null;
  return `${format(start, 'HH:mm')} – ${format(end, 'HH:mm')}`;
}

interface EventRowProps {
  event: CalendarEvent;
  index?: number;
}

export function EventRow({ event, index = 0 }: EventRowProps) {
  const [isHovered, setIsHovered] = useState(false);
  const when = event.isAllDay ? 'All day' : timeRange(event);

  const handleClick = () => openEventUrl(event.url);

  const sourceColor = event.calendarColor || 'var(--calendar-google)';
  const wash = sourceColorWash(
    sourceColor,
    isHovered ? EVENT_WASH_HOVER_ALPHA : EVENT_WASH_ALPHA,
    isHovered ? 'var(--active-overlay)' : 'var(--hover-overlay)'
  );

  if (when === null) return null;

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
          {event.location ? `${when} · ${event.location}` : when}
        </span>
      </span>
    </div>
  );
}

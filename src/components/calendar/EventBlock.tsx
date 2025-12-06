import { useState } from 'react';
import { format, parseISO } from 'date-fns';
import { MapPin } from 'lucide-react';
import { open } from '@tauri-apps/plugin-shell';
import type { CalendarEvent } from '@/types';

const HOUR_HEIGHT = 60; // pixels per hour

interface EventBlockProps {
  event: CalendarEvent;
  columnIndex: number;
  totalColumns: number;
}

export function EventBlock({ event, columnIndex, totalColumns }: EventBlockProps) {
  const [showTooltip, setShowTooltip] = useState(false);

  const handleClick = async () => {
    if (event.url) {
      await open(event.url);
    }
  };

  // Parse times and calculate position
  const start = parseISO(event.start);
  const end = parseISO(event.end);

  const startHours = start.getHours();
  const startMinutes = start.getMinutes();
  const endHours = end.getHours();
  const endMinutes = end.getMinutes();

  // Calculate top position: (hour × 60px) + (minutes)
  const topPosition = (startHours * HOUR_HEIGHT) + (startMinutes * HOUR_HEIGHT / 60);

  // Calculate height: duration in minutes × (60px / 60 minutes)
  const durationMinutes = (endHours * 60 + endMinutes) - (startHours * 60 + startMinutes);
  const height = Math.max(durationMinutes * (HOUR_HEIGHT / 60), 20); // Minimum 20px height

  // Calculate width and left position for overlapping events
  const width = `calc((100% - 60px - ${(totalColumns - 1) * 2}px) / ${totalColumns})`;
  const left = `calc(60px + ${columnIndex} * ((100% - 60px) / ${totalColumns}) + ${columnIndex * 2}px)`;

  // Format time for display
  const timeDisplay = `${format(start, 'h:mm a')} - ${format(end, 'h:mm a')}`;

  // Get background color with opacity
  const backgroundColor = event.calendarColor || '#4285f4';

  return (
    <div
      className={`absolute rounded overflow-hidden ${event.url ? 'cursor-pointer' : ''}`}
      style={{
        top: `${topPosition}px`,
        height: `${height}px`,
        left,
        width,
        borderLeft: `3px solid ${backgroundColor}`,
        backgroundColor: `${backgroundColor}20`, // 20% opacity in light mode
      }}
      onClick={handleClick}
      onMouseEnter={() => setShowTooltip(true)}
      onMouseLeave={() => setShowTooltip(false)}
    >
      {/* Dark mode background overlay */}
      <div
        className="absolute inset-0 hidden dark:block"
        style={{ backgroundColor: `${backgroundColor}30` }} // 30% opacity in dark mode
      />

      {/* Content */}
      <div className="relative p-2 h-full flex flex-col">
        {/* Time */}
        <span className="text-[11px] text-gray-600 dark:text-gray-300 leading-tight">
          {format(start, 'h:mm a')}
        </span>

        {/* Title */}
        <div className="text-xs font-medium text-gray-900 dark:text-white truncate leading-tight mt-0.5">
          {event.title}
        </div>

        {/* Location (if space and available) */}
        {event.location && height > 50 && (
          <div className="flex items-center gap-0.5 mt-0.5">
            <MapPin className="w-2.5 h-2.5 text-gray-500 dark:text-gray-400 flex-shrink-0" />
            <span className="text-[10px] text-gray-500 dark:text-gray-400 truncate">
              {event.location}
            </span>
          </div>
        )}
      </div>

      {/* Tooltip on hover */}
      {showTooltip && (
        <div className="absolute left-full top-0 ml-2 z-30 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg p-3 min-w-[200px] max-w-[280px]">
          <div className="font-medium text-sm text-gray-900 dark:text-white mb-1">
            {event.title}
          </div>
          <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">
            {timeDisplay}
          </div>
          {event.location && (
            <div className="flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400">
              <MapPin className="w-3 h-3" />
              {event.location}
            </div>
          )}
          {event.notes && (
            <div className="mt-2 pt-2 border-t border-gray-100 dark:border-gray-700 text-xs text-gray-600 dark:text-gray-300 line-clamp-3">
              {event.notes}
            </div>
          )}
          {event.url && (
            <div className="mt-2 text-[10px] text-blue-500">
              Click to open in calendar
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
}

export function AllDayEvent({ event }: AllDayEventProps) {
  const handleClick = async () => {
    if (event.url) {
      await open(event.url);
    }
  };

  const backgroundColor = event.calendarColor || '#4285f4';

  return (
    <div
      className={`h-[30px] rounded px-2 flex items-center ${event.url ? 'cursor-pointer hover:opacity-80' : ''}`}
      style={{
        backgroundColor: `${backgroundColor}30`,
        borderLeft: `3px solid ${backgroundColor}`,
      }}
      onClick={handleClick}
    >
      <span className="text-xs font-medium text-gray-900 dark:text-white truncate">
        {event.title}
      </span>
      {event.location && (
        <span className="ml-2 text-[10px] text-gray-500 dark:text-gray-400 truncate hidden sm:inline">
          {event.location}
        </span>
      )}
    </div>
  );
}

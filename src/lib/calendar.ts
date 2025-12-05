import { invoke } from '@tauri-apps/api/core';
import type { CalendarEvent, CalendarInfo, CalendarPermission } from '@/types';

/**
 * Gets the current calendar access permission status.
 * @returns Permission status (Authorized, Denied, NotDetermined, etc.)
 */
export async function getCalendarPermission(): Promise<CalendarPermission> {
  return await invoke('get_calendar_permission');
}

/**
 * Requests calendar access permission from the user.
 * Shows the system permission dialog on first request.
 * @returns True if permission was granted
 */
export async function requestCalendarPermission(): Promise<boolean> {
  return await invoke('request_calendar_permission');
}

/**
 * Checks if calendar access has been authorized.
 * @returns True if the app has calendar access
 */
export async function isCalendarAuthorized(): Promise<boolean> {
  return await invoke('is_calendar_authorized');
}

/**
 * Fetches calendar events for a date range.
 * @param startDate - Start date in YYYY-MM-DD format
 * @param endDate - End date in YYYY-MM-DD format
 * @param calendarId - Optional calendar ID to filter by specific calendar
 * @returns Array of calendar events
 */
export async function fetchCalendarEvents(
  startDate: string,
  endDate: string,
  calendarId?: string
): Promise<CalendarEvent[]> {
  return await invoke('fetch_calendar_events', {
    startDate,
    endDate,
    calendarId: calendarId || null,
  });
}

/**
 * Lists all calendars from the user's Calendar.app.
 * @returns Array of calendar info objects with IDs and names
 */
export async function listCalendars(): Promise<CalendarInfo[]> {
  return await invoke('list_calendars');
}

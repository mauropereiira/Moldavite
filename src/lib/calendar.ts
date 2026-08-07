/**
 * Typed IPC boundary for calendar sources, calendars, and event ranges.
 *
 * The Rust layer owns authorization, source dispatch, and date filtering, and
 * it merges Apple and Google results behind one call. Callers must not infer
 * authorization from an empty result set, and must not assume a fetch that
 * returned events had no failures — check `errors`.
 */

import { safeInvoke as invoke } from './ipc';
import type {
  CalendarFetchResult,
  CalendarInfo,
  CalendarPermission,
  CalendarSourceStatus,
} from '@/types';

/**
 * Gets the current macOS calendar access permission status.
 * @returns Permission status (Authorized, Denied, NotDetermined, etc.)
 */
export async function getCalendarPermission(): Promise<CalendarPermission> {
  return await invoke('get_calendar_permission');
}

/**
 * Requests macOS calendar access from the user.
 * Shows the system permission dialog on first request.
 * @returns True if permission was granted
 */
export async function requestCalendarPermission(): Promise<boolean> {
  return await invoke('request_calendar_permission');
}

/**
 * Checks if macOS calendar access has been authorized.
 * @returns True if the app has calendar access
 */
export async function isCalendarAuthorized(): Promise<boolean> {
  return await invoke('is_calendar_authorized');
}

/**
 * Connection state for every calendar source this build supports.
 * @returns One status per source, including unavailable ones and why
 */
export async function listCalendarSources(): Promise<CalendarSourceStatus[]> {
  return await invoke('list_calendar_sources');
}

/**
 * Fetches calendar events for a date range across every connected source.
 * @param startDate - Start date in YYYY-MM-DD format
 * @param endDate - End date in YYYY-MM-DD format
 * @param calendarIds - Namespaced calendar ids to include; empty means all
 * @returns Merged events plus any per-source failures
 */
export async function fetchCalendarEvents(
  startDate: string,
  endDate: string,
  calendarIds: string[] = []
): Promise<CalendarFetchResult> {
  return await invoke('fetch_calendar_events', { startDate, endDate, calendarIds });
}

/**
 * Lists calendars from every connected source.
 * @returns Calendar info objects with namespaced ids and their source
 */
export async function listCalendars(): Promise<CalendarInfo[]> {
  return await invoke('list_calendars');
}

/**
 * Runs the Google OAuth flow in the system browser and stores the resulting
 * refresh token in the OS keychain.
 * @returns The Google source status after connecting
 */
export async function connectGoogleCalendar(): Promise<CalendarSourceStatus> {
  return await invoke('google_calendar_connect');
}

/**
 * Removes the stored Google refresh token and disconnects the account.
 */
export async function disconnectGoogleCalendar(): Promise<void> {
  return await invoke('google_calendar_disconnect');
}

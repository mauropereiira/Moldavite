/**
 * Calendar events reach the app from more than one place: macOS EventKit and
 * the Google Calendar API. Ids from those two namespaces can collide, so the
 * Rust layer prefixes every event and calendar id with its source
 * (`apple:<uid>`, `google:<id>`) and carries `source` alongside it. Treat both
 * as opaque here — splitting them is the backend's job.
 */
export type CalendarSource = 'apple' | 'google';

export interface CalendarEvent {
  id: string;
  source: CalendarSource;
  title: string;
  start: string;
  end: string;
  isAllDay: boolean;
  location: string;
  notes: string;
  calendarId: string;
  calendarTitle: string;
  calendarColor: string;
  url: string;
}

export interface CalendarInfo {
  id: string;
  source: CalendarSource;
  title: string;
  color: string;
  isSubscribed: boolean;
  allowsModify: boolean;
}

export type CalendarPermission =
  | 'NotDetermined'
  | 'Restricted'
  | 'Denied'
  | 'Authorized'
  | 'FullAccess';

/**
 * Per-source connection state. `available` is about the build and platform
 * (Apple is macOS-only; Google needs client credentials compiled in), while
 * `connected` is about this user having granted access.
 */
export interface CalendarSourceStatus {
  source: CalendarSource;
  available: boolean;
  connected: boolean;
  /** Google account email, once connected. */
  account: string | null;
  /** EventKit authorization state. Apple only. */
  permission: CalendarPermission | null;
  /** Why the source is unavailable or failing, when it is. */
  error: string | null;
}

export interface CalendarSourceError {
  source: CalendarSource;
  message: string;
}

/**
 * A fetch never fails as a whole because one source is down — Google being
 * unreachable must not blank out Apple's events. Failures arrive in `errors`
 * next to whatever did load.
 */
export interface CalendarFetchResult {
  events: CalendarEvent[];
  errors: CalendarSourceError[];
}

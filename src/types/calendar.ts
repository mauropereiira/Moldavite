export interface CalendarEvent {
  id: string;
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

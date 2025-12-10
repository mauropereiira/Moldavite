import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { CalendarEvent, CalendarInfo, CalendarPermission } from '@/types';
import {
  isCalendarAuthorized,
  getCalendarPermission,
  requestCalendarPermission,
  fetchCalendarEvents,
  listCalendars,
} from '@/lib/calendar';
import { format } from 'date-fns';

interface CalendarState {
  // Permission state
  permissionStatus: CalendarPermission;
  isAuthorized: boolean;
  isRequestingPermission: boolean;

  // Events state
  events: CalendarEvent[];
  isLoadingEvents: boolean;
  eventsError: string | null;
  lastSynced: Date | null;

  // Calendars
  calendars: CalendarInfo[];
  selectedCalendarId: string | null;

  // Settings
  calendarEnabled: boolean;
  showAllDayEvents: boolean;

  // Actions
  checkPermission: () => Promise<void>;
  requestPermission: () => Promise<boolean>;
  fetchEvents: (date: Date) => Promise<void>;
  fetchCalendars: () => Promise<void>;
  setSelectedCalendarId: (id: string | null) => void;
  setCalendarEnabled: (enabled: boolean) => void;
  setShowAllDayEvents: (show: boolean) => void;
  clearEvents: () => void;
}

export const useCalendarStore = create<CalendarState>()(
  persist(
    (set, get) => ({
      // Initial state
      permissionStatus: 'NotDetermined',
      isAuthorized: false,
      isRequestingPermission: false,
      events: [],
      isLoadingEvents: false,
      eventsError: null,
      lastSynced: null,
      calendars: [],
      selectedCalendarId: null,
      calendarEnabled: true,
      showAllDayEvents: true,

      /**
       * Checks the current calendar permission status and fetches calendars if authorized.
       */
      checkPermission: async () => {
        try {
          const status = await getCalendarPermission();
          const authorized = await isCalendarAuthorized();
          set({ permissionStatus: status, isAuthorized: authorized });

          // If authorized, fetch calendars
          if (authorized) {
            await get().fetchCalendars();
          }
        } catch (error) {
          console.error('Failed to check permission:', error);
          set({ permissionStatus: 'NotDetermined', isAuthorized: false });
        }
      },

      /**
       * Requests calendar access permission from the user.
       * Includes a small delay to ensure the app window is focused before showing the system dialog.
       * Fetches calendars if permission is granted.
       * @returns True if permission was granted
       */
      requestPermission: async () => {
        set({ isRequestingPermission: true });
        try {
          // Small delay to ensure window is focused before system dialog appears
          await new Promise((resolve) => setTimeout(resolve, 100));

          const granted = await requestCalendarPermission();
          const status = await getCalendarPermission();
          set({
            permissionStatus: status,
            isAuthorized: granted,
            isRequestingPermission: false,
          });

          // Fetch calendars if granted
          if (granted) {
            await get().fetchCalendars();
          }

          return granted;
        } catch (error) {
          console.error('Permission request failed:', error);
          set({ isRequestingPermission: false });
          return false;
        }
      },

      /**
       * Fetches calendar events for a specific date.
       * Respects calendar enabled setting and filters based on all-day event preference.
       * @param date - The date to fetch events for
       */
      fetchEvents: async (date: Date) => {
        const { calendarEnabled, selectedCalendarId, showAllDayEvents, isAuthorized } = get();

        if (!calendarEnabled || !isAuthorized) {
          return;
        }

        set({ isLoadingEvents: true, eventsError: null });

        try {
          const dateStr = format(date, 'yyyy-MM-dd');
          const events = await fetchCalendarEvents(
            dateStr,
            dateStr,
            selectedCalendarId || undefined
          );

          // Filter all-day events if disabled
          const filteredEvents = showAllDayEvents
            ? events
            : events.filter((e) => !e.isAllDay);

          set({
            events: filteredEvents,
            isLoadingEvents: false,
            lastSynced: new Date(),
          });
        } catch (error) {
          console.error('Failed to fetch events:', error);
          set({
            eventsError: error instanceof Error ? error.message : 'Failed to fetch events',
            isLoadingEvents: false,
          });
        }
      },

      /**
       * Fetches the list of available calendars from the user's Calendar.app.
       * Automatically selects the first calendar if none is selected.
       */
      fetchCalendars: async () => {
        try {
          const calendars = await listCalendars();
          // Select first calendar if none selected
          set({
            calendars,
            selectedCalendarId: get().selectedCalendarId || calendars[0]?.id || null,
          });
        } catch (error) {
          console.error('Failed to fetch calendars:', error);
        }
      },

      /**
       * Sets which calendar to display events from.
       * @param id - Calendar ID, or null for all calendars
       */
      setSelectedCalendarId: (id) => set({ selectedCalendarId: id }),

      /**
       * Enables or disables calendar integration.
       * @param enabled - True to show calendar events
       */
      setCalendarEnabled: (enabled) => set({ calendarEnabled: enabled }),

      /**
       * Controls whether all-day events are displayed.
       * @param show - True to show all-day events
       */
      setShowAllDayEvents: (show) => set({ showAllDayEvents: show }),

      /**
       * Clears all loaded events and sync timestamp.
       */
      clearEvents: () => set({ events: [], lastSynced: null }),
    }),
    {
      name: 'notomattic-calendar',
      partialize: (state) => ({
        calendarEnabled: state.calendarEnabled,
        showAllDayEvents: state.showAllDayEvents,
        selectedCalendarId: state.selectedCalendarId,
      }),
    }
  )
);

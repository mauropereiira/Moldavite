/**
 * Calendar source connections, calendar selection, event cache, and loading
 * state.
 *
 * Events can come from macOS EventKit and from Google, and the backend merges
 * them behind one call. Two consequences shape this store: a fetch reports
 * per-source failures instead of failing as a whole, so one dead source never
 * blanks the timeline; and calendar ids are namespaced by source, so the
 * selection is a plain list of opaque ids rather than anything Apple-shaped.
 *
 * `permissionStatus` / `isAuthorized` remain Apple-only — EventKit is the only
 * source with an OS permission model. Google's state lives in `sources`.
 */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type {
  CalendarEvent,
  CalendarInfo,
  CalendarPermission,
  CalendarSource,
  CalendarSourceError,
  CalendarSourceStatus,
} from '@/types';
import {
  isCalendarAuthorized,
  getCalendarPermission,
  requestCalendarPermission,
  fetchCalendarEvents,
  listCalendarSources,
  connectGoogleCalendar,
  disconnectGoogleCalendar,
} from '@/lib/calendar';
import { format } from 'date-fns';

/** How long a fetched range stays usable before it is refetched. */
const CALENDAR_EVENTS_CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

/**
 * Range results, held outside the store because they are derived data with a
 * TTL rather than state anyone should subscribe to. Cleared whenever the
 * selection, a connection, or the all-day preference changes.
 */
const eventCache = new Map<string, { events: CalendarEvent[]; at: number }>();

function cacheKey(startDate: string, endDate: string, calendarIds: string[]): string {
  return JSON.stringify([startDate, endDate, [...calendarIds].sort()]);
}

/** Monotonic id so a slow fetch cannot overwrite a newer one. */
let latestRequestId = 0;

interface CalendarState {
  // Apple permission state
  permissionStatus: CalendarPermission;
  isAuthorized: boolean;
  isRequestingPermission: boolean;

  // Source connections
  sources: CalendarSourceStatus[];
  isConnectingGoogle: boolean;
  /** Failure from the connect flow itself. Shown in Settings, never over the timeline. */
  connectError: string | null;

  // Events state
  events: CalendarEvent[];
  isLoadingEvents: boolean;
  eventsError: string | null;
  sourceErrors: CalendarSourceError[];
  lastSynced: Date | null;

  // Calendars
  calendars: CalendarInfo[];
  selectedCalendarIds: string[];
  /** Source metadata for opaque persisted ids, learned from CalendarInfo. */
  selectedCalendarSources: Record<string, CalendarSource>;
  /** Pending v0 migration, resolved against backend-owned id metadata. */
  legacySelectedAppleCalendarId: string | null;

  // Settings
  calendarEnabled: boolean;
  showAllDayEvents: boolean;
  refreshIntervalMinutes: number;

  // Onboarding
  hasSeenOnboarding: boolean;

  // Actions
  checkPermission: () => Promise<void>;
  requestPermission: () => Promise<boolean>;
  refreshSources: () => Promise<void>;
  connectGoogle: () => Promise<boolean>;
  disconnectGoogle: () => Promise<void>;
  fetchEvents: (start: Date, end?: Date, opts?: { force?: boolean }) => Promise<void>;
  fetchCalendars: () => Promise<void>;
  toggleCalendarSelected: (id: string) => void;
  setSelectedCalendarIds: (ids: string[]) => void;
  setCalendarEnabled: (enabled: boolean) => void;
  setShowAllDayEvents: (show: boolean) => void;
  setRefreshIntervalMinutes: (minutes: number) => void;
  setHasSeenOnboarding: (seen: boolean) => void;
  clearEvents: () => void;
}

/** Any source the user has actually connected. */
function hasConnectedSource(sources: CalendarSourceStatus[]): boolean {
  return sources.some((s) => s.available && s.connected);
}

/**
 * Every source reported by the backend is unavailable on this platform/build.
 * An empty list is unknown state, not proof that no source can be connected.
 */
export function hasNoConnectableCalendarSource(sources: CalendarSourceStatus[]): boolean {
  return sources.length > 0 && sources.every((source) => !source.available);
}

/**
 * v0 stored a single `selectedCalendarId` holding a bare EventKit id, with
 * `null` meaning "all calendars". Keep that value in a migration-only field
 * until Rust returns the matching namespaced id; frontend code must never
 * manufacture or parse the current id format.
 *
 * Exported for tests: an upgrade that silently dropped the user's calendar
 * choice would look like the app forgetting a setting, which is exactly the
 * kind of regression a migration is supposed to prevent.
 */
export function migrateCalendarState(persisted: unknown, version: number): Record<string, unknown> {
  const state = (persisted ?? {}) as Record<string, unknown>;
  if (version === 0) {
    const legacy = state.selectedCalendarId;
    state.selectedCalendarIds = [];
    state.selectedCalendarSources = {};
    state.legacySelectedAppleCalendarId = typeof legacy === 'string' && legacy ? legacy : null;
    delete state.selectedCalendarId;
  }
  return state;
}

interface CalendarInfoWithLegacy extends CalendarInfo {
  /** Native id supplied only for resolving the v0 Apple selection migration. */
  legacyId?: string;
}

interface CalendarSourceListing extends CalendarSourceStatus {
  calendars: CalendarInfoWithLegacy[];
  calendarsEnumerated: boolean;
}

function normalizeSourceListings(sources: CalendarSourceStatus[]): CalendarSourceListing[] {
  return sources.map((source) => {
    const listing = source as Partial<CalendarSourceListing>;
    return {
      ...source,
      calendars: Array.isArray(listing.calendars) ? listing.calendars : [],
      calendarsEnumerated: listing.calendarsEnumerated === true,
    };
  });
}

function mergeSourceListings(
  state: Pick<
    CalendarState,
    | 'calendars'
    | 'selectedCalendarIds'
    | 'selectedCalendarSources'
    | 'legacySelectedAppleCalendarId'
  >,
  listings: CalendarSourceListing[]
): Pick<
  CalendarState,
  'calendars' | 'selectedCalendarIds' | 'selectedCalendarSources' | 'legacySelectedAppleCalendarId'
> {
  const enumeratedSources = new Set<CalendarSource>(
    listings.filter((listing) => listing.calendarsEnumerated).map((listing) => listing.source)
  );
  const enumeratedCalendars = listings
    .filter((listing) => listing.calendarsEnumerated)
    .flatMap((listing) => listing.calendars);
  const calendars = [
    ...state.calendars.filter((calendar) => !enumeratedSources.has(calendar.source)),
    ...enumeratedCalendars,
  ];
  const liveIds = new Set(calendars.map((calendar) => calendar.id));
  const knownCalendars = new Map(
    [...state.calendars, ...calendars].map((calendar) => [calendar.id, calendar])
  );
  let selectedCalendarIds = state.selectedCalendarIds.filter((id) => {
    const known = knownCalendars.get(id);
    const source = known?.source ?? state.selectedCalendarSources[id];
    return !source || !enumeratedSources.has(source) || liveIds.has(id);
  });
  let legacySelectedAppleCalendarId = state.legacySelectedAppleCalendarId;

  if (legacySelectedAppleCalendarId && enumeratedSources.has('apple')) {
    const migrated = enumeratedCalendars.find(
      (calendar) =>
        calendar.source === 'apple' && calendar.legacyId === legacySelectedAppleCalendarId
    );
    if (migrated) selectedCalendarIds = [migrated.id];
    legacySelectedAppleCalendarId = null;
  }

  const selectedCalendarSources = Object.fromEntries(
    selectedCalendarIds.flatMap((id) => {
      const source = knownCalendars.get(id)?.source ?? state.selectedCalendarSources[id];
      return source ? [[id, source]] : [];
    })
  );

  return {
    calendars,
    selectedCalendarIds,
    selectedCalendarSources,
    legacySelectedAppleCalendarId,
  };
}

export const useCalendarStore = create<CalendarState>()(
  persist(
    (set, get) => ({
      // Initial state
      permissionStatus: 'NotDetermined',
      isAuthorized: false,
      isRequestingPermission: false,
      sources: [],
      isConnectingGoogle: false,
      connectError: null,
      events: [],
      isLoadingEvents: false,
      eventsError: null,
      sourceErrors: [],
      lastSynced: null,
      calendars: [],
      selectedCalendarIds: [],
      selectedCalendarSources: {},
      legacySelectedAppleCalendarId: null,
      calendarEnabled: true,
      showAllDayEvents: true,
      refreshIntervalMinutes: 15,
      hasSeenOnboarding: false,

      /**
       * Checks the current macOS calendar permission and refreshes source state.
       */
      checkPermission: async () => {
        try {
          const status = await getCalendarPermission();
          const authorized = await isCalendarAuthorized();
          set({ permissionStatus: status, isAuthorized: authorized });
        } catch {
          // Non-macOS builds have no EventKit commands at all; that is not an
          // error, it just means Apple is not an available source here.
          set({ permissionStatus: 'NotDetermined', isAuthorized: false });
        }
        await get().refreshSources();
      },

      /**
       * Requests macOS calendar access from the user.
       * Includes a small delay so the app window is focused before the system
       * dialog appears.
       * @returns True if permission was granted
       */
      requestPermission: async () => {
        set({ isRequestingPermission: true });
        try {
          await new Promise((resolve) => setTimeout(resolve, 100));

          const granted = await requestCalendarPermission();
          const status = await getCalendarPermission();
          set({
            permissionStatus: status,
            isAuthorized: granted,
            isRequestingPermission: false,
          });

          if (granted) {
            eventCache.clear();
            await get().refreshSources();
          }

          return granted;
        } catch (error) {
          console.error('Permission request failed:', error);
          set({ isRequestingPermission: false });
          return false;
        }
      },

      /**
       * Reloads per-source availability and connection state, and the calendar
       * list when anything is connected.
       */
      refreshSources: async () => {
        try {
          const listings = normalizeSourceListings(await listCalendarSources());
          const sources: CalendarSourceStatus[] = listings;
          if (hasConnectedSource(sources)) {
            set((state) => ({ sources, ...mergeSourceListings(state, listings) }));
          } else {
            set({ sources, calendars: [] });
          }
        } catch (error) {
          console.error('Failed to list calendar sources:', error);
          set({ sources: [] });
        }
      },

      /**
       * Runs the Google OAuth flow. The browser handoff happens in Rust, so
       * this resolves only once the user finishes or abandons consent.
       * @returns True if an account was connected
       */
      connectGoogle: async () => {
        set({ isConnectingGoogle: true });
        try {
          const status = await connectGoogleCalendar();
          eventCache.clear();
          set({ isConnectingGoogle: false, connectError: null });
          await get().refreshSources();
          return status.connected;
        } catch (error) {
          console.error('Google Calendar connection failed:', error);
          // Deliberately not `eventsError`: that field replaces the whole
          // timeline pane, so cancelling a Google consent used to hide every
          // Apple event behind a red error panel. A connection problem belongs
          // next to the connect button, in Settings.
          set({
            isConnectingGoogle: false,
            connectError: error instanceof Error ? error.message : String(error),
          });
          return false;
        }
      },

      /**
       * Disconnects Google and drops its calendars from the selection, so a
       * later reconnect does not silently restore a stale choice.
       */
      disconnectGoogle: async () => {
        try {
          await disconnectGoogleCalendar();
        } catch (error) {
          console.error('Google Calendar disconnect failed:', error);
        }
        eventCache.clear();
        set((state) => ({
          calendars: state.calendars.filter((calendar) => calendar.source !== 'google'),
          selectedCalendarIds: state.selectedCalendarIds.filter((id) => {
            const calendar = state.calendars.find((candidate) => candidate.id === id);
            const source = calendar?.source ?? state.selectedCalendarSources[id];
            return source !== 'google';
          }),
          selectedCalendarSources: Object.fromEntries(
            Object.entries(state.selectedCalendarSources).filter(
              ([, source]) => source !== 'google'
            )
          ),
          events: state.events.filter((e) => e.source !== 'google'),
        }));
        await get().refreshSources();
      },

      /**
       * Fetches events for a date range across every connected source.
       * @param start - First day of the range
       * @param end - Last day of the range; defaults to `start`
       * @param opts - `force` bypasses the TTL cache (the manual refresh button)
       */
      fetchEvents: async (start: Date, end?: Date, opts?: { force?: boolean }) => {
        const {
          calendarEnabled,
          selectedCalendarIds,
          showAllDayEvents,
          sources,
          legacySelectedAppleCalendarId,
        } = get();

        if (!calendarEnabled || !hasConnectedSource(sources) || legacySelectedAppleCalendarId) {
          return;
        }

        const startDate = format(start, 'yyyy-MM-dd');
        const endDate = format(end ?? start, 'yyyy-MM-dd');
        const key = cacheKey(startDate, endDate, selectedCalendarIds);
        // Even a cache hit is a newer view and must invalidate an older request.
        const requestId = ++latestRequestId;

        if (!opts?.force) {
          const hit = eventCache.get(key);
          if (hit && Date.now() - hit.at < CALENDAR_EVENTS_CACHE_DURATION) {
            // Errors belong to the range that produced them. Leaving them set
            // would carry a failure banner from another day over a good result.
            set({
              events: showAllDayEvents ? hit.events : hit.events.filter((e) => !e.isAllDay),
              sourceErrors: [],
              eventsError: null,
              isLoadingEvents: false,
            });
            return;
          }
        }

        // A slow network fetch must not overwrite a newer one. Clicking through
        // dates resolves out of order easily now that a request can take
        // seconds; without this the grid can show one day under another's
        // header.
        set({ isLoadingEvents: true, eventsError: null });

        try {
          const result = await fetchCalendarEvents(startDate, endDate, selectedCalendarIds);
          if (requestId !== latestRequestId) return;

          // Only cache a complete answer. Caching a partially-failed fetch
          // pins the gap in place for the whole TTL, so a source that recovers
          // seconds later still looks down until the cache expires.
          if (result.errors.length === 0) {
            eventCache.set(key, { events: result.events, at: Date.now() });
          }

          set({
            events: showAllDayEvents ? result.events : result.events.filter((e) => !e.isAllDay),
            sourceErrors: result.errors,
            isLoadingEvents: false,
            lastSynced: new Date(),
          });
        } catch (error) {
          console.error('Failed to fetch events:', error);
          if (requestId !== latestRequestId) return;
          set({
            eventsError: error instanceof Error ? error.message : 'Failed to fetch events',
            isLoadingEvents: false,
          });
        }
      },

      /**
       * Reloads the calendar list and drops selections whose calendar no longer
       * exists, so a removed calendar cannot silently filter everything out.
       */
      fetchCalendars: async () => {
        try {
          const listings = normalizeSourceListings(await listCalendarSources());
          const sources: CalendarSourceStatus[] = listings;
          if (hasConnectedSource(sources)) {
            set((state) => ({ sources, ...mergeSourceListings(state, listings) }));
          } else {
            set({ sources, calendars: [] });
          }
        } catch (error) {
          console.error('Failed to fetch calendars:', error);
        }
      },

      /**
       * Adds or removes one calendar from the selection.
       * @param id - Namespaced calendar id
       */
      toggleCalendarSelected: (id) => {
        eventCache.clear();
        set((state) => {
          const selected = state.selectedCalendarIds.includes(id);
          const selectedCalendarSources = { ...state.selectedCalendarSources };
          if (selected) {
            delete selectedCalendarSources[id];
          } else {
            const source = state.calendars.find((calendar) => calendar.id === id)?.source;
            if (source) selectedCalendarSources[id] = source;
          }
          return {
            selectedCalendarIds: selected
              ? state.selectedCalendarIds.filter((calendarId) => calendarId !== id)
              : [...state.selectedCalendarIds, id],
            selectedCalendarSources,
            legacySelectedAppleCalendarId: null,
          };
        });
      },

      /**
       * Replaces the selection outright. An empty list means every calendar.
       * @param ids - Namespaced calendar ids
       */
      setSelectedCalendarIds: (ids) => {
        eventCache.clear();
        set((state) => ({
          selectedCalendarIds: ids,
          selectedCalendarSources: Object.fromEntries(
            ids.flatMap((id) => {
              const source = state.calendars.find((calendar) => calendar.id === id)?.source;
              return source ? [[id, source]] : [];
            })
          ),
          legacySelectedAppleCalendarId: null,
        }));
      },

      /**
       * Enables or disables calendar integration.
       * @param enabled - True to show calendar events
       */
      setCalendarEnabled: (enabled) => set({ calendarEnabled: enabled }),

      /**
       * Controls whether all-day events are displayed.
       * @param show - True to show all-day events
       */
      // The cache holds unfiltered events and both read paths apply this
      // filter, so clearing it here would force a needless network round trip
      // for a purely local preference.
      setShowAllDayEvents: (show) => set({ showAllDayEvents: show }),

      /**
       * How often connected sources are polled while the app is open. Apple is
       * local and cheap; Google is rate-limited, which is what this bounds.
       * @param minutes - Refresh interval
       */
      setRefreshIntervalMinutes: (minutes) => set({ refreshIntervalMinutes: minutes }),

      /**
       * Marks the onboarding as seen.
       * @param seen - True if onboarding has been seen
       */
      setHasSeenOnboarding: (seen) => set({ hasSeenOnboarding: seen }),

      /**
       * Clears all loaded events, cached ranges, and the sync timestamp.
       */
      clearEvents: () => {
        eventCache.clear();
        set({ events: [], sourceErrors: [], lastSynced: null });
      },
    }),
    {
      name: 'moldavite-calendar',
      version: 2,
      migrate: (persisted, version) =>
        migrateCalendarState(persisted, version) as unknown as CalendarState,
      partialize: (state) => ({
        calendarEnabled: state.calendarEnabled,
        showAllDayEvents: state.showAllDayEvents,
        selectedCalendarIds: state.selectedCalendarIds,
        selectedCalendarSources: state.selectedCalendarSources,
        legacySelectedAppleCalendarId: state.legacySelectedAppleCalendarId,
        refreshIntervalMinutes: state.refreshIntervalMinutes,
        hasSeenOnboarding: state.hasSeenOnboarding,
      }),
    }
  )
);

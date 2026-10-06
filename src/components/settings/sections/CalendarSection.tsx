/**
 * CalendarSection: what the Agenda shows, one row per calendar source (Apple
 * EventKit, Google), then event options and a per-calendar selection spanning
 * both.
 *
 * Sources differ in kind, not just in wording: Apple is an OS permission the
 * user grants in System Settings (Settings on iPhone and iPad), Google is an
 * account connection the app can make and break itself. Each row is rendered
 * from `sources`, so a source this platform or build lacks says why in its
 * row instead of offering a button that cannot work.
 */

import { useEffect } from 'react';
import { Calendar, Link2, Unlink } from 'lucide-react';
import { hasNoConnectableCalendarSource, useCalendarStore } from '@/stores/calendarStore';
import type { CalendarInfo, CalendarSource } from '@/types';
import { useSettingsStore } from '@/stores';
import { Group, Row, ToggleRow, label } from '../common';
import { DotLoader } from '@/components/ui/DotLoader';
import { CalendarSyncComingSoon } from '@/components/calendar/CalendarSyncComingSoon';
import { isMobilePlatform } from '@/lib/platform';

const REFRESH_INTERVALS = [5, 15, 30, 60];

const SOURCE_LABEL: Record<CalendarSource, string> = {
  apple: 'Apple Calendar',
  google: 'Google Calendar',
};

/** Group calendars under their source so the list reads as two lists. */
function groupBySource(calendars: CalendarInfo[]): [CalendarSource, CalendarInfo[]][] {
  const order: CalendarSource[] = ['apple', 'google'];
  return order
    .map((source) => [source, calendars.filter((c) => c.source === source)] as const)
    .filter(([, list]) => list.length > 0)
    .map(([source, list]) => [source, list]);
}

export function CalendarSection() {
  const {
    isAuthorized,
    isRequestingPermission,
    permissionStatus,
    sources,
    isConnectingGoogle,
    connectError,
    calendars,
    selectedCalendarIds,
    calendarEnabled,
    showAllDayEvents,
    refreshIntervalMinutes,
    requestPermission,
    connectGoogle,
    disconnectGoogle,
    toggleCalendarSelected,
    setCalendarEnabled,
    setShowAllDayEvents,
    setRefreshIntervalMinutes,
    checkPermission,
  } = useCalendarStore();
  const settings = useSettingsStore();

  useEffect(() => {
    checkPermission();
  }, [checkPermission]);

  const mobile = isMobilePlatform();
  const apple = sources.find((s) => s.source === 'apple');
  const google = sources.find((s) => s.source === 'google');
  const anyConnected = sources.some((s) => s.available && s.connected);
  const denied = permissionStatus === 'Denied' || permissionStatus === 'Restricted';

  return (
    <div className="settings-tab">
      {/* A phone always shows the month calendar: it is how daily and weekly notes are reached. */}
      {!mobile && (
        <Group id="agenda">
          <ToggleRow
            id="month-calendar"
            value={settings.showCalendarWidget}
            onChange={settings.setShowCalendarWidget}
          />
        </Group>
      )}

      {hasNoConnectableCalendarSource(sources) ? (
        <CalendarSyncComingSoon />
      ) : (
        <Group id="accounts">
          {apple && (
            <Row
              id="apple-calendar"
              note={
                !apple.available ? (
                  (apple.error ?? 'Apple Calendar is not available here.')
                ) : isAuthorized ? (
                  <span className="settings-ok">Connected to the Calendar app</span>
                ) : denied ? (
                  <>
                    Access was denied. To allow it:
                    <ol className="list-decimal list-inside">
                      <li>Open {mobile ? 'Settings' : 'System Settings'}</li>
                      <li>Go to Privacy &amp; Security, then Calendars</li>
                      <li>
                        {mobile
                          ? 'Choose Full Access for Moldavite'
                          : 'Enable access for Moldavite'}
                      </li>
                    </ol>
                  </>
                ) : null
              }
            >
              {apple.available && !isAuthorized && !denied && (
                <button
                  onClick={() => requestPermission()}
                  disabled={isRequestingPermission}
                  className="settings-btn"
                >
                  {isRequestingPermission ? (
                    <DotLoader label="Requesting calendar permission" />
                  ) : (
                    <Calendar aria-hidden="true" className="w-4 h-4" />
                  )}
                  {isRequestingPermission ? 'Requesting...' : 'Allow access'}
                </button>
              )}
            </Row>
          )}
          <Row
            id="google-calendar"
            note={
              !google?.available ? (
                (google?.error ?? 'Google Calendar is not available in this build.')
              ) : google.connected ? (
                <span className="settings-ok">
                  Connected as {google.account ?? 'Google account'}
                </span>
              ) : (
                (connectError ?? google.error) && (
                  <span className="settings-error">{connectError ?? google.error}</span>
                )
              )
            }
          >
            {google?.available &&
              (google.connected ? (
                <button onClick={() => disconnectGoogle()} className="settings-btn">
                  <Unlink aria-hidden="true" className="w-4 h-4" />
                  Disconnect
                </button>
              ) : (
                <button
                  onClick={() => connectGoogle()}
                  disabled={isConnectingGoogle}
                  className="settings-btn"
                >
                  {isConnectingGoogle ? (
                    <DotLoader label="Connecting Google Calendar" />
                  ) : (
                    <Link2 aria-hidden="true" className="w-4 h-4" />
                  )}
                  {isConnectingGoogle
                    ? mobile
                      ? 'Waiting for Google sign-in...'
                      : 'Waiting for your browser...'
                    : 'Connect account'}
                </button>
              ))}
          </Row>
        </Group>
      )}

      {anyConnected && (
        <Group id="events">
          <ToggleRow id="show-events" value={calendarEnabled} onChange={setCalendarEnabled} />
          <ToggleRow id="all-day" value={showAllDayEvents} onChange={setShowAllDayEvents} />
          <Row id="refresh">
            <select
              value={refreshIntervalMinutes}
              onChange={(e) => setRefreshIntervalMinutes(Number(e.target.value))}
              aria-label={label('refresh')}
              className="settings-input"
            >
              {REFRESH_INTERVALS.map((minutes) => (
                <option key={minutes} value={minutes}>
                  {minutes} min
                </option>
              ))}
            </select>
          </Row>
          {calendars.length > 0 && (
            <Row
              id="calendar-list"
              stack
              note={
                selectedCalendarIds.length === 0
                  ? 'All calendars are shown. Tick any to narrow it down.'
                  : `${selectedCalendarIds.length} selected`
              }
            >
              {groupBySource(calendars).map(([source, list]) => (
                <div key={source} className="settings-calendar-group">
                  <p className="settings-row-note">{SOURCE_LABEL[source]}</p>
                  {list.map((cal) => (
                    <label key={cal.id} className="flex items-center gap-2 py-1 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={selectedCalendarIds.includes(cal.id)}
                        onChange={() => toggleCalendarSelected(cal.id)}
                      />
                      <span
                        aria-hidden="true"
                        className="settings-calendar-swatch w-2.5 h-2.5 flex-shrink-0"
                        style={{ backgroundColor: cal.color || 'var(--accent-primary)' }}
                      />
                      <span className="truncate">{cal.title}</span>
                    </label>
                  ))}
                </div>
              ))}
            </Row>
          )}
        </Group>
      )}
    </div>
  );
}

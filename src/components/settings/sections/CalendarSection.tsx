/**
 * CalendarSection — one block per calendar source (Apple EventKit, Google),
 * then display options and a per-calendar selection spanning both.
 *
 * Sources differ in kind, not just in wording: Apple is an OS permission the
 * user grants in System Settings, Google is an account connection the app can
 * make and break itself. Each block is rendered from `sources`, so a build
 * without EventKit or without Google credentials simply omits that block.
 */

import { useEffect } from 'react';
import { Calendar, Check, Link2, Lock, RefreshCw, Unlink } from 'lucide-react';
import { useCalendarStore } from '@/stores/calendarStore';
import type { CalendarInfo, CalendarSource } from '@/types';
import { Toggle } from '../common';

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

  useEffect(() => {
    checkPermission();
  }, [checkPermission]);

  const apple = sources.find((s) => s.source === 'apple');
  const google = sources.find((s) => s.source === 'google');
  const anyConnected = sources.some((s) => s.available && s.connected);
  const grouped = groupBySource(calendars);

  const panel = {
    backgroundColor: 'var(--bg-panel)',
    borderRadius: 'var(--radius-md)',
  };

  return (
    <div className="space-y-6">
      {/* Apple Calendar — OS permission, macOS only */}
      {apple?.available && (
        <div className="p-4 space-y-4" style={panel}>
          <div>
            <h3 className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
              Apple Calendar
            </h3>
            <p className="text-xs mt-0.5" style={{ color: 'var(--text-tertiary)' }}>
              Display events from Calendar.app in your timeline
            </p>
          </div>

          {isAuthorized ? (
            <div
              className="flex items-center gap-3 p-3"
              style={{
                backgroundColor: 'rgba(90, 138, 110, 0.15)',
                borderRadius: 'var(--radius-sm)',
                border: '1px solid var(--success)',
              }}
            >
              <div
                aria-hidden="true"
                className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0"
                style={{ backgroundColor: 'rgba(90, 138, 110, 0.2)' }}
              >
                <Check className="w-4 h-4" style={{ color: 'var(--success)' }} />
              </div>
              <div>
                <p className="text-sm font-medium" style={{ color: 'var(--success)' }}>
                  Calendar Access Enabled
                </p>
                <p className="text-xs" style={{ color: 'var(--success)', opacity: 0.8 }}>
                  Connected to Calendar.app
                </p>
              </div>
            </div>
          ) : permissionStatus === 'Denied' || permissionStatus === 'Restricted' ? (
            <div
              className="p-3"
              style={{
                backgroundColor: 'rgba(184, 92, 92, 0.15)',
                borderRadius: 'var(--radius-sm)',
                border: '1px solid var(--error)',
              }}
            >
              <div className="flex items-center gap-2 mb-2">
                <Lock aria-hidden="true" className="w-4 h-4" style={{ color: 'var(--error)' }} />
                <p className="text-sm font-medium" style={{ color: 'var(--error)' }}>
                  Access Denied
                </p>
              </div>
              <p className="text-xs mb-2" style={{ color: 'var(--error)', opacity: 0.9 }}>
                Calendar access was denied. To enable:
              </p>
              <ol
                className="text-xs list-decimal list-inside space-y-1"
                style={{ color: 'var(--error)', opacity: 0.9 }}
              >
                <li>Open System Settings</li>
                <li>Go to Privacy &amp; Security → Calendars</li>
                <li>Enable access for Moldavite</li>
              </ol>
            </div>
          ) : (
            <button
              onClick={() => requestPermission()}
              disabled={isRequestingPermission}
              className="w-full flex items-center justify-center gap-2 px-3 py-1.5 text-sm font-medium text-white transition-colors disabled:opacity-50"
              style={{ backgroundColor: 'var(--accent-primary)', borderRadius: 'var(--radius-sm)' }}
            >
              {isRequestingPermission ? (
                <>
                  <RefreshCw aria-hidden="true" className="w-4 h-4 animate-spin" />
                  Requesting...
                </>
              ) : (
                <>
                  <Calendar aria-hidden="true" className="w-4 h-4" />
                  Enable Calendar Access
                </>
              )}
            </button>
          )}
        </div>
      )}

      {/* Google Calendar — account connection the app owns */}
      <div className="p-4 space-y-4" style={panel}>
        <div>
          <h3 className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
            Google Calendar
          </h3>
          <p className="text-xs mt-0.5" style={{ color: 'var(--text-tertiary)' }}>
            Read-only access to your Google events. Moldavite never creates or changes them.
          </p>
        </div>

        {!google?.available ? (
          <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
            {google?.error ?? 'Google Calendar is not available in this build.'}
          </p>
        ) : google.connected ? (
          <>
            <div
              className="flex items-center gap-3 p-3"
              style={{
                backgroundColor: 'rgba(90, 138, 110, 0.15)',
                borderRadius: 'var(--radius-sm)',
                border: '1px solid var(--success)',
              }}
            >
              <div
                aria-hidden="true"
                className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0"
                style={{ backgroundColor: 'rgba(90, 138, 110, 0.2)' }}
              >
                <Check className="w-4 h-4" style={{ color: 'var(--success)' }} />
              </div>
              <div className="min-w-0">
                <p className="text-sm font-medium" style={{ color: 'var(--success)' }}>
                  Connected
                </p>
                <p className="text-xs truncate" style={{ color: 'var(--success)', opacity: 0.8 }}>
                  {google.account ?? 'Google account'}
                </p>
              </div>
            </div>
            <button
              onClick={() => disconnectGoogle()}
              className="w-full flex items-center justify-center gap-2 px-3 py-1.5 text-sm font-medium transition-colors"
              style={{
                backgroundColor: 'var(--bg-elevated)',
                border: '1px solid var(--border-default)',
                borderRadius: 'var(--radius-sm)',
                color: 'var(--text-secondary)',
              }}
            >
              <Unlink aria-hidden="true" className="w-4 h-4" />
              Disconnect
            </button>
          </>
        ) : (
          <>
            {(connectError || google.error) && (
              <p className="text-xs" style={{ color: 'var(--error)' }}>
                {connectError ?? google.error}
              </p>
            )}
            <button
              onClick={() => connectGoogle()}
              disabled={isConnectingGoogle}
              className="w-full flex items-center justify-center gap-2 px-3 py-1.5 text-sm font-medium text-white transition-colors disabled:opacity-50"
              style={{ backgroundColor: 'var(--accent-primary)', borderRadius: 'var(--radius-sm)' }}
            >
              {isConnectingGoogle ? (
                <>
                  <RefreshCw aria-hidden="true" className="w-4 h-4 animate-spin" />
                  Waiting for your browser...
                </>
              ) : (
                <>
                  <Link2 aria-hidden="true" className="w-4 h-4" />
                  Connect Google Account
                </>
              )}
            </button>
          </>
        )}
      </div>

      {anyConnected && (
        <>
          {/* Display Options */}
          <div className="p-4 space-y-1" style={panel}>
            <h3 className="text-sm font-medium mb-3" style={{ color: 'var(--text-primary)' }}>
              Display Options
            </h3>

            <div className="flex items-center justify-between py-2">
              <div>
                <span className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                  Show Calendar Events
                </span>
                <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
                  Display events in the timeline
                </p>
              </div>
              <Toggle enabled={calendarEnabled} onChange={setCalendarEnabled} />
            </div>

            <div
              className="flex items-center justify-between py-2"
              style={{ borderTop: '1px solid var(--border-muted)' }}
            >
              <div>
                <span className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                  Show All-Day Events
                </span>
                <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
                  Include events without specific times
                </p>
              </div>
              <Toggle enabled={showAllDayEvents} onChange={setShowAllDayEvents} />
            </div>

            <div
              className="flex items-center justify-between py-2"
              style={{ borderTop: '1px solid var(--border-muted)' }}
            >
              <div>
                <span className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                  Refresh Every
                </span>
                <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
                  How often connected accounts are checked for changes
                </p>
              </div>
              <select
                value={refreshIntervalMinutes}
                onChange={(e) => setRefreshIntervalMinutes(Number(e.target.value))}
                aria-label="Refresh interval"
                className="px-2 py-1 text-sm focus:outline-none focus:ring-2"
                style={{
                  backgroundColor: 'var(--bg-elevated)',
                  border: '1px solid var(--border-default)',
                  borderRadius: 'var(--radius-sm)',
                  color: 'var(--text-primary)',
                }}
              >
                {REFRESH_INTERVALS.map((minutes) => (
                  <option key={minutes} value={minutes}>
                    {minutes} min
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Calendar selection across both sources */}
          {calendars.length > 0 && (
            <div className="p-4 space-y-4" style={panel}>
              <div>
                <h3 className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                  Calendars
                </h3>
                <p className="text-xs mt-0.5" style={{ color: 'var(--text-tertiary)' }}>
                  {selectedCalendarIds.length === 0
                    ? 'All calendars are shown. Tick any to narrow it down.'
                    : `${selectedCalendarIds.length} selected`}
                </p>
              </div>

              {grouped.map(([source, list]) => (
                <div key={source} className="space-y-1">
                  <p
                    className="text-xs font-medium uppercase tracking-wide"
                    style={{ color: 'var(--text-tertiary)' }}
                  >
                    {SOURCE_LABEL[source]}
                  </p>
                  {list.map((cal) => (
                    <label
                      key={cal.id}
                      className="flex items-center gap-2 py-1 cursor-pointer text-sm"
                      style={{ color: 'var(--text-secondary)' }}
                    >
                      <input
                        type="checkbox"
                        checked={selectedCalendarIds.includes(cal.id)}
                        onChange={() => toggleCalendarSelected(cal.id)}
                      />
                      <span
                        aria-hidden="true"
                        className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                        style={{ backgroundColor: cal.color || 'var(--accent-primary)' }}
                      />
                      <span className="truncate">{cal.title}</span>
                    </label>
                  ))}
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

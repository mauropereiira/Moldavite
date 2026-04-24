/**
 * CalendarSection — macOS Calendar.app integration (permission, source, display options).
 */

import { useEffect } from 'react';
import { Calendar, Check, Lock, RefreshCw } from 'lucide-react';
import { useCalendarStore } from '@/stores/calendarStore';
import { Toggle } from '../common';

export function CalendarSection() {
  const {
    isAuthorized,
    isRequestingPermission,
    permissionStatus,
    calendars,
    selectedCalendarId,
    calendarEnabled,
    showAllDayEvents,
    requestPermission,
    fetchCalendars,
    setSelectedCalendarId,
    setCalendarEnabled,
    setShowAllDayEvents,
    checkPermission,
  } = useCalendarStore();

  const handleRequestPermission = async () => {
    await requestPermission();
  };

  // Check permission and fetch calendars on mount
  useEffect(() => {
    checkPermission();
  }, [checkPermission]);

  // Fetch calendars when authorized
  useEffect(() => {
    if (isAuthorized && calendars.length === 0) {
      fetchCalendars();
    }
  }, [isAuthorized, calendars.length, fetchCalendars]);

  return (
    <div className="space-y-6">
      {/* Permission Status Section */}
      <div className="p-4 space-y-4" style={{ backgroundColor: 'var(--bg-panel)', borderRadius: 'var(--radius-md)' }}>
        <div>
          <h3 className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
            Calendar Access
          </h3>
          <p className="text-xs mt-0.5" style={{ color: 'var(--text-tertiary)' }}>
            Display events from Calendar.app in your timeline
          </p>
        </div>

        {isAuthorized ? (
          <div className="flex items-center gap-3 p-3" style={{ backgroundColor: 'rgba(90, 138, 110, 0.15)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--success)' }}>
            <div aria-hidden="true" className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0" style={{ backgroundColor: 'rgba(90, 138, 110, 0.2)' }}>
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
          <div className="p-3" style={{ backgroundColor: 'rgba(184, 92, 92, 0.15)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--error)' }}>
            <div className="flex items-center gap-2 mb-2">
              <Lock aria-hidden="true" className="w-4 h-4" style={{ color: 'var(--error)' }} />
              <p className="text-sm font-medium" style={{ color: 'var(--error)' }}>
                Access Denied
              </p>
            </div>
            <p className="text-xs mb-2" style={{ color: 'var(--error)', opacity: 0.9 }}>
              Calendar access was denied. To enable:
            </p>
            <ol className="text-xs list-decimal list-inside space-y-1" style={{ color: 'var(--error)', opacity: 0.9 }}>
              <li>Open System Settings</li>
              <li>Go to Privacy & Security → Calendars</li>
              <li>Enable access for Moldavite</li>
            </ol>
          </div>
        ) : (
          <button
            onClick={handleRequestPermission}
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

      {/* Calendar Settings (only show when authorized) */}
      {isAuthorized && (
        <>
          {/* Display Options Section */}
          <div className="p-4 space-y-1" style={{ backgroundColor: 'var(--bg-panel)', borderRadius: 'var(--radius-md)' }}>
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
              <Toggle
                enabled={calendarEnabled}
                onChange={setCalendarEnabled}
              />
            </div>

            <div className="flex items-center justify-between py-2" style={{ borderTop: '1px solid var(--border-muted)' }}>
              <div>
                <span className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                  Show All-Day Events
                </span>
                <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
                  Include events without specific times
                </p>
              </div>
              <Toggle
                enabled={showAllDayEvents}
                onChange={setShowAllDayEvents}
              />
            </div>
          </div>

          {/* Calendar Selection */}
          {calendars.length > 0 && (
            <div className="p-4 space-y-4" style={{ backgroundColor: 'var(--bg-panel)', borderRadius: 'var(--radius-md)' }}>
              <div>
                <h3 className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                  Calendar Source
                </h3>
                <p className="text-xs mt-0.5" style={{ color: 'var(--text-tertiary)' }}>
                  Choose which calendar to display
                </p>
              </div>
              <select
                value={selectedCalendarId || ''}
                onChange={(e) => setSelectedCalendarId(e.target.value || null)}
                className="w-full px-3 py-2 text-sm focus:outline-none focus:ring-2"
                style={{
                  backgroundColor: 'var(--bg-elevated)',
                  border: '1px solid var(--border-default)',
                  borderRadius: 'var(--radius-sm)',
                  color: 'var(--text-primary)',
                }}
              >
                <option value="">All Calendars</option>
                {calendars.map((cal) => (
                  <option key={cal.id} value={cal.id}>
                    {cal.title}
                  </option>
                ))}
              </select>
            </div>
          )}
        </>
      )}
    </div>
  );
}

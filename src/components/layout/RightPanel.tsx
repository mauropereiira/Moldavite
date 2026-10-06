import { Calendar } from '../calendar/Calendar';
import { Timeline } from '../calendar/Timeline';
import { useCalendarStore, useSettingsStore } from '@/stores';

export function RightPanel() {
  const showCalendarWidget = useSettingsStore((state) => state.showCalendarWidget);
  const calendarEnabled = useCalendarStore((state) => state.calendarEnabled);

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden">
      {showCalendarWidget && (
        <div
          className="min-w-0 overflow-hidden px-5 py-5"
          style={{ borderBottom: '1px solid var(--border-muted)' }}
        >
          <Calendar />
        </div>
      )}

      {calendarEnabled && (
        <div className="flex min-h-0 flex-1 overflow-hidden">
          <Timeline />
        </div>
      )}

      {!showCalendarWidget && !calendarEnabled && (
        <div className="flex-1 flex items-center justify-center p-4">
          <p className="text-sm text-center" style={{ color: 'var(--text-muted)' }}>
            Turn on Month calendar or Show events in Settings → Calendar
          </p>
        </div>
      )}
    </div>
  );
}

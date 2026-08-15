import { Calendar } from '../calendar/Calendar';
import { Timeline } from '../calendar/Timeline';
import { useSettingsStore } from '@/stores';

export function RightPanel() {
  const { showCalendarWidget, showTimelineWidget } = useSettingsStore();

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden">
      {/* Calendar */}
      {showCalendarWidget && (
        <div
          className="min-w-0 overflow-hidden px-5 py-5"
          style={{ borderBottom: '1px solid var(--border-muted)' }}
        >
          <Calendar />
        </div>
      )}

      {/* Timeline */}
      {showTimelineWidget && (
        <div className="flex min-h-0 flex-1 overflow-hidden">
          <Timeline />
        </div>
      )}

      {/* Empty state if both disabled */}
      {!showCalendarWidget && !showTimelineWidget && (
        <div className="flex-1 flex items-center justify-center p-4">
          <p className="text-sm text-center" style={{ color: 'var(--text-muted)' }}>
            Enable calendar or timeline in Settings
          </p>
        </div>
      )}
    </div>
  );
}

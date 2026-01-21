import { Calendar } from '../calendar/Calendar';
import { Timeline } from '../calendar/Timeline';
import { useSettingsStore } from '@/stores';

export function RightPanel() {
  const { showCalendarWidget, showTimelineWidget } = useSettingsStore();

  return (
    <div className="flex flex-col h-full">
      {/* Calendar */}
      {showCalendarWidget && (
        <div className="p-4" style={{ borderBottom: '1px solid var(--border-default)' }}>
          <Calendar />
        </div>
      )}

      {/* Timeline */}
      {showTimelineWidget && (
        <div className="flex-1 overflow-y-auto">
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

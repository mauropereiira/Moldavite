import { Calendar } from '../calendar/Calendar';
import { DayChanges } from '../calendar/DayChanges';
import { DayEvents } from '../calendar/DayEvents';
import { useSettingsStore } from '@/stores';

export function RightPanel() {
  const showCalendarWidget = useSettingsStore((state) => state.showCalendarWidget);

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

      {/* Capped so a long day of events cannot push the changes out of the panel. */}
      <div className="min-w-0 flex-shrink-0 overflow-y-auto px-5 pt-4" style={{ maxHeight: '40%' }}>
        <DayEvents />
      </div>

      <section
        aria-label="Changed on this day"
        className="flex min-h-0 min-w-0 flex-1 flex-col px-5 py-4"
      >
        <DayChanges />
      </section>
    </div>
  );
}

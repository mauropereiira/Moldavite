import { Calendar } from '../calendar/Calendar';
import { Timeline } from '../calendar/Timeline';

export function RightPanel() {
  return (
    <div className="flex flex-col h-full">
      {/* Calendar */}
      <div className="p-4" style={{ borderBottom: '1px solid var(--border-default)' }}>
        <Calendar />
      </div>

      {/* Timeline */}
      <Timeline />
    </div>
  );
}

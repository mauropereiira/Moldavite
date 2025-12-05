import React from 'react';
import { Calendar } from '../calendar/Calendar';
import { Timeline } from '../calendar/Timeline';

export function RightPanel() {
  return (
    <div className="flex flex-col h-full">
      {/* Calendar */}
      <div className="p-4 border-b border-gray-200 dark:border-gray-700">
        <Calendar />
      </div>

      {/* Timeline */}
      <Timeline />
    </div>
  );
}

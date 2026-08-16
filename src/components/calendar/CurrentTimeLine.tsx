import { useState, useEffect } from 'react';
import { localDayInterval, MILLISECONDS_PER_HOUR } from './timeLayout';

const HOUR_HEIGHT = 60; // pixels per hour

interface CurrentTimeLineProps {
  isToday: boolean;
  dayStart?: Date;
}

export function CurrentTimeLine({ isToday, dayStart }: CurrentTimeLineProps) {
  const [currentTime, setCurrentTime] = useState(new Date());

  // Update current time every minute
  useEffect(() => {
    if (!isToday) return;

    const interval = setInterval(() => {
      setCurrentTime(new Date());
    }, 60000); // Update every minute

    return () => clearInterval(interval);
  }, [isToday]);

  if (!isToday) return null;

  const start = dayStart ?? localDayInterval(currentTime).start;
  const topPosition =
    ((currentTime.getTime() - start.getTime()) / MILLISECONDS_PER_HOUR) * HOUR_HEIGHT;

  return (
    <div
      className="absolute left-0 right-0 z-20 pointer-events-none"
      style={{ top: `${topPosition}px` }}
    >
      {/* A single ink rule marks the current time without adding a coloured badge. */}
      <div
        className="absolute h-px"
        style={{ left: '60px', right: '0', backgroundColor: 'var(--text-primary)' }}
      />
    </div>
  );
}

export { HOUR_HEIGHT };

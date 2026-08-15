import { useState, useEffect } from 'react';

const HOUR_HEIGHT = 60; // pixels per hour

interface CurrentTimeLineProps {
  isToday: boolean;
}

export function CurrentTimeLine({ isToday }: CurrentTimeLineProps) {
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

  const hours = currentTime.getHours();
  const minutes = currentTime.getMinutes();
  const topPosition = hours * HOUR_HEIGHT + (minutes * HOUR_HEIGHT) / 60;

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

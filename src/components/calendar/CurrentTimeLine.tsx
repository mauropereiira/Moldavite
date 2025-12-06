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
  const topPosition = (hours * HOUR_HEIGHT) + (minutes * HOUR_HEIGHT / 60);

  return (
    <div
      className="absolute left-0 right-0 z-20 pointer-events-none"
      style={{ top: `${topPosition}px` }}
    >
      {/* Red circle on the left */}
      <div
        className="absolute w-2 h-2 bg-red-500 rounded-full"
        style={{ left: '56px', top: '-3px' }}
      />
      {/* Red horizontal line */}
      <div
        className="absolute h-0.5 bg-red-500"
        style={{ left: '60px', right: '0' }}
      />
    </div>
  );
}

export { HOUR_HEIGHT };

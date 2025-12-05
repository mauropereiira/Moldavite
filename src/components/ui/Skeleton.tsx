import React from 'react';

interface SkeletonProps {
  className?: string;
  variant?: 'text' | 'circular' | 'rectangular';
  width?: string | number;
  height?: string | number;
}

export function Skeleton({
  className = '',
  variant = 'text',
  width,
  height,
}: SkeletonProps) {
  const baseClasses = 'skeleton';
  const variantClasses = {
    text: 'rounded',
    circular: 'rounded-full',
    rectangular: 'rounded-md',
  };

  const style: React.CSSProperties = {
    width: width || (variant === 'text' ? '100%' : undefined),
    height: height || (variant === 'text' ? '1em' : undefined),
  };

  return (
    <div
      className={`${baseClasses} ${variantClasses[variant]} ${className}`}
      style={style}
    />
  );
}

// Pre-built skeleton layouts
export function NoteSkeleton() {
  return (
    <div className="p-2 space-y-2">
      {[1, 2, 3, 4, 5].map((i) => (
        <div key={i} className="flex items-center gap-2">
          <Skeleton variant="circular" width={8} height={8} />
          <Skeleton variant="text" height={16} className="flex-1" />
        </div>
      ))}
    </div>
  );
}

export function EditorSkeleton() {
  return (
    <div className="p-6 space-y-4">
      {/* Title */}
      <Skeleton variant="text" height={32} width="60%" />

      {/* Paragraphs */}
      <div className="space-y-2">
        <Skeleton variant="text" height={16} />
        <Skeleton variant="text" height={16} />
        <Skeleton variant="text" height={16} width="80%" />
      </div>

      <div className="space-y-2 pt-2">
        <Skeleton variant="text" height={16} />
        <Skeleton variant="text" height={16} width="90%" />
      </div>

      <div className="space-y-2 pt-2">
        <Skeleton variant="text" height={16} />
        <Skeleton variant="text" height={16} />
        <Skeleton variant="text" height={16} width="70%" />
      </div>
    </div>
  );
}

export function TimelineSkeleton() {
  return (
    <div className="space-y-3">
      {[1, 2, 3].map((i) => (
        <div key={i} className="flex items-start gap-2 p-2">
          <Skeleton variant="circular" width={8} height={8} className="mt-1.5" />
          <div className="flex-1 space-y-1">
            <Skeleton variant="text" height={12} width={60} />
            <Skeleton variant="text" height={16} width="80%" />
          </div>
        </div>
      ))}
    </div>
  );
}

export function CalendarEventSkeleton() {
  return (
    <div className="space-y-2 p-2">
      {[1, 2, 3, 4].map((i) => (
        <div
          key={i}
          className="rounded-md p-3 bg-gray-100 dark:bg-gray-800"
          style={{ '--index': i - 1 } as React.CSSProperties}
        >
          <Skeleton variant="text" height={10} width={40} className="mb-1" />
          <Skeleton variant="text" height={14} width="70%" />
        </div>
      ))}
    </div>
  );
}

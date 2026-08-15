import type { CSSProperties } from 'react';

interface DotLoaderProps {
  grid?: 3 | 4;
  size?: number;
  label?: string;
  className?: string;
}

/** A quiet, currentColor loading indicator for inline and button states. */
export function DotLoader({
  grid = 3,
  size = 2,
  label = 'Loading',
  className = '',
}: DotLoaderProps) {
  const gap = Math.max(2, Math.round(size * 1.5));
  const dots = Array.from({ length: grid * grid }, (_, index) => index);

  return (
    <span
      role="status"
      aria-label={label}
      className={`dot-loader ${className}`.trim()}
      style={
        {
          '--dot-loader-grid': grid,
          '--dot-loader-size': `${size}px`,
          '--dot-loader-gap': `${gap}px`,
        } as CSSProperties
      }
    >
      {dots.map((index) => (
        <span
          key={index}
          aria-hidden="true"
          className="dot-loader-dot"
          style={{ '--dot-loader-index': index } as CSSProperties}
        />
      ))}
    </span>
  );
}

/**
 * InfoTooltip — small (i) info icon that shows an explanatory popover on hover/focus.
 */

import { useState } from 'react';
import { Info } from 'lucide-react';

export interface InfoTooltipProps {
  text: string;
}

export function InfoTooltip({ text }: InfoTooltipProps) {
  const [isVisible, setIsVisible] = useState(false);

  return (
    <div className="relative inline-flex items-center ml-1.5">
      <button
        type="button"
        className="p-0.5 rounded-full transition-all duration-200"
        style={{
          color: 'var(--text-muted)',
          backgroundColor: 'transparent',
        }}
        onMouseEnter={(e) => {
          setIsVisible(true);
          e.currentTarget.style.color = 'var(--accent-primary)';
          e.currentTarget.style.backgroundColor = 'var(--accent-subtle)';
          e.currentTarget.style.transform = 'scale(1.1)';
        }}
        onMouseLeave={(e) => {
          setIsVisible(false);
          e.currentTarget.style.color = 'var(--text-muted)';
          e.currentTarget.style.backgroundColor = 'transparent';
          e.currentTarget.style.transform = 'scale(1)';
        }}
        onFocus={() => setIsVisible(true)}
        onBlur={() => setIsVisible(false)}
        aria-label="More information"
      >
        <Info aria-hidden="true" className="w-3.5 h-3.5" />
      </button>
      {isVisible && (
        <div
          className="absolute z-50 px-3 py-2 text-xs max-w-[320px] whitespace-normal"
          style={{
            top: 'calc(100% + 8px)',
            left: '50%',
            transform: 'translateX(-50%)',
            backgroundColor: 'var(--bg-elevated)',
            border: '1px solid var(--border-default)',
            borderRadius: 'var(--radius-md)',
            boxShadow: 'var(--shadow-lg)',
            color: 'var(--text-secondary)',
            animation: 'tooltipFadeInBelow 0.15s ease-out',
          }}
        >
          {text}
          <div
            className="absolute w-2 h-2"
            style={{
              top: '-5px',
              left: '50%',
              transform: 'translateX(-50%) rotate(45deg)',
              backgroundColor: 'var(--bg-elevated)',
              borderLeft: '1px solid var(--border-default)',
              borderTop: '1px solid var(--border-default)',
            }}
          />
        </div>
      )}
    </div>
  );
}

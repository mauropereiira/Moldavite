import React from 'react';
import { ChevronRight } from 'lucide-react';

interface CollapsibleSectionProps {
  title: string;
  isCollapsed: boolean;
  onToggle: () => void;
  rightAction?: React.ReactNode;
  children: React.ReactNode;
  count?: number;
  icon?: React.ReactNode;
}

export function CollapsibleSection({
  title,
  isCollapsed,
  onToggle,
  rightAction,
  children,
  count,
  icon,
}: CollapsibleSectionProps) {
  return (
    <div className="flex flex-col">
      <div className="flex items-center justify-between px-3 py-2">
        <button
          onClick={onToggle}
          className="flex items-center gap-1.5 text-xs font-semibold transition-colors group"
          style={{ color: 'var(--text-secondary)' }}
          onMouseEnter={(e) => {
            e.currentTarget.style.color = 'var(--text-primary)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.color = 'var(--text-secondary)';
          }}
        >
          <ChevronRight
            className={`w-3.5 h-3.5 transition-transform ${
              isCollapsed ? '' : 'rotate-90'
            }`}
            style={{
              color: 'var(--text-tertiary)',
              transitionDuration: '200ms',
              transitionTimingFunction: 'cubic-bezier(0.34, 1.56, 0.64, 1)',
            }}
          />
          {icon && <span className="flex-shrink-0">{icon}</span>}
          <span>{title}</span>
          {count !== undefined && (
            <span
              className="ml-1 px-1.5 py-0.5 text-[10px]"
              style={{
                color: 'var(--text-muted)',
                backgroundColor: 'var(--count-badge-bg)',
                borderRadius: 'var(--radius-sm)',
              }}
            >
              {count}
            </span>
          )}
        </button>
        {rightAction && !isCollapsed && (
          <div className="flex items-center">{rightAction}</div>
        )}
      </div>
      <div
        className={`overflow-hidden ${
          isCollapsed ? 'max-h-0 opacity-0' : 'max-h-[2000px] opacity-100'
        }`}
        style={{
          transition: 'max-height 250ms cubic-bezier(0.16, 1, 0.3, 1), opacity 200ms ease',
        }}
      >
        {children}
      </div>
    </div>
  );
}

import React from 'react';

interface CollapsibleSectionProps {
  title: string;
  isCollapsed: boolean;
  onToggle: () => void;
  rightAction?: React.ReactNode;
  children: React.ReactNode;
  count?: number;
}

export function CollapsibleSection({
  title,
  isCollapsed,
  onToggle,
  rightAction,
  children,
  count,
}: CollapsibleSectionProps) {
  return (
    <div className="flex flex-col">
      <div className="section-header mx-3">
        <button
          onClick={onToggle}
          className="flex min-w-0 items-center gap-2 text-left transition-colors"
          style={{ color: 'inherit' }}
          onMouseEnter={(e) => {
            e.currentTarget.style.color = 'var(--text-primary)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.color = '';
          }}
          aria-expanded={!isCollapsed}
        >
          <span
            aria-hidden="true"
            className={`sidebar-caret ${isCollapsed ? '' : 'sidebar-caret-expanded'}`}
          />
          <span>{title}</span>
        </button>
        <div className="ml-auto flex items-center gap-2">
          {rightAction && !isCollapsed && <div className="flex items-center">{rightAction}</div>}
          {count !== undefined && <span className="count-badge">{count}</span>}
        </div>
      </div>
      <div
        className={`overflow-hidden ${
          isCollapsed ? 'max-h-0 opacity-0' : 'max-h-[2000px] opacity-100'
        }`}
        style={{
          transform: isCollapsed ? 'translateY(-4px)' : 'translateY(0)',
          transition:
            'opacity var(--dur-base) var(--ease-standard), transform var(--dur-base) var(--ease-standard)',
        }}
      >
        <div className="pt-2">{children}</div>
      </div>
    </div>
  );
}

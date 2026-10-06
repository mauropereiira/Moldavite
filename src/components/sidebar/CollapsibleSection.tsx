import React from 'react';
import { useAutumnArt } from '@/lib/seasons';
import { SECTION_ICONS } from '@/components/ui/SeasonalIcons';

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
  const autumnArt = useAutumnArt();
  const SectionIcon = autumnArt ? SECTION_ICONS[title] : undefined;
  // A card in the Index and a band across the pinned column: the header is a
  // filled strip holding the toggle, the count and the section's actions.
  return (
    <section className="index-section flex flex-col" data-collapsed={isCollapsed || undefined}>
      <div className="section-header section-band">
        <button
          onClick={onToggle}
          className="section-toggle flex min-w-0 items-center gap-2 text-left transition-colors"
          aria-expanded={!isCollapsed}
        >
          <span
            aria-hidden="true"
            className={`sidebar-caret ${isCollapsed ? '' : 'sidebar-caret-expanded'}`}
          />
          {SectionIcon && <SectionIcon className="seasonal-section-icon" />}
          <span className="section-title truncate">{title}</span>
        </button>
        {count !== undefined && <span className="count-badge section-count">{count}</span>}
        {rightAction && !isCollapsed && (
          <div className="section-actions flex items-center">{rightAction}</div>
        )}
      </div>
      <div
        hidden={isCollapsed}
        className={`section-panel overflow-hidden ${isCollapsed ? 'opacity-0' : 'opacity-100'}`}
        style={{
          transform: isCollapsed ? 'translateY(-4px)' : 'translateY(0)',
          transition:
            'opacity var(--dur-base) var(--ease-standard), transform var(--dur-base) var(--ease-standard)',
        }}
      >
        <div className="section-body">{children}</div>
      </div>
    </section>
  );
}

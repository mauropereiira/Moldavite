import type { Template } from '@/types/template';
import { TemplateIcon } from './TemplateIcon';

interface TemplateCardProps {
  template: Template;
  onClick: () => void;
  selected?: boolean;
  compact?: boolean;
}

export function TemplateCard({
  template,
  onClick,
  selected = false,
  compact = false,
}: TemplateCardProps) {
  return (
    <button
      onClick={onClick}
      className={`
        w-full text-left rounded transition-all focus-ring
        ${compact ? 'p-3' : 'p-4'}
        ${selected ? 'border-2' : 'border'}
        hover:shadow-system-md
        btn-interactive
      `}
      style={{
        backgroundColor: selected ? 'var(--accent-subtle)' : 'var(--bg-elevated)',
        borderColor: selected ? 'var(--accent-color)' : 'var(--border-primary)',
      }}
    >
      {/* Icon */}
      <div
        className={compact ? 'mb-2' : 'mb-3'}
        style={{ color: selected ? 'var(--accent-color)' : 'var(--text-muted)' }}
      >
        <TemplateIcon
          icon={template.icon}
          size={compact ? 24 : 32}
          className="transition-colors"
        />
      </div>

      {/* Name */}
      <h3
        className={`font-semibold truncate ${compact ? 'text-sm' : 'text-base'}`}
        style={{ color: 'var(--text-primary)' }}
      >
        {template.name}
      </h3>

      {/* Description */}
      {!compact && template.description && (
        <p className="text-sm mt-1 line-clamp-2" style={{ color: 'var(--text-secondary)' }}>
          {template.description}
        </p>
      )}

      {/* Default badge */}
      {template.isDefault && (
        <span
          className={`
            inline-block px-2 py-0.5 rounded-full text-xs font-medium
            bg-accent-subtle dark:bg-moldavite-600 text-accent-dark dark:text-moldavite-100
            ${compact ? 'mt-1' : 'mt-2'}
          `}
        >
          Default
        </span>
      )}
    </button>
  );
}

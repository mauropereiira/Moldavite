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
        w-full text-left transition-all focus-ring border
        ${compact ? 'p-3' : 'p-4'}
        btn-interactive
      `}
      style={{
        backgroundColor: 'transparent',
        borderColor: selected ? 'var(--border-strong)' : 'var(--border-default)',
      }}
    >
      {/* Icon */}
      <div
        className={compact ? 'mb-2' : 'mb-3'}
        style={{ color: selected ? 'var(--text-primary)' : 'var(--text-muted)' }}
      >
        <TemplateIcon icon={template.icon} size={compact ? 24 : 32} className="transition-colors" />
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
          className={`inline-block px-2 py-0.5 text-xs font-medium ${compact ? 'mt-1' : 'mt-2'}`}
          style={{
            backgroundColor: 'transparent',
            border: '1px solid var(--border-default)',
            color: 'var(--text-secondary)',
          }}
        >
          Default
        </span>
      )}
    </button>
  );
}

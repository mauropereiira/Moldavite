import React from 'react';
import { useTemplateStore } from '@/stores/templateStore';
import { TemplateCard } from './TemplateCard';

interface EmptyNoteTemplatePickerProps {
  onSelectTemplate: (templateId: string) => void;
  onOpenAllTemplates?: () => void;
}

export function EmptyNoteTemplatePicker({
  onSelectTemplate,
  onOpenAllTemplates,
}: EmptyNoteTemplatePickerProps) {
  const { templates, pinnedTemplateIds } = useTemplateStore();

  // Show pinned templates if any, otherwise fall back to first 3
  const displayTemplates = pinnedTemplateIds.length > 0
    ? templates.filter(t => pinnedTemplateIds.includes(t.id)).slice(0, 6)
    : templates.slice(0, 3);

  if (templates.length === 0) {
    return null;
  }

  // Don't show if no pinned templates and user has explicitly cleared them
  // (pinnedTemplateIds would be empty array vs undefined)
  if (displayTemplates.length === 0) {
    return null;
  }

  return (
    <div className="content-enter max-w-md mx-auto text-center py-8 px-4">
      <h3 className="text-sm font-medium mb-4" style={{ color: 'var(--text-tertiary)' }}>
        Start with a template
      </h3>

      <div className="grid grid-cols-3 gap-2 mb-4">
        {displayTemplates.map((template, index) => (
          <div
            key={template.id}
            className="list-item-stagger"
            style={{ '--index': index } as React.CSSProperties}
          >
            <TemplateCard
              template={template}
              onClick={() => onSelectTemplate(template.id)}
              compact
            />
          </div>
        ))}
      </div>

      {onOpenAllTemplates && (
        <button
          onClick={onOpenAllTemplates}
          className="px-4 py-1.5 text-xs font-medium rounded-full transition-colors bg-accent dark:bg-accent-dark text-white hover:bg-accent-light dark:hover:bg-accent"
        >
          View all templates
        </button>
      )}
      <p className="text-xs mt-3" style={{ color: 'var(--text-muted)' }}>
        or press <kbd className="px-2 py-0.5 rounded-full text-xs font-medium bg-moldavite-200 dark:bg-moldavite-700 text-moldavite-700 dark:text-moldavite-200">Cmd+T</kbd>
      </p>
    </div>
  );
}

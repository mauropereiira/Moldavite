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
  const { templates } = useTemplateStore();

  // Show only first 3 templates for compact view
  const displayTemplates = templates.slice(0, 3);

  if (templates.length === 0) {
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
          className="px-4 py-1.5 text-xs font-medium rounded-full transition-colors bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600"
        >
          View all templates
        </button>
      )}
      <p className="text-xs mt-3" style={{ color: 'var(--text-muted)' }}>
        or press <kbd className="px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300">Cmd+T</kbd>
      </p>
    </div>
  );
}

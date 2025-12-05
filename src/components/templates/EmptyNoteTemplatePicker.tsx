import React from 'react';
import { useTemplateStore } from '@/stores/templateStore';
import { TemplateCard } from './TemplateCard';

interface EmptyNoteTemplatePickerProps {
  onSelectTemplate: (templateId: string) => void;
}

export function EmptyNoteTemplatePicker({
  onSelectTemplate,
}: EmptyNoteTemplatePickerProps) {
  const { templates } = useTemplateStore();

  // Show only first 3 templates for compact view
  const displayTemplates = templates.slice(0, 3);

  if (templates.length === 0) {
    return null;
  }

  return (
    <div className="content-enter max-w-md mx-auto text-center py-8 px-4">
      <h3 className="text-sm font-medium text-gray-600 dark:text-gray-400 mb-4">
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

      <p className="text-xs text-gray-400 dark:text-gray-500">
        or press <kbd className="px-1.5 py-0.5 bg-gray-100 dark:bg-gray-700 rounded text-gray-600 dark:text-gray-300">Cmd+T</kbd> for all templates
      </p>
    </div>
  );
}

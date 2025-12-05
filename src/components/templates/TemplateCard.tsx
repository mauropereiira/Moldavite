import React from 'react';
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
        w-full text-left rounded-lg transition-all focus-ring
        ${compact ? 'p-3' : 'p-4'}
        ${
          selected
            ? 'bg-blue-50 dark:bg-blue-900/30 border-2 border-blue-500 dark:border-blue-400'
            : 'bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600'
        }
        hover:shadow-system-md
        btn-interactive
      `}
    >
      {/* Icon */}
      <div
        className={`
          ${compact ? 'mb-2' : 'mb-3'}
          ${selected ? 'text-blue-600 dark:text-blue-400' : 'text-gray-400 dark:text-gray-500'}
        `}
      >
        <TemplateIcon
          icon={template.icon}
          size={compact ? 24 : 32}
          className="transition-colors"
        />
      </div>

      {/* Name */}
      <h3
        className={`
          font-semibold text-gray-900 dark:text-white truncate
          ${compact ? 'text-sm' : 'text-base'}
        `}
      >
        {template.name}
      </h3>

      {/* Description */}
      {!compact && template.description && (
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1 line-clamp-2">
          {template.description}
        </p>
      )}

      {/* Default badge */}
      {template.isDefault && (
        <span
          className={`
            inline-block px-2 py-0.5 rounded-full text-xs font-medium
            bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300
            ${compact ? 'mt-1' : 'mt-2'}
          `}
        >
          Default
        </span>
      )}
    </button>
  );
}

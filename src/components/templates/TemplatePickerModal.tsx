import React, { useState, useMemo, useEffect, useRef } from 'react';
import { X, Search, AlertCircle, RefreshCw } from 'lucide-react';
import { useTemplateStore } from '@/stores/templateStore';
import { useTemplates } from '@/hooks/useTemplates';
import { TemplateCard } from './TemplateCard';

interface TemplatePickerModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelect: (templateId: string | null) => void;
  title?: string;
}

export function TemplatePickerModal({
  isOpen,
  onClose,
  onSelect,
  title = 'Choose a Template',
}: TemplatePickerModalProps) {
  const searchInputRef = useRef<HTMLInputElement>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const { templates, isLoading } = useTemplateStore();
  const { loadError, loadTemplates } = useTemplates();

  const filteredTemplates = useMemo(() => {
    if (!searchQuery.trim()) return templates;

    const query = searchQuery.toLowerCase();
    return templates.filter(
      (t) =>
        t.name.toLowerCase().includes(query) ||
        t.description.toLowerCase().includes(query)
    );
  }, [templates, searchQuery]);

  // Focus search input when modal opens
  useEffect(() => {
    if (isOpen && searchInputRef.current) {
      // Small delay to ensure modal is rendered
      setTimeout(() => searchInputRef.current?.focus(), 100);
    }
  }, [isOpen]);

  const handleSelect = (templateId: string) => {
    onSelect(templateId);
    onClose();
    setSearchQuery('');
  };

  const handleBlankNote = () => {
    onSelect(null);
    onClose();
    setSearchQuery('');
  };

  const handleClose = () => {
    onClose();
    setSearchQuery('');
  };

  // Handle keyboard navigation
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      handleClose();
    }
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 modal-backdrop-dark flex items-center justify-center z-50 modal-backdrop-enter"
      onClick={(e) => e.target === e.currentTarget && handleClose()}
      onKeyDown={handleKeyDown}
      role="dialog"
      aria-modal="true"
      aria-labelledby="template-picker-title"
    >
      <div className="bg-white dark:bg-gray-800 rounded-md w-full max-w-2xl mx-4 max-h-[80vh] flex flex-col modal-elevated modal-content-enter">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 dark:border-gray-700">
          <h2 id="template-picker-title" className="text-xl font-semibold text-gray-900 dark:text-white">
            {title}
          </h2>
          <button
            onClick={handleClose}
            className="p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 rounded focus-ring"
            aria-label="Close template picker"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Search */}
        <div className="px-6 py-3 border-b border-gray-200 dark:border-gray-700">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              ref={searchInputRef}
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search templates..."
              className="w-full pl-9 pr-4 py-2 text-sm rounded bg-gray-50 dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 search-input-polished focus:outline-none"
              aria-label="Search templates"
            />
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {loadError ? (
            // Error state with retry
            <div className="text-center py-12">
              <AlertCircle className="w-12 h-12 mx-auto text-red-400 dark:text-red-500 mb-4" />
              <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-2">
                Failed to load templates
              </h3>
              <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
                {loadError}
              </p>
              <button
                onClick={() => loadTemplates()}
                className="inline-flex items-center gap-2 px-3 py-1.5 text-sm font-medium text-white rounded btn-primary-gradient btn-elevated focus-ring"
              >
                <RefreshCw className="w-4 h-4" />
                Retry
              </button>
            </div>
          ) : isLoading ? (
            // Loading skeleton
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {[1, 2, 3, 4, 5, 6].map((i) => (
                <div
                  key={i}
                  className="p-4 rounded border border-gray-200 dark:border-gray-700"
                >
                  <div className="skeleton w-8 h-8 rounded mb-3" />
                  <div className="skeleton h-4 w-3/4 mb-2" />
                  <div className="skeleton h-3 w-full" />
                </div>
              ))}
            </div>
          ) : filteredTemplates.length === 0 ? (
            // Empty state
            <div className="text-center py-12">
              <Search className="w-12 h-12 mx-auto text-gray-300 dark:text-gray-600 mb-4" />
              <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-2">
                No templates found
              </h3>
              <p className="text-sm text-gray-500 dark:text-gray-400">
                {searchQuery
                  ? `No results for "${searchQuery}"`
                  : 'Create your first template to get started'}
              </p>
            </div>
          ) : (
            // Template grid
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {/* Blank Note option */}
              {!searchQuery && (
                <div className="list-item-stagger" style={{ '--index': 0 } as React.CSSProperties}>
                  <button
                    onClick={handleBlankNote}
                    className="w-full p-4 rounded border-2 border-dashed border-gray-300 dark:border-gray-600 hover:border-blue-500 dark:hover:border-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-colors text-left group"
                  >
                    <div className="w-8 h-8 mb-3 rounded bg-gray-100 dark:bg-gray-700 flex items-center justify-center text-gray-400 dark:text-gray-500 group-hover:text-blue-500 dark:group-hover:text-blue-400">
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                      </svg>
                    </div>
                    <h3 className="font-medium text-sm text-gray-900 dark:text-white mb-1">
                      Blank Note
                    </h3>
                    <p className="text-xs text-gray-500 dark:text-gray-400">
                      Start from scratch
                    </p>
                  </button>
                </div>
              )}
              {filteredTemplates.map((template, index) => (
                <div
                  key={template.id}
                  className="list-item-stagger"
                  style={{ '--index': searchQuery ? index : index + 1 } as React.CSSProperties}
                >
                  <TemplateCard
                    template={template}
                    onClick={() => handleSelect(template.id)}
                  />
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

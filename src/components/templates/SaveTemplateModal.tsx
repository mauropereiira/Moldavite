import React, { useState, useEffect, useRef } from 'react';
import { X, Loader2 } from 'lucide-react';
import { TemplateIcon, availableIcons } from './TemplateIcon';
import { useTemplates } from '@/hooks/useTemplates';
import { useToast } from '@/hooks/useToast';

interface SaveTemplateModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialContent: string;
  onSaved?: () => void;
}

const MAX_NAME_LENGTH = 100;
const MAX_DESCRIPTION_LENGTH = 200;

export function SaveTemplateModal({
  isOpen,
  onClose,
  initialContent,
  onSaved,
}: SaveTemplateModalProps) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [icon, setIcon] = useState('blank');
  const [error, setError] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  const { saveNewTemplate } = useTemplates();
  const toast = useToast();
  const nameInputRef = useRef<HTMLInputElement>(null);

  // Focus name input when modal opens
  useEffect(() => {
    if (isOpen && nameInputRef.current) {
      setTimeout(() => nameInputRef.current?.focus(), 100);
    }
  }, [isOpen]);

  const validateForm = (): string | null => {
    const trimmedName = name.trim();

    if (!trimmedName) {
      return 'Template name is required';
    }

    if (trimmedName.length > MAX_NAME_LENGTH) {
      return `Template name must be ${MAX_NAME_LENGTH} characters or less`;
    }

    if (description.length > MAX_DESCRIPTION_LENGTH) {
      return `Description must be ${MAX_DESCRIPTION_LENGTH} characters or less`;
    }

    return null;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    const validationError = validateForm();
    if (validationError) {
      setError(validationError);
      return;
    }

    setIsSaving(true);
    setError('');

    try {
      await saveNewTemplate({
        name: name.trim(),
        description: description.trim(),
        icon,
        content: initialContent,
      });

      toast.success('Template saved successfully');
      handleClose();
      onSaved?.();
    } catch (err) {
      console.error('[SaveTemplateModal] Failed to save template:', err);
      const errorMessage = err instanceof Error ? err.message : 'Failed to save template';
      setError(errorMessage);
      toast.error(errorMessage);
    } finally {
      setIsSaving(false);
    }
  };

  const handleClose = () => {
    setName('');
    setDescription('');
    setIcon('blank');
    setError('');
    setIsSaving(false);
    onClose();
  };

  // Handle keyboard navigation
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape' && !isSaving) {
      handleClose();
    }
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 modal-backdrop-dark flex items-center justify-center z-50 modal-backdrop-enter"
      onClick={(e) => e.target === e.currentTarget && !isSaving && handleClose()}
      onKeyDown={handleKeyDown}
      role="dialog"
      aria-modal="true"
      aria-labelledby="save-template-title"
    >
      <div className="bg-white dark:bg-gray-800 rounded-xl w-full max-w-md mx-4 modal-elevated modal-content-enter">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 dark:border-gray-700">
          <h2 id="save-template-title" className="text-lg font-semibold text-gray-900 dark:text-white">
            Save as Template
          </h2>
          <button
            onClick={handleClose}
            disabled={isSaving}
            className="p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 rounded focus-ring disabled:opacity-50"
            aria-label="Close modal"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {/* Name */}
          <div>
            <label
              htmlFor="template-name"
              className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
            >
              Template Name <span className="text-red-500">*</span>
            </label>
            <input
              ref={nameInputRef}
              id="template-name"
              type="text"
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                setError('');
              }}
              placeholder="Meeting Notes Template"
              maxLength={MAX_NAME_LENGTH}
              disabled={isSaving}
              className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
              aria-describedby={error ? 'template-name-error' : undefined}
              aria-invalid={!!error}
            />
            <div className="flex justify-between mt-1">
              {error ? (
                <p id="template-name-error" className="text-xs text-red-500">{error}</p>
              ) : (
                <span />
              )}
              <span className="text-xs text-gray-400">
                {name.length}/{MAX_NAME_LENGTH}
              </span>
            </div>
          </div>

          {/* Description */}
          <div>
            <label
              htmlFor="template-description"
              className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
            >
              Description
            </label>
            <textarea
              id="template-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="For weekly team meetings and standup notes"
              rows={3}
              maxLength={MAX_DESCRIPTION_LENGTH}
              disabled={isSaving}
              className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none disabled:opacity-50"
            />
            <div className="flex justify-end mt-1">
              <span className="text-xs text-gray-400">
                {description.length}/{MAX_DESCRIPTION_LENGTH}
              </span>
            </div>
          </div>

          {/* Icon */}
          <div>
            <label
              htmlFor="template-icon"
              className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
            >
              Icon
            </label>
            <div className="relative">
              <div className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">
                <TemplateIcon icon={icon} size={16} />
              </div>
              <select
                id="template-icon"
                value={icon}
                onChange={(e) => setIcon(e.target.value)}
                disabled={isSaving}
                className="w-full pl-9 pr-8 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500 appearance-none cursor-pointer disabled:opacity-50"
              >
                {availableIcons.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
              <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none">
                <svg
                  className="w-4 h-4 text-gray-400"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M19 9l-7 7-7-7"
                  />
                </svg>
              </div>
            </div>
          </div>

          {/* Actions */}
          <div className="flex justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={handleClose}
              disabled={isSaving}
              className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-700 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors focus-ring disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSaving || !name.trim()}
              className="px-4 py-2 text-sm font-medium text-white rounded-lg btn-primary-gradient btn-elevated focus-ring disabled:opacity-50 flex items-center gap-2"
            >
              {isSaving ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Saving...
                </>
              ) : (
                'Save Template'
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

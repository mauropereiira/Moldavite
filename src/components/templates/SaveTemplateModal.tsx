import React, { useState, useEffect, useRef } from 'react';
import { X } from 'lucide-react';
import { TemplateIcon, availableIcons } from './TemplateIcon';
import { useTemplates } from '@/hooks/useTemplates';
import { useToast } from '@/hooks/useToast';
import { DotLoader } from '@/components/ui/DotLoader';

interface SaveTemplateModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialContent: string;
  onSaved?: () => void;
}

const MAX_NAME_LENGTH = 100;
const MAX_DESCRIPTION_LENGTH = 200;
const fieldStyle = {
  color: 'var(--text-primary)',
  backgroundColor: 'var(--bg-panel)',
  borderColor: 'var(--border-default)',
  '--tw-ring-color': 'var(--focus-ring)',
} as React.CSSProperties;

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
      <div
        className="rounded-xl w-full max-w-md mx-4 modal-elevated modal-content-enter"
        style={{ backgroundColor: 'var(--bg-elevated)' }}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between px-6 py-4 border-b"
          style={{ borderColor: 'var(--border-default)' }}
        >
          <h2
            id="save-template-title"
            className="text-lg font-semibold"
            style={{ color: 'var(--text-primary)' }}
          >
            Save as Template
          </h2>
          <button
            onClick={handleClose}
            disabled={isSaving}
            className="p-1 rounded focus-ring hover:text-[var(--text-secondary)] disabled:opacity-50"
            style={{ color: 'var(--text-muted)' }}
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
              className="block text-sm font-medium mb-1"
              style={{ color: 'var(--text-secondary)' }}
            >
              Template Name <span style={{ color: 'var(--error)' }}>*</span>
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
              className="w-full px-3 py-2 text-sm border rounded-lg placeholder:text-[var(--text-muted)] focus:outline-none focus:ring-2 disabled:opacity-50"
              style={fieldStyle}
              aria-describedby={error ? 'template-name-error' : undefined}
              aria-invalid={!!error}
            />
            <div className="flex justify-between mt-1">
              {error ? (
                <p id="template-name-error" className="text-xs" style={{ color: 'var(--error)' }}>
                  {error}
                </p>
              ) : (
                <span />
              )}
              <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
                {name.length}/{MAX_NAME_LENGTH}
              </span>
            </div>
          </div>

          {/* Description */}
          <div>
            <label
              htmlFor="template-description"
              className="block text-sm font-medium mb-1"
              style={{ color: 'var(--text-secondary)' }}
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
              className="w-full px-3 py-2 text-sm border rounded-lg placeholder:text-[var(--text-muted)] focus:outline-none focus:ring-2 resize-none disabled:opacity-50"
              style={fieldStyle}
            />
            <div className="flex justify-end mt-1">
              <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
                {description.length}/{MAX_DESCRIPTION_LENGTH}
              </span>
            </div>
          </div>

          {/* Icon */}
          <div>
            <label
              htmlFor="template-icon"
              className="block text-sm font-medium mb-1"
              style={{ color: 'var(--text-secondary)' }}
            >
              Icon
            </label>
            <div className="relative">
              <div
                className="absolute left-3 top-1/2 -translate-y-1/2"
                style={{ color: 'var(--text-muted)' }}
              >
                <TemplateIcon icon={icon} size={16} />
              </div>
              <select
                id="template-icon"
                value={icon}
                onChange={(e) => setIcon(e.target.value)}
                disabled={isSaving}
                className="w-full pl-9 pr-8 py-2 text-sm border rounded-lg focus:outline-none focus:ring-2 appearance-none cursor-pointer disabled:opacity-50"
                style={fieldStyle}
              >
                {availableIcons.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
              <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none">
                <svg
                  className="w-4 h-4"
                  style={{ color: 'var(--text-muted)' }}
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
              className="px-4 py-2 text-sm font-medium rounded-lg hover:bg-[var(--bg-inset)] transition-colors focus-ring disabled:opacity-50"
              style={{
                color: 'var(--text-secondary)',
                backgroundColor: 'var(--bg-panel)',
              }}
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
                  <DotLoader label="Saving template" />
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

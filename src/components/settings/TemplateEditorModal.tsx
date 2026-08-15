import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTemplates } from '@/hooks/useTemplates';
import { useTemplateStore } from '@/stores/templateStore';
import { useToast } from '@/hooks/useToast';
import { DotLoader } from '@/components/ui/DotLoader';

interface TemplateEditorModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const MAX_NAME_LENGTH = 100;

/**
 * Minimal "+ New template" editor.
 *
 * Only captures the two essentials the design doc calls for: name + body.
 * Description and icon default to blank; users can tweak those later via
 * the existing Edit template modal. Body is a monospace textarea with a
 * help string listing the supported tokens.
 */
export function TemplateEditorModal({ isOpen, onClose }: TemplateEditorModalProps) {
  const { saveNewTemplate } = useTemplates();
  const { templates } = useTemplateStore();
  const toast = useToast();
  const nameInputRef = useRef<HTMLInputElement>(null);

  const [name, setName] = useState('');
  const [body, setBody] = useState('');
  const [error, setError] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  // Reset form each time the modal opens.
  useEffect(() => {
    if (isOpen) {
      setName('');
      setBody('');
      setError('');
      setIsSaving(false);
      setTimeout(() => nameInputRef.current?.focus(), 50);
    }
  }, [isOpen]);

  // Close on Escape while the modal is open.
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !isSaving) onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, isSaving, onClose]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = name.trim();

    if (!trimmed) {
      setError('Template name is required');
      return;
    }
    if (trimmed.length > MAX_NAME_LENGTH) {
      setError(`Template name must be ${MAX_NAME_LENGTH} characters or less`);
      return;
    }

    // Collision check: inline error rather than a toast so it sits right
    // under the offending field.
    const exists = templates.some((t) => t.name.toLowerCase() === trimmed.toLowerCase());
    if (exists) {
      setError('A template with this name already exists');
      return;
    }

    setIsSaving(true);
    setError('');

    try {
      await saveNewTemplate({
        name: trimmed,
        description: '',
        icon: 'blank',
        content: body,
      });
      toast.success('Template created');
      onClose();
    } catch (err) {
      console.error('[TemplateEditorModal] save failed:', err);
      const msg = err instanceof Error ? err.message : 'Failed to save template';
      // Name-collision errors bubble up from the backend too; surface them
      // inline for consistency with the frontend pre-check.
      if (msg.toLowerCase().includes('already exists')) {
        setError('A template with this name already exists');
      } else {
        setError(msg);
        toast.error(msg);
      }
    } finally {
      setIsSaving(false);
    }
  };

  if (!isOpen) return null;

  return createPortal(
    <div
      className="settings-scrim fixed inset-0 flex items-center justify-center z-[10000] modal-backdrop-enter"
      onClick={(e) => e.target === e.currentTarget && !isSaving && onClose()}
      role="dialog"
      aria-modal="true"
      aria-labelledby="template-editor-title"
    >
      <div
        className="settings-dialog w-full max-w-lg mx-4 max-h-[80vh] flex flex-col modal-content-enter"
        style={{
          backgroundColor: 'var(--bg-base)',
        }}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between px-6 py-4"
          style={{ borderBottom: '1px solid var(--border-default)' }}
        >
          <h2
            id="template-editor-title"
            className="text-lg font-semibold"
            style={{ color: 'var(--text-primary)' }}
          >
            New Template
          </h2>
          <button
            onClick={onClose}
            disabled={isSaving}
            className="settings-close p-1 focus-ring disabled:opacity-50"
            style={{
              color: 'var(--text-muted)',
            }}
            aria-label="Close"
          >
            <span aria-hidden="true">×</span>
          </button>
        </div>

        {/* Body */}
        <form
          id="template-editor-form"
          onSubmit={handleSubmit}
          className="flex-1 overflow-y-auto p-6 space-y-4 min-h-0"
        >
          <div>
            <label
              htmlFor="template-editor-name"
              className="block text-sm font-medium mb-1"
              style={{ color: 'var(--text-secondary)' }}
            >
              Name <span style={{ color: 'var(--error)' }}>*</span>
            </label>
            <input
              ref={nameInputRef}
              id="template-editor-name"
              type="text"
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                setError('');
              }}
              maxLength={MAX_NAME_LENGTH}
              disabled={isSaving}
              className="w-full px-3 py-2 text-sm focus:outline-none focus:ring-2 disabled:opacity-50"
              style={{
                backgroundColor: 'transparent',
                border: '1px solid var(--border-default)',
                borderRadius: 'var(--radius-sm)',
                color: 'var(--text-primary)',
              }}
              aria-invalid={!!error}
              aria-describedby={error ? 'template-editor-name-error' : undefined}
            />
            {error && (
              <p
                id="template-editor-name-error"
                className="text-xs mt-1"
                style={{ color: 'var(--error)' }}
              >
                {error}
              </p>
            )}
          </div>

          <div>
            <label
              htmlFor="template-editor-body"
              className="block text-sm font-medium mb-1"
              style={{ color: 'var(--text-secondary)' }}
            >
              Body
            </label>
            <textarea
              id="template-editor-body"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={10}
              disabled={isSaving}
              placeholder="# {{title}}&#10;&#10;Written on {{date}} at {{time}}"
              className="w-full px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 resize-none disabled:opacity-50"
              style={{
                backgroundColor: 'transparent',
                border: '1px solid var(--border-default)',
                borderRadius: 'var(--radius-sm)',
                color: 'var(--text-primary)',
              }}
            />
            <p className="text-xs mt-2" style={{ color: 'var(--text-muted)' }}>
              Supported tokens:{' '}
              <code className="px-1 rounded" style={{ backgroundColor: 'transparent' }}>
                {'{{date}}'}
              </code>{' '}
              <code className="px-1 rounded" style={{ backgroundColor: 'transparent' }}>
                {'{{time}}'}
              </code>{' '}
              <code className="px-1 rounded" style={{ backgroundColor: 'transparent' }}>
                {'{{title}}'}
              </code>
            </p>
          </div>
        </form>

        {/* Footer */}
        <div
          className="flex justify-end gap-3 px-6 py-4"
          style={{
            borderTop: '1px solid var(--border-default)',
            borderBottomLeftRadius: 'var(--radius-md)',
            borderBottomRightRadius: 'var(--radius-md)',
          }}
        >
          <button
            type="button"
            onClick={onClose}
            disabled={isSaving}
            className="px-3 py-1.5 text-sm font-medium focus-ring disabled:opacity-50"
            style={{
              backgroundColor: 'transparent',
              border: '1px solid var(--border-default)',
              borderRadius: 'var(--radius-sm)',
              color: 'var(--text-secondary)',
            }}
          >
            Cancel
          </button>
          <button
            type="submit"
            form="template-editor-form"
            disabled={isSaving || !name.trim()}
            className="px-3 py-1.5 text-sm font-medium focus-ring disabled:opacity-50 flex items-center gap-2"
            style={{
              backgroundColor: 'transparent',
              borderRadius: 'var(--radius-sm)',
            }}
          >
            {isSaving ? (
              <>
                <DotLoader label="Creating template" />
                Saving...
              </>
            ) : (
              'Create template'
            )}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}

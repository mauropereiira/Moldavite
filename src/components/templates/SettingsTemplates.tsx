import { useState } from 'react';
import { Edit2, Trash2, AlertCircle, Loader2, Pin, PinOff, Plus } from 'lucide-react';
import { useTemplateStore } from '@/stores/templateStore';
import type { Template } from '@/types/template';
import { TemplateIcon } from './TemplateIcon';
import { EditTemplateModal } from './EditTemplateModal';
import { TemplateEditorModal } from '@/components/settings/TemplateEditorModal';
import { useToast } from '@/hooks/useToast';

interface SettingsTemplatesProps {
  onDeleteTemplate: (id: string) => Promise<void>;
  onUpdateTemplate: (
    id: string,
    name: string,
    description: string,
    icon: string,
    content: string
  ) => Promise<void>;
}

export function SettingsTemplates({
  onDeleteTemplate,
  onUpdateTemplate,
}: SettingsTemplatesProps) {
  const {
    templates,
    defaultDailyTemplate,
    setDefaultDailyTemplate,
    pinnedTemplateIds,
    togglePinnedTemplate,
  } = useTemplateStore();

  const [editingTemplate, setEditingTemplate] = useState<Template | null>(null);
  const [deletingTemplate, setDeletingTemplate] = useState<Template | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isCreating, setIsCreating] = useState(false);

  const toast = useToast();

  const defaultTemplates = templates.filter((t) => t.isDefault);
  const customTemplates = templates.filter((t) => !t.isDefault);

  const handleDelete = async () => {
    if (!deletingTemplate) return;

    setIsDeleting(true);

    try {
      // If deleting the default daily template, unset it first
      if (defaultDailyTemplate === deletingTemplate.id) {
        setDefaultDailyTemplate(null);
      }

      await onDeleteTemplate(deletingTemplate.id);
      toast.success('Template deleted');
      setDeletingTemplate(null);
    } catch (err) {
      console.error('[SettingsTemplates] Failed to delete template:', err);
      const errorMessage = err instanceof Error ? err.message : 'Failed to delete template';
      toast.error(errorMessage);
    } finally {
      setIsDeleting(false);
    }
  };

  const handleUpdateTemplate = async (
    id: string,
    name: string,
    description: string,
    icon: string,
    content: string
  ) => {
    await onUpdateTemplate(id, name, description, icon, content);
    setEditingTemplate(null);
  };

  return (
    <div className="space-y-6">
      {/* Default Daily Template Selection */}
      <div
        className="p-4 space-y-2"
        style={{ backgroundColor: 'var(--bg-panel)', borderRadius: 'var(--radius-md)' }}
      >
        <h3 className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
          Default Daily Template
        </h3>
        <p className="text-sm" style={{ color: 'var(--text-tertiary)' }}>
          Template used when creating daily notes
        </p>
        <select
          value={defaultDailyTemplate || ''}
          onChange={(e) =>
            setDefaultDailyTemplate(e.target.value || null)
          }
          className="w-full px-3 py-2 text-sm rounded focus:outline-none focus:ring-2"
          style={{
            backgroundColor: 'var(--bg-elevated)',
            color: 'var(--text-primary)',
            border: '1px solid var(--border-default)',
          }}
          aria-label="Select default daily template"
        >
          <option value="">Blank (no template)</option>
          {templates.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
      </div>

      {/* Pinned Templates for Quick Picker */}
      <div
        className="p-4 space-y-2"
        style={{ backgroundColor: 'var(--bg-panel)', borderRadius: 'var(--radius-md)' }}
      >
        <h3 className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
          Quick Access Templates
        </h3>
        <p className="text-sm" style={{ color: 'var(--text-tertiary)' }}>
          Select templates to show in &quot;Start with a template&quot; picker (max 6)
        </p>
        <div className="space-y-1.5">
          {templates.map((template) => {
            const isPinned = pinnedTemplateIds.includes(template.id);
            const canPin = isPinned || pinnedTemplateIds.length < 6;
            return (
              <button
                key={template.id}
                onClick={() => canPin && togglePinnedTemplate(template.id)}
                disabled={!canPin}
                className={`w-full flex items-center gap-3 p-2 rounded transition-colors text-left ${
                  !canPin ? 'opacity-50 cursor-not-allowed' : ''
                }`}
                style={{
                  backgroundColor: isPinned ? 'var(--accent-subtle)' : 'var(--bg-elevated)',
                  border: `1px solid ${isPinned ? 'var(--accent-primary)' : 'var(--border-default)'}`,
                  color: 'var(--text-primary)',
                }}
              >
                <div style={{ color: isPinned ? 'var(--accent-primary)' : 'var(--text-tertiary)' }}>
                  <TemplateIcon icon={template.icon} size={16} />
                </div>
                <span
                  className="flex-1 text-sm truncate"
                  style={{ color: isPinned ? 'var(--accent-primary)' : 'var(--text-secondary)' }}
                >
                  {template.name}
                </span>
                {isPinned ? (
                  <Pin className="w-4 h-4" style={{ color: 'var(--accent-primary)' }} />
                ) : (
                  <PinOff className="w-4 h-4" style={{ color: 'var(--text-muted)' }} />
                )}
              </button>
            );
          })}
        </div>
        {pinnedTemplateIds.length === 0 && templates.length > 0 && (
          <p className="text-xs mt-2" style={{ color: 'var(--text-muted)' }}>
            No templates pinned. First 3 templates will be shown by default.
          </p>
        )}
      </div>

      {/* Default Templates (read-only list) */}
      {defaultTemplates.length > 0 && (
        <div
          className="p-4 space-y-3"
          style={{ backgroundColor: 'var(--bg-panel)', borderRadius: 'var(--radius-md)' }}
        >
          <h3 className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
            Default Templates ({defaultTemplates.length})
          </h3>
          <div className="space-y-2">
            {defaultTemplates.map((template) => (
              <div
                key={template.id}
                className="flex items-center gap-3 p-3 rounded"
                style={{
                  backgroundColor: 'var(--bg-elevated)',
                  border: '1px solid var(--border-default)',
                }}
              >
                <div style={{ color: 'var(--text-tertiary)' }}>
                  <TemplateIcon icon={template.icon} size={20} />
                </div>
                <div className="flex-1 min-w-0">
                  <p
                    className="text-sm font-medium truncate"
                    style={{ color: 'var(--text-primary)' }}
                  >
                    {template.name}
                  </p>
                  {template.description && (
                    <p className="text-xs truncate" style={{ color: 'var(--text-tertiary)' }}>
                      {template.description}
                    </p>
                  )}
                </div>
                <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
                  Built-in
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Custom Templates */}
      <div
        className="p-4 space-y-3"
        style={{ backgroundColor: 'var(--bg-panel)', borderRadius: 'var(--radius-md)' }}
      >
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
            Custom Templates ({customTemplates.length})
          </h3>
          <button
            onClick={() => setIsCreating(true)}
            className="flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded transition-colors focus-ring"
            style={{
              backgroundColor: 'var(--accent-primary)',
              color: 'var(--text-on-accent, #ffffff)',
            }}
          >
            <Plus className="w-3.5 h-3.5" />
            New template
          </button>
        </div>

        {customTemplates.length === 0 ? (
          <div
            className="text-center py-8 rounded"
            style={{
              backgroundColor: 'var(--bg-elevated)',
              border: '1px dashed var(--border-default)',
            }}
          >
            <div
              className="flex justify-center mb-2"
              style={{ color: 'var(--text-muted)' }}
            >
              <TemplateIcon icon="file" size={32} />
            </div>
            <p className="text-sm" style={{ color: 'var(--text-tertiary)' }}>
              No custom templates yet
            </p>
            <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
              Save a note as template to create one
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {customTemplates.map((template) => (
              <div
                key={template.id}
                className="flex items-center gap-3 p-3 rounded shadow-system-xs"
                style={{
                  backgroundColor: 'var(--bg-elevated)',
                  border: '1px solid var(--border-default)',
                }}
              >
                <div style={{ color: 'var(--accent-primary)' }}>
                  <TemplateIcon icon={template.icon} size={20} />
                </div>
                <div className="flex-1 min-w-0">
                  <p
                    className="text-sm font-medium truncate"
                    style={{ color: 'var(--text-primary)' }}
                  >
                    {template.name}
                  </p>
                  {template.description && (
                    <p className="text-xs truncate" style={{ color: 'var(--text-tertiary)' }}>
                      {template.description}
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => setEditingTemplate(template)}
                    className="p-1.5 rounded transition-colors"
                    style={{ color: 'var(--text-tertiary)' }}
                    title="Edit template"
                    aria-label={`Edit ${template.name}`}
                  >
                    <Edit2 className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => setDeletingTemplate(template)}
                    className="p-1.5 rounded transition-colors"
                    style={{ color: 'var(--text-tertiary)' }}
                    title="Delete template"
                    aria-label={`Delete ${template.name}`}
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Edit Modal */}
      <EditTemplateModal
        isOpen={!!editingTemplate}
        onClose={() => setEditingTemplate(null)}
        template={editingTemplate}
        onSave={handleUpdateTemplate}
      />

      {/* New Template Modal */}
      <TemplateEditorModal
        isOpen={isCreating}
        onClose={() => setIsCreating(false)}
      />

      {/* Delete Confirmation Modal */}
      {deletingTemplate && (
        <div
          className="fixed inset-0 modal-backdrop-dark flex items-center justify-center z-[60] modal-backdrop-enter"
          onClick={(e) => e.target === e.currentTarget && !isDeleting && setDeletingTemplate(null)}
          role="dialog"
          aria-modal="true"
          aria-labelledby="delete-template-title"
        >
          <div
            className="rounded-md p-6 max-w-sm mx-4 modal-elevated modal-content-enter"
            style={{ backgroundColor: 'var(--bg-elevated)' }}
          >
            <div className="flex items-center gap-3 mb-4">
              <div
                className="p-2 rounded-full"
                style={{ backgroundColor: 'rgba(212, 101, 26, 0.15)' }}
              >
                <AlertCircle className="w-5 h-5" style={{ color: 'var(--error)' }} />
              </div>
              <h3
                id="delete-template-title"
                className="text-lg font-semibold"
                style={{ color: 'var(--text-primary)' }}
              >
                Delete Template
              </h3>
            </div>
            <p className="mb-4" style={{ color: 'var(--text-secondary)' }}>
              Delete &quot;{deletingTemplate.name}&quot;? This cannot be undone.
            </p>
            {defaultDailyTemplate === deletingTemplate.id && (
              <p
                className="text-sm mb-4 p-2 rounded"
                style={{
                  color: 'var(--warning)',
                  backgroundColor: 'var(--warning-muted)',
                }}
              >
                This template is set as your default daily template. It will be unset.
              </p>
            )}
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setDeletingTemplate(null)}
                disabled={isDeleting}
                className="px-3 py-1.5 text-sm font-medium rounded transition-colors focus-ring disabled:opacity-50"
                style={{
                  backgroundColor: 'var(--bg-panel)',
                  color: 'var(--text-secondary)',
                  border: '1px solid var(--border-default)',
                }}
              >
                Cancel
              </button>
              <button
                onClick={handleDelete}
                disabled={isDeleting}
                className="px-3 py-1.5 text-sm font-medium text-white rounded btn-danger-gradient btn-elevated focus-ring disabled:opacity-50 flex items-center gap-2"
              >
                {isDeleting ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Deleting...
                  </>
                ) : (
                  'Delete'
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

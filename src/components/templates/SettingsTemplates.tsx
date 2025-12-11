import { useState } from 'react';
import { Edit2, Trash2, AlertCircle, Loader2 } from 'lucide-react';
import { useTemplateStore } from '@/stores/templateStore';
import type { Template } from '@/types/template';
import { TemplateIcon } from './TemplateIcon';
import { EditTemplateModal } from './EditTemplateModal';
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
  } = useTemplateStore();

  const [editingTemplate, setEditingTemplate] = useState<Template | null>(null);
  const [deletingTemplate, setDeletingTemplate] = useState<Template | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

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
      <div>
        <h3 className="text-sm font-medium text-gray-900 dark:text-white mb-1">
          Default Daily Template
        </h3>
        <p className="text-sm text-gray-500 dark:text-gray-400 mb-2">
          Template used when creating daily notes
        </p>
        <select
          value={defaultDailyTemplate || ''}
          onChange={(e) =>
            setDefaultDailyTemplate(e.target.value || null)
          }
          className="w-full px-3 py-2 text-sm bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
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

      {/* Default Templates (read-only list) */}
      {defaultTemplates.length > 0 && (
        <div>
          <h3 className="text-sm font-medium text-gray-900 dark:text-white mb-3">
            Default Templates ({defaultTemplates.length})
          </h3>
          <div className="space-y-2">
            {defaultTemplates.map((template) => (
              <div
                key={template.id}
                className="flex items-center gap-3 p-3 rounded bg-gray-50 dark:bg-gray-700/50 border border-gray-200 dark:border-gray-700"
              >
                <div className="text-gray-400 dark:text-gray-500">
                  <TemplateIcon icon={template.icon} size={20} />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-900 dark:text-white truncate">
                    {template.name}
                  </p>
                  {template.description && (
                    <p className="text-xs text-gray-500 dark:text-gray-400 truncate">
                      {template.description}
                    </p>
                  )}
                </div>
                <span className="text-xs text-gray-400 dark:text-gray-500">
                  Built-in
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Custom Templates */}
      <div>
        <h3 className="text-sm font-medium text-gray-900 dark:text-white mb-3">
          Custom Templates ({customTemplates.length})
        </h3>

        {customTemplates.length === 0 ? (
          <div className="text-center py-8 bg-gray-50 dark:bg-gray-700/30 rounded border border-dashed border-gray-300 dark:border-gray-600">
            <TemplateIcon
              icon="file"
              size={32}
              className="mx-auto text-gray-300 dark:text-gray-600 mb-2"
            />
            <p className="text-sm text-gray-500 dark:text-gray-400">
              No custom templates yet
            </p>
            <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
              Save a note as template to create one
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {customTemplates.map((template) => (
              <div
                key={template.id}
                className="flex items-center gap-3 p-3 rounded bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 shadow-system-xs"
              >
                <div className="text-blue-500 dark:text-blue-400">
                  <TemplateIcon icon={template.icon} size={20} />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-900 dark:text-white truncate">
                    {template.name}
                  </p>
                  {template.description && (
                    <p className="text-xs text-gray-500 dark:text-gray-400 truncate">
                      {template.description}
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => setEditingTemplate(template)}
                    className="p-1.5 text-gray-400 hover:text-blue-600 dark:hover:text-blue-400 rounded hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                    title="Edit template"
                    aria-label={`Edit ${template.name}`}
                  >
                    <Edit2 className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => setDeletingTemplate(template)}
                    className="p-1.5 text-gray-400 hover:text-red-600 dark:hover:text-red-400 rounded hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
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

      {/* Delete Confirmation Modal */}
      {deletingTemplate && (
        <div
          className="fixed inset-0 modal-backdrop-dark flex items-center justify-center z-[60] modal-backdrop-enter"
          onClick={(e) => e.target === e.currentTarget && !isDeleting && setDeletingTemplate(null)}
          role="dialog"
          aria-modal="true"
          aria-labelledby="delete-template-title"
        >
          <div className="bg-white dark:bg-gray-800 rounded-md p-6 max-w-sm mx-4 modal-elevated modal-content-enter">
            <div className="flex items-center gap-3 mb-4">
              <div className="p-2 bg-red-100 dark:bg-red-900/30 rounded-full">
                <AlertCircle className="w-5 h-5 text-red-600 dark:text-red-400" />
              </div>
              <h3 id="delete-template-title" className="text-lg font-semibold text-gray-900 dark:text-white">
                Delete Template
              </h3>
            </div>
            <p className="text-gray-600 dark:text-gray-300 mb-4">
              Delete "{deletingTemplate.name}"? This cannot be undone.
            </p>
            {defaultDailyTemplate === deletingTemplate.id && (
              <p className="text-sm text-amber-600 dark:text-amber-400 mb-4 p-2 bg-amber-50 dark:bg-amber-900/20 rounded">
                This template is set as your default daily template. It will be unset.
              </p>
            )}
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setDeletingTemplate(null)}
                disabled={isDeleting}
                className="px-3 py-1.5 text-sm font-medium text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-700 rounded hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors focus-ring disabled:opacity-50"
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

import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { Globe2, Puzzle, X } from 'lucide-react';
import { useFocusTrap } from '@/hooks/useFocusTrap';
import {
  getPluginDialogSnapshot,
  resolvePluginDialog,
  subscribePluginDialogs,
} from '@/lib/plugins/dialogs';
import type { PluginPromptOptions } from '@/lib/plugins/types';

function PromptForm({ options, onCancel }: { options: PluginPromptOptions; onCancel: () => void }) {
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(options.fields.map((field) => [field.name, '']))
  );

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        resolvePluginDialog(values);
      }}
    >
      <div className="p-6 space-y-4">
        <div>
          <h2
            id="plugin-dialog-title"
            className="text-base font-semibold"
            style={{ color: 'var(--text-primary)' }}
          >
            {options.title}
          </h2>
          {options.message && (
            <p className="text-sm mt-1" style={{ color: 'var(--text-secondary)' }}>
              {options.message}
            </p>
          )}
        </div>
        {options.fields.map((field, index) => (
          <div key={field.name} className="space-y-1">
            <label
              htmlFor={`plugin-field-${field.name}`}
              className="block text-sm font-medium"
              style={{ color: 'var(--text-secondary)' }}
            >
              {field.label}
            </label>
            <input
              id={`plugin-field-${field.name}`}
              className="input"
              type={field.type}
              value={values[field.name] ?? ''}
              placeholder={field.placeholder}
              required={field.required}
              autoComplete={field.type === 'password' ? 'new-password' : 'off'}
              autoFocus={index === 0}
              onChange={(event) =>
                setValues((current) => ({ ...current, [field.name]: event.target.value }))
              }
            />
          </div>
        ))}
      </div>
      <div
        className="flex justify-end gap-2 px-6 py-4"
        style={{ borderTop: '1px solid var(--border-default)' }}
      >
        <button type="button" onClick={onCancel} className="btn focus-ring">
          Cancel
        </button>
        <button type="submit" className="btn btn-primary focus-ring">
          {options.confirmLabel ?? 'Continue'}
        </button>
      </div>
    </form>
  );
}

/** Renders all plugin-originated dialogs in trusted app chrome. */
export function PluginDialogHost() {
  const request = useSyncExternalStore(
    subscribePluginDialogs,
    getPluginDialogSnapshot,
    getPluginDialogSnapshot
  );
  const dialogRef = useRef<HTMLDivElement>(null);
  useFocusTrap(dialogRef, request !== null);

  useEffect(() => {
    if (!request) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        resolvePluginDialog(request.kind === 'prompt' ? null : false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [request]);

  if (!request) return null;

  const cancel = () => resolvePluginDialog(request.kind === 'prompt' ? null : false);
  return createPortal(
    <div
      className="fixed inset-0 modal-backdrop-dark flex items-center justify-center z-[11000] modal-backdrop-enter"
      onClick={(event) => {
        if (event.target === event.currentTarget) cancel();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="plugin-dialog-title"
        className="w-full max-w-md mx-4 modal-elevated modal-content-enter"
        style={{ borderRadius: 'var(--radius-md)' }}
      >
        <div
          className="flex items-center justify-between px-6 py-4"
          style={{ borderBottom: '1px solid var(--border-default)' }}
        >
          <div className="flex items-center gap-2 min-w-0">
            <Puzzle
              aria-hidden="true"
              className="w-5 h-5 flex-shrink-0"
              style={{ color: 'var(--accent-primary)' }}
            />
            <div className="min-w-0">
              <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
                Request from plugin
              </p>
              <p
                className="text-sm font-semibold truncate"
                style={{ color: 'var(--text-primary)' }}
              >
                {request.pluginName}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={cancel}
            className="p-1 focus-ring"
            aria-label="Cancel plugin request"
          >
            <X className="w-5 h-5" style={{ color: 'var(--text-muted)' }} />
          </button>
        </div>

        {request.kind === 'host-access' ? (
          <div className="p-6">
            <div className="flex gap-3">
              <Globe2
                aria-hidden="true"
                className="w-5 h-5 flex-shrink-0"
                style={{ color: 'var(--accent-primary)' }}
              />
              <div>
                <h2
                  id="plugin-dialog-title"
                  className="text-base font-semibold"
                  style={{ color: 'var(--text-primary)' }}
                >
                  Allow network access?
                </h2>
                <p className="text-sm mt-2" style={{ color: 'var(--text-secondary)' }}>
                  Plugin {request.pluginName} wants permission to contact{' '}
                  <code>{request.host}</code>.
                </p>
                <p className="text-xs mt-2" style={{ color: 'var(--text-tertiary)' }}>
                  You can revoke this host later in Settings → Plugins.
                </p>
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-6">
              <button type="button" onClick={cancel} className="btn focus-ring">
                Deny
              </button>
              <button
                type="button"
                onClick={() => resolvePluginDialog(true)}
                className="btn btn-primary focus-ring"
                autoFocus
              >
                Allow
              </button>
            </div>
          </div>
        ) : (
          <PromptForm key={request.requestId} options={request.options} onCancel={cancel} />
        )}
      </div>
    </div>,
    document.body
  );
}

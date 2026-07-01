/**
 * PluginPermissionSheet — the trust prompt shown before enabling a plugin (and
 * as a read-only view of an enabled plugin's declared capabilities).
 *
 * Presentational only: the parent owns open state and the grant/disable calls.
 */
import { ShieldAlert, X } from 'lucide-react';

export interface PluginPermissionSheetProps {
  manifest: { name: string; version: string; author?: string; description?: string };
  permissions: string[];
  mode: 'grant' | 'view';
  onEnable: () => void;
  onClose: () => void;
}

const PERMISSION_LABEL: Record<string, string> = {
  commands: 'Add commands to the palette and slash menu',
  editor: 'Read and modify the active note',
  ui: 'Show toasts / notifications',
};

export function PluginPermissionSheet({
  manifest,
  permissions,
  mode,
  onEnable,
  onClose,
}: PluginPermissionSheetProps) {
  return (
    <div
      className="fixed inset-0 modal-backdrop-dark flex items-center justify-center z-[9999] modal-backdrop-enter"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="w-full max-w-md mx-4 max-h-[80vh] flex flex-col modal-elevated modal-content-enter"
        style={{ borderRadius: 'var(--radius-md)' }}
        role="dialog"
        aria-modal="true"
        aria-labelledby="plugin-permission-title"
      >
        {/* Header */}
        <div
          className="flex items-center justify-between px-6 py-4 flex-shrink-0"
          style={{ borderBottom: '1px solid var(--border-default)' }}
        >
          <div className="flex items-center gap-2">
            <ShieldAlert aria-hidden="true" className="w-5 h-5" style={{ color: 'var(--accent-primary)' }} />
            <h2 id="plugin-permission-title" className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>
              {mode === 'grant' ? 'Enable plugin?' : 'Plugin permissions'}
            </h2>
          </div>
          <button
            onClick={onClose}
            className="p-1 transition-colors"
            style={{ color: 'var(--text-muted)', borderRadius: 'var(--radius-sm)' }}
            aria-label="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          <div>
            <p className="text-base font-medium" style={{ color: 'var(--text-primary)' }}>
              {manifest.name} <span style={{ color: 'var(--text-tertiary)' }}>v{manifest.version}</span>
            </p>
            {manifest.author && (
              <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
                by {manifest.author}
              </p>
            )}
            {manifest.description && (
              <p className="text-sm mt-1" style={{ color: 'var(--text-secondary)' }}>
                {manifest.description}
              </p>
            )}
          </div>

          <div
            className="p-3 text-sm"
            style={{
              backgroundColor: 'var(--bg-inset)',
              borderRadius: 'var(--radius-sm)',
              color: 'var(--text-secondary)',
            }}
          >
            This plugin runs code that can read and modify notes in this Forge and add
            commands. Only enable plugins you trust &mdash; a plugin has the same access as
            the app itself.
          </div>

          {permissions.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-xs font-medium uppercase tracking-wide" style={{ color: 'var(--text-tertiary)' }}>
                Declared capabilities
              </p>
              <ul className="space-y-1">
                {permissions.map((p) => (
                  <li key={p} className="text-sm flex gap-2" style={{ color: 'var(--text-secondary)' }}>
                    <span aria-hidden="true" style={{ color: 'var(--accent-primary)' }}>
                      &bull;
                    </span>
                    <span>{PERMISSION_LABEL[p] ?? p}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-2 px-6 py-4 flex-shrink-0" style={{ borderTop: '1px solid var(--border-default)' }}>
          {mode === 'grant' ? (
            <>
              <button
                onClick={onClose}
                className="px-4 py-2 text-sm font-medium transition-colors"
                style={{
                  backgroundColor: 'var(--bg-elevated)',
                  border: '1px solid var(--border-default)',
                  borderRadius: 'var(--radius-sm)',
                  color: 'var(--text-secondary)',
                }}
              >
                Cancel
              </button>
              <button
                onClick={onEnable}
                className="px-4 py-2 text-sm font-medium text-white transition-colors"
                style={{ backgroundColor: 'var(--accent-primary)', borderRadius: 'var(--radius-sm)' }}
              >
                Enable
              </button>
            </>
          ) : (
            <button
              onClick={onClose}
              className="px-4 py-2 text-sm font-medium text-white transition-colors"
              style={{ backgroundColor: 'var(--accent-primary)', borderRadius: 'var(--radius-sm)' }}
            >
              Done
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

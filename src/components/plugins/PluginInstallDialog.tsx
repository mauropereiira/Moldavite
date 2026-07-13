/** Explicit install confirmation for community plugins opened from deep links. */

import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Download, ShieldCheck, X } from 'lucide-react';
import { useFocusTrap } from '@/hooks/useFocusTrap';
import { pluginPermissionLabel } from '@/lib/plugins/permissionLabels';
import type { CommunityPlugin } from '@/lib/plugins/registry';

interface PluginInstallDialogProps {
  plugin: CommunityPlugin;
  actionLabel?: string;
  onInstall: () => void;
  onClose: () => void;
}

export function PluginInstallDialog({
  plugin,
  actionLabel = 'Install',
  onInstall,
  onClose,
}: PluginInstallDialogProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const title = actionLabel === 'Update' ? 'Update community plugin?' : 'Install community plugin?';
  useFocusTrap(dialogRef, true);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.stopPropagation();
      onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  return createPortal(
    <div
      className="fixed inset-0 modal-backdrop-dark flex items-center justify-center z-[10000] modal-backdrop-enter"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="plugin-install-title"
        className="w-full max-w-md mx-4 max-h-[80vh] flex flex-col modal-elevated modal-content-enter"
        style={{ borderRadius: 'var(--radius-md)' }}
      >
        <div
          className="flex items-center justify-between px-6 py-4 flex-shrink-0"
          style={{ borderBottom: '1px solid var(--border-default)' }}
        >
          <div className="flex items-center gap-2">
            <ShieldCheck
              aria-hidden="true"
              className="w-5 h-5"
              style={{ color: 'var(--accent-primary)' }}
            />
            <h2
              id="plugin-install-title"
              className="text-lg font-semibold"
              style={{ color: 'var(--text-primary)' }}
            >
              {title}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 focus-ring"
            style={{ color: 'var(--text-muted)', borderRadius: 'var(--radius-sm)' }}
            aria-label="Cancel plugin install"
          >
            <X aria-hidden="true" className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          <div>
            <p className="text-base font-medium" style={{ color: 'var(--text-primary)' }}>
              {plugin.name} <span style={{ color: 'var(--text-tertiary)' }}>v{plugin.version}</span>
            </p>
            <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
              by {plugin.author} · <code>{plugin.id}</code>
            </p>
            <p className="text-sm mt-2" style={{ color: 'var(--text-secondary)' }}>
              {plugin.description}
            </p>
          </div>

          <div>
            <p
              className="text-xs font-medium uppercase tracking-wide mb-1.5"
              style={{ color: 'var(--text-tertiary)' }}
            >
              Requested permissions
            </p>
            {plugin.permissions.length === 0 ? (
              <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                No extra permissions.
              </p>
            ) : (
              <ul className="space-y-1.5">
                {plugin.permissions.map((permission) => (
                  <li
                    key={permission}
                    className="text-sm flex gap-2"
                    style={{ color: 'var(--text-secondary)' }}
                  >
                    <span aria-hidden="true" style={{ color: 'var(--accent-primary)' }}>
                      &bull;
                    </span>
                    <span>{pluginPermissionLabel(permission)}</span>
                  </li>
                ))}
              </ul>
            )}
            {plugin.allowedHosts.length > 0 && (
              <div className="mt-2 text-xs" style={{ color: 'var(--text-secondary)' }}>
                Allowed HTTPS hosts: <code>{plugin.allowedHosts.join(', ')}</code>
              </div>
            )}
          </div>

          <div
            className="p-3 text-xs"
            style={{
              backgroundColor: 'var(--bg-inset)',
              borderRadius: 'var(--radius-sm)',
              color: 'var(--text-secondary)',
            }}
          >
            Moldavite downloads only the registry-listed files and Rust verifies both SHA-256
            hashes. Installation does not enable the plugin: you will still review and grant its
            permissions before it can run.
          </div>
        </div>

        <div
          className="flex justify-end gap-2 px-6 py-4 flex-shrink-0"
          style={{ borderTop: '1px solid var(--border-default)' }}
        >
          <button type="button" onClick={onClose} className="btn focus-ring">
            Cancel
          </button>
          <button
            type="button"
            onClick={onInstall}
            autoFocus
            className="btn btn-primary focus-ring"
          >
            <Download aria-hidden="true" className="w-4 h-4" />
            {actionLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}

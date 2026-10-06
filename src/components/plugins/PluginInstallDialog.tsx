/**
 * Install and update confirmation for every plugin source: the community
 * directory, a website link, or a package from the user's own files. Nothing
 * is installed until the user confirms here, and nothing is enabled by it.
 */

import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Download, ExternalLink, ShieldAlert, ShieldCheck } from 'lucide-react';
import { useFocusTrap } from '@/hooks/useFocusTrap';
import { isNewerVersion } from '@/lib/changelog';
import { pluginPermissionLabel } from '@/lib/plugins/permissionLabels';
import { CloseButton } from '@/components/ui/CloseButton';

export interface PluginInstallDetails {
  id: string;
  name: string;
  version: string;
  author?: string;
  description?: string;
  permissions: string[];
  allowedHosts: string[];
  commands?: { id: string; label: string }[];
  /** SHA-256 of plugin.js, shown for a package from the user's files. */
  codeSha256?: string;
}

export interface InstalledAccess {
  version: string;
  permissions: string[];
  allowedHosts: string[];
}

interface PluginInstallDialogProps {
  plugin: PluginInstallDetails;
  source: 'community' | 'file';
  /** The copy already in this Forge, when this would replace it. */
  installed?: InstalledAccess | null;
  onViewSource?: () => void;
  onInstall: () => void;
  onClose: () => void;
}

function Change({ label }: { label: string }) {
  return (
    <span
      className="ml-2 text-[10px] font-semibold uppercase tracking-wide"
      style={{ color: 'var(--accent-primary)' }}
    >
      {label}
    </span>
  );
}

function SectionLabel({ children }: { children: string }) {
  return (
    <p
      className="text-xs font-medium uppercase tracking-wide mb-1.5"
      style={{ color: 'var(--text-tertiary)' }}
    >
      {children}
    </p>
  );
}

export function PluginInstallDialog({
  plugin,
  source,
  installed,
  onViewSource,
  onInstall,
  onClose,
}: PluginInstallDialogProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  useFocusTrap(dialogRef, true);

  const replacing = !!installed;
  const upgrading = replacing && isNewerVersion(plugin.version, installed.version);
  const actionLabel = !replacing ? 'Install' : upgrading ? 'Update' : 'Replace';
  const title = !replacing
    ? source === 'file'
      ? 'Install plugin from a file?'
      : 'Install community plugin?'
    : `${actionLabel} ${plugin.name}?`;
  const isNew = (list: string[] | undefined, value: string) =>
    replacing && !(list ?? []).includes(value);
  const droppedPermissions = (installed?.permissions ?? []).filter(
    (permission) => !plugin.permissions.includes(permission)
  );
  const droppedHosts = (installed?.allowedHosts ?? []).filter(
    (host) => !plugin.allowedHosts.includes(host)
  );

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
          <div className="flex items-center gap-2 min-w-0">
            {source === 'file' ? (
              <ShieldAlert
                aria-hidden="true"
                className="w-5 h-5 flex-shrink-0"
                style={{ color: 'var(--text-error)' }}
              />
            ) : (
              <ShieldCheck
                aria-hidden="true"
                className="w-5 h-5 flex-shrink-0"
                style={{ color: 'var(--accent-primary)' }}
              />
            )}
            <h2
              id="plugin-install-title"
              className="text-lg font-semibold truncate"
              style={{ color: 'var(--text-primary)' }}
            >
              {title}
            </h2>
          </div>
          <CloseButton onClick={onClose} label="Cancel plugin install" />
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          <div>
            <p className="text-base font-medium" style={{ color: 'var(--text-primary)' }}>
              {plugin.name} <span style={{ color: 'var(--text-tertiary)' }}>v{plugin.version}</span>
            </p>
            <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
              {plugin.author ? `by ${plugin.author} · ` : ''}
              <code>{plugin.id}</code>
              {installed ? ` · replaces v${installed.version}` : ''}
            </p>
            {plugin.description && (
              <p className="text-sm mt-2" style={{ color: 'var(--text-secondary)' }}>
                {plugin.description}
              </p>
            )}
            {onViewSource && (
              <button
                type="button"
                onClick={onViewSource}
                className="pad-hover mt-2 text-xs inline-flex items-center gap-1 focus-ring"
                style={{ color: 'var(--accent-primary)', borderRadius: 'var(--radius-sm)' }}
              >
                View its source code
                <ExternalLink aria-hidden="true" className="w-3 h-3" />
              </button>
            )}
          </div>

          <div>
            <SectionLabel>What it can do</SectionLabel>
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
                    <span>
                      {pluginPermissionLabel(permission)}
                      {isNew(installed?.permissions, permission) && <Change label="New" />}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            {plugin.allowedHosts.length > 0 && (
              <div className="mt-2 text-xs space-y-1" style={{ color: 'var(--text-secondary)' }}>
                <p>Can send data to these sites over HTTPS:</p>
                <ul className="space-y-0.5">
                  {plugin.allowedHosts.map((host) => (
                    <li key={host}>
                      <code>{host}</code>
                      {isNew(installed?.allowedHosts, host) && <Change label="New" />}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {(droppedPermissions.length > 0 || droppedHosts.length > 0) && (
              <p className="mt-2 text-xs" style={{ color: 'var(--text-tertiary)' }}>
                No longer asks for:{' '}
                {[...droppedPermissions.map(pluginPermissionLabel), ...droppedHosts].join('; ')}
              </p>
            )}
          </div>

          {plugin.commands && plugin.commands.length > 0 && (
            <div>
              <SectionLabel>Commands it adds</SectionLabel>
              <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                {plugin.commands.map((command) => command.label).join(' · ')}
              </p>
            </div>
          )}

          {source === 'file' ? (
            <div
              className="p-3 text-xs space-y-1"
              style={{
                backgroundColor: 'var(--bg-inset)',
                borderRadius: 'var(--radius-sm)',
                color: 'var(--text-secondary)',
              }}
            >
              <p>
                This plugin comes from a file on your computer, not the reviewed community
                directory. Only install it if you trust whoever made it.
              </p>
              <p>
                Installing doesn&apos;t turn it on: you&apos;ll review and approve its permissions
                first.
              </p>
              {plugin.codeSha256 && (
                <p style={{ color: 'var(--text-tertiary)' }}>
                  plugin.js SHA-256: <code className="break-all">{plugin.codeSha256}</code>
                </p>
              )}
            </div>
          ) : (
            <div
              className="p-3 text-xs"
              style={{
                backgroundColor: 'var(--bg-inset)',
                borderRadius: 'var(--radius-sm)',
                color: 'var(--text-secondary)',
              }}
            >
              Plugins are listed only after the Moldavite maintainer reviews them, which lowers the
              risk but isn&apos;t a guarantee. Moldavite downloads only the listed files and checks
              both SHA-256 hashes. Installing doesn&apos;t turn it on: you&apos;ll review and
              approve its permissions first.
              {replacing && ' Changed code or permissions always need your approval again.'}
            </div>
          )}
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

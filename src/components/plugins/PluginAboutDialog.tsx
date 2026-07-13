/**
 * Host-rendered install and help dialog sourced only from validated manifest
 * metadata. No plugin code runs to produce this content.
 */
import { Fragment, useEffect, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Puzzle, X } from 'lucide-react';
import { useFocusTrap } from '@/hooks/useFocusTrap';
import { pluginPermissionLabel } from '@/lib/plugins/permissionLabels';
import type { PluginManifest, PluginManifestCommand } from '@/lib/plugins/types';

export interface PluginAboutDialogProps {
  manifest: PluginManifest;
  /** Runtime fallback for legacy manifests without declarative commands. */
  registeredCommands?: PluginManifestCommand[];
  onClose: () => void;
}

function MarkdownLite({ children }: { children: string }) {
  const parts = children.split(/(`[^`\n]+`|\*\*[^*\n]+\*\*)/g);
  return (
    <>
      {parts.map((part, index) => {
        if (part.startsWith('`') && part.endsWith('`')) {
          return (
            <code
              key={index}
              className="text-[0.92em]"
              style={{
                backgroundColor: 'var(--bg-inset)',
                padding: '1px 4px',
                borderRadius: 'var(--radius-sm)',
              }}
            >
              {part.slice(1, -1)}
            </code>
          );
        }
        if (part.startsWith('**') && part.endsWith('**')) {
          return <strong key={index}>{part.slice(2, -2)}</strong>;
        }
        return <Fragment key={index}>{part}</Fragment>;
      })}
    </>
  );
}

export function PluginAboutDialog({
  manifest,
  registeredCommands = [],
  onClose,
}: PluginAboutDialogProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  useFocusTrap(dialogRef, true);
  const commands = useMemo(
    () => (manifest.commands?.length ? manifest.commands : registeredCommands),
    [manifest.commands, registeredCommands]
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
      className="fixed inset-0 modal-backdrop-dark flex items-center justify-center z-[10001] modal-backdrop-enter"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        className="w-full max-w-lg mx-4 max-h-[82vh] flex flex-col modal-elevated modal-content-enter"
        style={{ borderRadius: 'var(--radius-md)' }}
        role="dialog"
        aria-modal="true"
        aria-labelledby="plugin-about-title"
      >
        <div
          className="flex items-center justify-between px-6 py-4 flex-shrink-0"
          style={{ borderBottom: '1px solid var(--border-default)' }}
        >
          <h2
            id="plugin-about-title"
            className="text-lg font-semibold"
            style={{ color: 'var(--text-primary)' }}
          >
            About this plugin
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="p-1 focus-ring"
            style={{ color: 'var(--text-muted)', borderRadius: 'var(--radius-sm)' }}
            aria-label="Close plugin information"
          >
            <X aria-hidden="true" className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-5">
          <div className="flex items-start gap-3">
            <div
              className="flex-shrink-0 p-2.5"
              style={{
                backgroundColor: 'var(--accent-subtle)',
                borderRadius: 'var(--radius-md)',
                color: 'var(--accent-primary)',
              }}
              aria-hidden="true"
            >
              <Puzzle className="w-6 h-6" />
            </div>
            <div className="min-w-0">
              <h3 className="text-base font-semibold" style={{ color: 'var(--text-primary)' }}>
                {manifest.name}{' '}
                <span className="text-xs font-normal" style={{ color: 'var(--text-tertiary)' }}>
                  v{manifest.version}
                </span>
              </h3>
              {manifest.author && (
                <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
                  by {manifest.author}
                </p>
              )}
              <p className="text-sm mt-1" style={{ color: 'var(--text-secondary)' }}>
                {manifest.description ?? 'This plugin extends Moldavite with additional commands.'}
              </p>
            </div>
          </div>

          <section aria-labelledby="plugin-about-commands">
            <h4
              id="plugin-about-commands"
              className="text-xs font-medium uppercase tracking-wide mb-1.5"
              style={{ color: 'var(--text-tertiary)' }}
            >
              Commands
            </h4>
            {commands.length > 0 ? (
              <ul className="space-y-1">
                {commands.map((command) => (
                  <li
                    key={command.id}
                    className="text-sm flex gap-2"
                    style={{ color: 'var(--text-secondary)' }}
                  >
                    <span aria-hidden="true" style={{ color: 'var(--accent-primary)' }}>
                      &bull;
                    </span>
                    <span>{command.label}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm" style={{ color: 'var(--text-tertiary)' }}>
                No commands are declared in this manifest. Enable the plugin to discover any
                commands it registers at runtime.
              </p>
            )}
          </section>

          <section aria-labelledby="plugin-about-start">
            <h4
              id="plugin-about-start"
              className="text-xs font-medium uppercase tracking-wide mb-1.5"
              style={{ color: 'var(--text-tertiary)' }}
            >
              How to start
            </h4>
            {manifest.instructions?.length ? (
              <ol className="space-y-2 list-decimal pl-5">
                {manifest.instructions.map((step, index) => (
                  <li
                    key={index}
                    className="text-sm pl-1"
                    style={{ color: 'var(--text-secondary)' }}
                  >
                    <MarkdownLite>{step}</MarkdownLite>
                  </li>
                ))}
              </ol>
            ) : (
              <ol className="space-y-2 list-decimal pl-5">
                <li className="text-sm pl-1" style={{ color: 'var(--text-secondary)' }}>
                  Enable the plugin and review its requested permissions.
                </li>
                <li className="text-sm pl-1" style={{ color: 'var(--text-secondary)' }}>
                  Open the command palette with <code>Cmd+P</code>
                  {commands.length > 0 ? ` and choose ${commands[0].label}.` : '.'}
                </li>
              </ol>
            )}
          </section>

          <section aria-labelledby="plugin-about-permissions">
            <h4
              id="plugin-about-permissions"
              className="text-xs font-medium uppercase tracking-wide mb-1.5"
              style={{ color: 'var(--text-tertiary)' }}
            >
              Permissions
            </h4>
            {manifest.permissions?.length ? (
              <ul className="space-y-1">
                {manifest.permissions.map((permission) => (
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
                      {permission === 'net.fetch' && manifest.allowedHosts?.length
                        ? ` (${manifest.allowedHosts.join(', ')})`
                        : ''}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm" style={{ color: 'var(--text-tertiary)' }}>
                No additional capabilities declared.
              </p>
            )}
          </section>
        </div>

        <div
          className="flex justify-end px-6 py-4 flex-shrink-0"
          style={{ borderTop: '1px solid var(--border-default)' }}
        >
          <button type="button" onClick={onClose} autoFocus className="btn btn-primary focus-ring">
            Got it
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}

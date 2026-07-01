/**
 * PluginsSection — manage plugins installed under the active Forge's
 * `.plugins/` directory: enable/disable (behind a permission sheet), view
 * permissions, uninstall, and install the bundled example. See docs/PLUGINS.md.
 */

import { useCallback, useEffect, useState } from 'react';
import { Puzzle, ExternalLink, Trash2, Download, FileCode } from 'lucide-react';
import { open as shellOpen } from '@tauri-apps/plugin-shell';
import { usePluginStore } from '@/stores';
import { useToastStore } from '@/stores/toastStore';
import { safeInvoke } from '@/lib/ipc';
import { loadEnabledPlugins } from '@/lib/plugins/host';
import type { PluginInfo } from '@/lib/plugins/types';
import { PluginPermissionSheet } from '@/components/plugins/PluginPermissionSheet';
import { Toggle } from '../common';

const PLUGINS_DOC_URL = 'https://github.com/mauropereiira/Moldavite/blob/main/docs/PLUGINS.md';

type SheetState = { info: PluginInfo; mode: 'grant' | 'view' } | null;

export function PluginsSection() {
  const [plugins, setPlugins] = useState<PluginInfo[]>([]);
  const [busy, setBusy] = useState(false);
  const [sheet, setSheet] = useState<SheetState>(null);
  const { isEnabledAndGranted, needsGrant, grant, disable, revoke } = usePluginStore();
  const addToast = useToastStore((s) => s.addToast);

  const refresh = useCallback(async () => {
    const infos = await loadEnabledPlugins();
    setPlugins(infos);
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const openExternal = (url: string) =>
    shellOpen(url).catch(() => window.open(url, '_blank', 'noopener,noreferrer'));

  const handleToggle = async (info: PluginInfo, next: boolean) => {
    const { id, version } = info.manifest;
    if (next) {
      if (needsGrant(id, version)) {
        setSheet({ info, mode: 'grant' });
        return;
      }
      grant(id, version);
    } else {
      disable(id);
    }
    await refresh();
  };

  const confirmGrant = async () => {
    if (!sheet) return;
    grant(sheet.info.manifest.id, sheet.info.manifest.version);
    setSheet(null);
    await refresh();
  };

  const handleUninstall = async (info: PluginInfo) => {
    const { id, name } = info.manifest;
    if (!window.confirm(`Uninstall "${name}"? This deletes its folder from your Forge.`)) return;
    setBusy(true);
    try {
      await safeInvoke('uninstall_plugin', { id });
      revoke(id); // forget the grant so a re-dropped id must re-consent
      await refresh();
      addToast('success', `Uninstalled ${name}`);
    } catch (e) {
      addToast('error', e instanceof Error ? e.message : 'Uninstall failed');
    } finally {
      setBusy(false);
    }
  };

  const handleInstallExample = async () => {
    setBusy(true);
    try {
      await safeInvoke('install_example_plugin');
      await refresh();
      addToast('success', 'Example plugin installed — enable it below');
    } catch (e) {
      addToast('error', e instanceof Error ? e.message : 'Install failed');
    } finally {
      setBusy(false);
    }
  };

  const statusText = (info: PluginInfo): string => {
    if (info.status === 'invalid') return 'Invalid';
    if (info.status === 'incompatible') return 'Incompatible';
    return isEnabledAndGranted(info.manifest.id, info.manifest.version) ? 'Enabled' : 'Disabled';
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start gap-3">
        <div
          className="flex-shrink-0 p-2"
          style={{ backgroundColor: 'var(--accent-subtle)', borderRadius: 'var(--radius-sm)', color: 'var(--accent-primary)' }}
        >
          <Puzzle aria-hidden="true" className="w-5 h-5" />
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>
            Plugins
          </h3>
          <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
            Add commands to Moldavite. Plugins live in your Forge under{' '}
            <code style={{ backgroundColor: 'var(--bg-inset)', padding: '1px 4px', borderRadius: 'var(--radius-sm)' }}>.plugins/</code>{' '}
            and run with access to your notes &mdash; only enable ones you trust.
          </p>
        </div>
      </div>

      {/* Installed plugins */}
      {plugins.length === 0 ? (
        <div
          className="p-6 text-center"
          style={{ backgroundColor: 'var(--bg-panel)', border: '1px dashed var(--border-default)', borderRadius: 'var(--radius-md)' }}
        >
          <p className="text-sm" style={{ color: 'var(--text-tertiary)' }}>
            No plugins installed yet.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {plugins.map((info) => {
            const { id, name, version, author, description } = info.manifest;
            const ok = info.status === 'ok';
            const enabled = ok && isEnabledAndGranted(id, version);
            return (
              <div
                key={id}
                className="p-4 flex items-start justify-between gap-3"
                style={{ backgroundColor: 'var(--bg-panel)', borderRadius: 'var(--radius-md)' }}
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                      {ok ? name : id}
                    </span>
                    {ok && (
                      <span className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
                        v{version}
                        {author ? ` · ${author}` : ''}
                      </span>
                    )}
                    <span
                      className="text-[10px] px-1.5 py-0.5"
                      style={{
                        backgroundColor: 'var(--bg-inset)',
                        color: ok ? 'var(--text-tertiary)' : 'var(--text-error, #ef4444)',
                        borderRadius: 'var(--radius-sm)',
                      }}
                    >
                      {statusText(info)}
                    </span>
                  </div>
                  {ok && description && (
                    <p className="text-xs mt-1" style={{ color: 'var(--text-secondary)' }}>
                      {description}
                    </p>
                  )}
                  {!ok && info.reason && (
                    <p className="text-xs mt-1" style={{ color: 'var(--text-error, #ef4444)' }}>
                      {info.reason}
                    </p>
                  )}
                  <div className="flex items-center gap-3 mt-2">
                    {ok && (
                      <button
                        type="button"
                        onClick={() => setSheet({ info, mode: 'view' })}
                        className="text-xs hover:underline"
                        style={{ color: 'var(--accent-primary)', background: 'transparent' }}
                      >
                        View permissions
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => handleUninstall(info)}
                      disabled={busy}
                      className="text-xs flex items-center gap-1 hover:underline"
                      style={{ color: 'var(--text-tertiary)', background: 'transparent' }}
                    >
                      <Trash2 aria-hidden="true" className="w-3 h-3" />
                      Uninstall
                    </button>
                  </div>
                </div>
                {ok && (
                  <Toggle enabled={enabled} onChange={(next) => handleToggle(info, next)} />
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Actions */}
      <div className="p-4 space-y-3" style={{ backgroundColor: 'var(--bg-panel)', borderRadius: 'var(--radius-md)' }}>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={handleInstallExample}
            disabled={busy}
            className="flex items-center gap-2 px-3 py-1.5 text-sm font-medium transition-colors"
            style={{
              backgroundColor: 'var(--bg-elevated)',
              border: '1px solid var(--border-default)',
              borderRadius: 'var(--radius-sm)',
              color: 'var(--text-secondary)',
            }}
          >
            <Download aria-hidden="true" className="w-4 h-4" />
            Install example plugin
          </button>
          <button
            type="button"
            onClick={() => openExternal(PLUGINS_DOC_URL)}
            className="flex items-center gap-2 px-3 py-1.5 text-sm font-medium transition-colors"
            style={{
              backgroundColor: 'var(--bg-elevated)',
              border: '1px solid var(--border-default)',
              borderRadius: 'var(--radius-sm)',
              color: 'var(--text-secondary)',
            }}
          >
            <FileCode aria-hidden="true" className="w-4 h-4" />
            Build your own
            <ExternalLink aria-hidden="true" className="w-3 h-3" />
          </button>
        </div>
        <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
          To install a plugin manually, drop its folder into{' '}
          <code style={{ backgroundColor: 'var(--bg-inset)', padding: '1px 4px', borderRadius: 'var(--radius-sm)' }}>.plugins/</code>{' '}
          in your Forge and reopen this tab.
        </p>
      </div>

      {sheet && (
        <PluginPermissionSheet
          manifest={sheet.info.manifest}
          permissions={sheet.info.manifest.permissions ?? []}
          mode={sheet.mode}
          onEnable={confirmGrant}
          onClose={() => setSheet(null)}
        />
      )}
    </div>
  );
}

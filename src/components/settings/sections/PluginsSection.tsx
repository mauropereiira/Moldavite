/**
 * PluginsSection — manage plugins installed under the active Forge's
 * `.plugins/` directory: enable/disable (behind a permission sheet), view
 * permissions, uninstall, install bundled examples, and explicitly browse the
 * public community registry. See docs/PLUGINS.md.
 */

import { useCallback, useEffect, useState } from 'react';
import { Puzzle, ExternalLink, Trash2, Download, FileCode, Globe2, RefreshCw } from 'lucide-react';
import { open as shellOpen } from '@tauri-apps/plugin-shell';
import { usePluginStore, usePluginCommandStore } from '@/stores';
import { useToastStore } from '@/stores/toastStore';
import { safeInvoke } from '@/lib/ipc';
import { loadEnabledPlugins } from '@/lib/plugins/host';
import type { PluginInfo } from '@/lib/plugins/types';
import {
  COMMUNITY_REGISTRY_URL,
  communityInstallState,
  communityPluginFileUrl,
  parseCommunityRegistry,
  type CommunityPlugin,
} from '@/lib/plugins/registry';
import { PluginPermissionSheet } from '@/components/plugins/PluginPermissionSheet';
import { PluginAboutDialog } from '@/components/plugins/PluginAboutDialog';
import { ConfirmDialog } from '@/components/ui';
import { Toggle } from '../common';

const PLUGINS_DOC_URL = 'https://github.com/mauropereiira/Moldavite/blob/main/docs/PLUGINS.md';

type SheetState = { info: PluginInfo; mode: 'grant' | 'view' } | null;
type RegistryStatus = 'idle' | 'loading' | 'ready' | 'error';

export function PluginsSection() {
  const [plugins, setPlugins] = useState<PluginInfo[]>([]);
  const [busy, setBusy] = useState(false);
  const [sheet, setSheet] = useState<SheetState>(null);
  const [about, setAbout] = useState<PluginInfo | null>(null);
  const [pendingUninstall, setPendingUninstall] = useState<PluginInfo | null>(null);
  const [pendingUpdate, setPendingUpdate] = useState<CommunityPlugin | null>(null);
  const [registryStatus, setRegistryStatus] = useState<RegistryStatus>('idle');
  const [communityPlugins, setCommunityPlugins] = useState<CommunityPlugin[]>([]);
  const [registryError, setRegistryError] = useState<string | null>(null);
  const [rejectedEntries, setRejectedEntries] = useState(0);
  const [installingId, setInstallingId] = useState<string | null>(null);
  const { isEnabledAndGranted, needsGrant, grant, disable, revoke, approvedHosts, revokeHost } =
    usePluginStore();
  const registeredCommands = usePluginCommandStore((s) => s.commands);
  const addToast = useToastStore((s) => s.addToast);

  const refresh = useCallback(async () => {
    const infos = await loadEnabledPlugins();
    setPlugins(infos);
    return infos;
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const openExternal = (url: string) =>
    shellOpen(url).catch(() => window.open(url, '_blank', 'noopener,noreferrer'));

  const handleToggle = async (info: PluginInfo, next: boolean) => {
    const { id, version } = info.manifest;
    if (next) {
      if (needsGrant(id, version, info.contentHash)) {
        setSheet({ info, mode: 'grant' });
        return;
      }
      grant(id, version, info.contentHash);
    } else {
      disable(id);
    }
    await refresh();
  };

  const confirmGrant = async () => {
    if (!sheet) return;
    grant(sheet.info.manifest.id, sheet.info.manifest.version, sheet.info.contentHash);
    setSheet(null);
    await refresh();
  };

  const handleUninstall = (info: PluginInfo) => setPendingUninstall(info);

  const confirmUninstall = async () => {
    const info = pendingUninstall;
    setPendingUninstall(null);
    if (!info) return;
    const { id, name } = info.manifest;
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
      const infos = await refresh();
      addToast('success', 'Example plugin installed — enable it below');
      setAbout(infos.find((info) => info.manifest.id === 'moldavite-example') ?? null);
    } catch (e) {
      addToast('error', e instanceof Error ? e.message : 'Install failed');
    } finally {
      setBusy(false);
    }
  };

  const handleInstallWordPress = async () => {
    setBusy(true);
    try {
      await safeInvoke('install_wordpress_plugin');
      const infos = await refresh();
      addToast('success', 'Publish to WordPress installed — enable it below');
      setAbout(infos.find((info) => info.manifest.id === 'moldavite-wordpress') ?? null);
    } catch (e) {
      addToast('error', e instanceof Error ? e.message : 'Install failed');
    } finally {
      setBusy(false);
    }
  };

  const browseCommunityPlugins = async () => {
    setRegistryStatus('loading');
    setRegistryError(null);
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 15_000);
    try {
      const response = await fetch(COMMUNITY_REGISTRY_URL, {
        cache: 'no-store',
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`GitHub returned status ${response.status}`);
      const parsed = parseCommunityRegistry(await response.json());
      setCommunityPlugins(parsed.plugins);
      setRejectedEntries(parsed.rejectedEntries);
      setRegistryStatus('ready');
    } catch (error) {
      const detail =
        error instanceof Error && error.name !== 'AbortError' ? ` ${error.message}` : '';
      setRegistryError(
        `Couldn't reach the community registry. Check your connection and try again.${detail}`
      );
      setRegistryStatus('error');
    } finally {
      window.clearTimeout(timeout);
    }
  };

  const installCommunityPlugin = async (plugin: CommunityPlugin, confirmUpdate: boolean) => {
    setBusy(true);
    setInstallingId(plugin.id);
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 30_000);
    try {
      const [manifestResponse, pluginResponse] = await Promise.all([
        fetch(communityPluginFileUrl(plugin, 'manifest.json'), {
          cache: 'no-store',
          signal: controller.signal,
        }),
        fetch(communityPluginFileUrl(plugin, 'plugin.js'), {
          cache: 'no-store',
          signal: controller.signal,
        }),
      ]);
      if (!manifestResponse.ok || !pluginResponse.ok) {
        throw new Error(
          `Couldn't download ${plugin.name} from GitHub. Check your connection and try again.`
        );
      }
      const [manifestJson, pluginJs] = await Promise.all([
        manifestResponse.text(),
        pluginResponse.text(),
      ]);
      await safeInvoke('install_plugin_from_data', {
        id: plugin.id,
        manifestJson,
        pluginJs,
        expectedManifestSha256: plugin.files['manifest.json'].sha256,
        expectedPluginSha256: plugin.files['plugin.js'].sha256,
        confirmUpdate,
      });
      const infos = await refresh();
      addToast(
        'success',
        `${plugin.name} ${confirmUpdate ? 'updated' : 'installed'} — enable it below`
      );
      setAbout(infos.find((info) => info.manifest.id === plugin.id) ?? null);
    } catch (error) {
      const message =
        error instanceof Error && error.name !== 'AbortError'
          ? error.message
          : `Couldn't download ${plugin.name} from GitHub. Check your connection and try again.`;
      addToast('error', message);
    } finally {
      window.clearTimeout(timeout);
      setBusy(false);
      setInstallingId(null);
    }
  };

  const statusText = (info: PluginInfo): string => {
    if (info.status === 'invalid') return 'Invalid';
    if (info.status === 'incompatible') return 'Incompatible';
    return isEnabledAndGranted(info.manifest.id, info.manifest.version, info.contentHash)
      ? 'Enabled'
      : 'Disabled';
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start gap-3">
        <div
          className="flex-shrink-0 p-2"
          style={{
            backgroundColor: 'var(--accent-subtle)',
            borderRadius: 'var(--radius-sm)',
            color: 'var(--accent-primary)',
          }}
        >
          <Puzzle aria-hidden="true" className="w-5 h-5" />
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>
            Plugins
          </h3>
          <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
            Add commands to Moldavite. Plugins live in your Forge under{' '}
            <code
              style={{
                backgroundColor: 'var(--bg-inset)',
                padding: '1px 4px',
                borderRadius: 'var(--radius-sm)',
              }}
            >
              .plugins/
            </code>{' '}
            and run with access to your notes &mdash; only enable ones you trust.
          </p>
        </div>
      </div>

      {/* Installed plugins */}
      {plugins.length === 0 ? (
        <div
          className="p-6 text-center"
          style={{
            backgroundColor: 'var(--bg-panel)',
            border: '1px dashed var(--border-default)',
            borderRadius: 'var(--radius-md)',
          }}
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
            const enabled = ok && isEnabledAndGranted(id, version, info.contentHash);
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
                    <button
                      type="button"
                      onClick={() => setAbout(info)}
                      className="text-sm leading-none p-0.5 focus-ring"
                      style={{ color: 'var(--accent-primary)', borderRadius: 'var(--radius-sm)' }}
                      aria-label={`About ${ok ? name : id}`}
                      title={`About ${ok ? name : id}`}
                    >
                      <span aria-hidden="true">ⓘ</span>
                    </button>
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
                {ok && <Toggle enabled={enabled} onChange={(next) => handleToggle(info, next)} />}
              </div>
            );
          })}
        </div>
      )}

      {/* Actions */}
      <div
        className="p-4 space-y-3"
        style={{ backgroundColor: 'var(--bg-panel)', borderRadius: 'var(--radius-md)' }}
      >
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={handleInstallWordPress}
            disabled={busy}
            className="flex items-center gap-2 px-3 py-1.5 text-sm font-medium transition-colors"
            style={{
              backgroundColor: 'var(--accent-primary)',
              borderRadius: 'var(--radius-sm)',
              color: 'white',
            }}
          >
            <Download aria-hidden="true" className="w-4 h-4" />
            Install Publish to WordPress
          </button>
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
            onClick={browseCommunityPlugins}
            disabled={registryStatus === 'loading' || busy}
            className="flex items-center gap-2 px-3 py-1.5 text-sm font-medium transition-colors"
            style={{
              backgroundColor: 'var(--bg-elevated)',
              border: '1px solid var(--border-default)',
              borderRadius: 'var(--radius-sm)',
              color: 'var(--text-secondary)',
            }}
          >
            {registryStatus === 'loading' ? (
              <RefreshCw aria-hidden="true" className="w-4 h-4 animate-spin" />
            ) : (
              <Globe2 aria-hidden="true" className="w-4 h-4" />
            )}
            {registryStatus === 'idle' ? 'Browse community plugins' : 'Refresh community plugins'}
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
        {registryStatus === 'idle' && (
          <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
            Browse community plugins contacts GitHub only when you click it. Moldavite never checks
            the registry at startup or in the background.
          </p>
        )}
        <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
          To install a plugin manually, drop its folder into{' '}
          <code
            style={{
              backgroundColor: 'var(--bg-inset)',
              padding: '1px 4px',
              borderRadius: 'var(--radius-sm)',
            }}
          >
            .plugins/
          </code>{' '}
          in your Forge and reopen this tab.
        </p>
      </div>

      {registryStatus === 'error' && (
        <div
          role="alert"
          className="p-4 text-sm"
          style={{
            backgroundColor: 'var(--bg-panel)',
            border: '1px solid var(--border-default)',
            borderRadius: 'var(--radius-md)',
            color: 'var(--text-secondary)',
          }}
        >
          {registryError}
        </div>
      )}

      {registryStatus === 'ready' && (
        <section aria-labelledby="community-plugin-heading" className="space-y-3">
          <div>
            <h4
              id="community-plugin-heading"
              className="text-sm font-semibold"
              style={{ color: 'var(--text-primary)' }}
            >
              Community plugins
            </h4>
            <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
              Files come only from Moldavite&apos;s pinned community repository. Rust verifies both
              registry hashes before anything is installed.
            </p>
          </div>

          {rejectedEntries > 0 && (
            <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
              {rejectedEntries} malformed registry{' '}
              {rejectedEntries === 1 ? 'entry was' : 'entries were'} skipped.
            </p>
          )}

          {communityPlugins.length === 0 ? (
            <div
              className="p-5 text-center text-sm"
              style={{
                backgroundColor: 'var(--bg-panel)',
                border: '1px dashed var(--border-default)',
                borderRadius: 'var(--radius-md)',
                color: 'var(--text-tertiary)',
              }}
            >
              No valid community plugins are listed right now.
            </div>
          ) : (
            <div className="space-y-2">
              {communityPlugins.map((plugin) => {
                const installState = communityInstallState(plugin, plugins);
                const installing = installingId === plugin.id;
                return (
                  <article
                    key={plugin.id}
                    className="p-4"
                    style={{
                      backgroundColor: 'var(--bg-panel)',
                      border: '1px solid var(--border-default)',
                      borderRadius: 'var(--radius-md)',
                    }}
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div className="min-w-0">
                        <div className="flex items-baseline gap-2 flex-wrap">
                          <h5
                            className="text-sm font-semibold"
                            style={{ color: 'var(--text-primary)' }}
                          >
                            {plugin.name}
                          </h5>
                          <span className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
                            v{plugin.version} · {plugin.author}
                          </span>
                        </div>
                        <p className="text-xs mt-1" style={{ color: 'var(--text-secondary)' }}>
                          {plugin.description}
                        </p>
                      </div>
                      <button
                        type="button"
                        disabled={busy || installState === 'installed'}
                        onClick={() => {
                          if (installState === 'update-available') setPendingUpdate(plugin);
                          else void installCommunityPlugin(plugin, false);
                        }}
                        className="flex-shrink-0 px-3 py-1.5 text-xs font-medium focus-ring"
                        style={{
                          backgroundColor:
                            installState === 'installed'
                              ? 'var(--bg-inset)'
                              : 'var(--accent-primary)',
                          borderRadius: 'var(--radius-sm)',
                          color: installState === 'installed' ? 'var(--text-tertiary)' : 'white',
                        }}
                      >
                        {installing
                          ? 'Installing…'
                          : installState === 'installed'
                            ? 'Installed'
                            : installState === 'update-available'
                              ? 'Update'
                              : 'Install'}
                      </button>
                    </div>
                    <div className="flex flex-wrap gap-1.5 mt-3" aria-label="Plugin permissions">
                      {plugin.permissions.length === 0 && (
                        <span
                          className="text-[10px] px-2 py-0.5"
                          style={{
                            backgroundColor: 'var(--bg-inset)',
                            borderRadius: '999px',
                            color: 'var(--text-tertiary)',
                          }}
                        >
                          No extra permissions
                        </span>
                      )}
                      {plugin.permissions.map((permission) => (
                        <span
                          key={permission}
                          className="text-[10px] px-2 py-0.5"
                          style={{
                            backgroundColor: 'var(--accent-subtle)',
                            borderRadius: '999px',
                            color: 'var(--accent-primary)',
                          }}
                        >
                          {permission}
                        </span>
                      ))}
                      {plugin.allowedHosts.map((host) => (
                        <span
                          key={host}
                          className="text-[10px] px-2 py-0.5"
                          style={{
                            backgroundColor: 'var(--bg-inset)',
                            borderRadius: '999px',
                            color: 'var(--text-secondary)',
                          }}
                        >
                          host: {host}
                        </span>
                      ))}
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </section>
      )}

      {pendingUninstall && (
        <ConfirmDialog
          title="Uninstall Plugin"
          message={`Uninstall "${pendingUninstall.manifest.name}"? This deletes its folder from your Forge.`}
          confirmLabel="Uninstall"
          danger
          onConfirm={confirmUninstall}
          onCancel={() => setPendingUninstall(null)}
        />
      )}

      {pendingUpdate && (
        <ConfirmDialog
          title="Update community plugin?"
          message={`Replace the installed copy of "${pendingUpdate.name}" with registry version ${pendingUpdate.version}? Its files will be hash-verified, and changed code or permissions must be granted again before it runs.`}
          confirmLabel="Update"
          onConfirm={() => {
            const plugin = pendingUpdate;
            setPendingUpdate(null);
            void installCommunityPlugin(plugin, true);
          }}
          onCancel={() => setPendingUpdate(null)}
        />
      )}

      {sheet && (
        <PluginPermissionSheet
          manifest={sheet.info.manifest}
          permissions={sheet.info.manifest.permissions ?? []}
          approvedHosts={approvedHosts(sheet.info.manifest.id)}
          commands={registeredCommands
            .filter((c) => c.pluginId === sheet.info.manifest.id)
            .map((c) => ({ id: c.id, label: c.label }))}
          mode={sheet.mode}
          onEnable={confirmGrant}
          onRevokeHost={(host) => revokeHost(sheet.info.manifest.id, host)}
          onClose={() => setSheet(null)}
        />
      )}

      {about && (
        <PluginAboutDialog
          manifest={about.manifest}
          registeredCommands={registeredCommands
            .filter((command) => command.pluginId === about.manifest.id)
            .map((command) => ({ id: command.id, label: command.label }))}
          onClose={() => setAbout(null)}
        />
      )}
    </div>
  );
}

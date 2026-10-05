/**
 * PluginsSection — manage plugins installed under the active Forge's
 * `.plugins/` directory: enable/disable (behind a permission sheet), view
 * permissions, uninstall, install from the community directory or from a
 * package on disk, and stop every plugin when one misbehaves. Everything
 * except browsing the directory works offline. See docs/PLUGINS.md.
 */

import { useCallback, useEffect, useState } from 'react';
import {
  Puzzle,
  ExternalLink,
  Trash2,
  Download,
  FileCode,
  Globe2,
  FolderOpen,
  FileArchive,
  PauseCircle,
  PlayCircle,
  Search,
} from 'lucide-react';
import { open as shellOpen } from '@tauri-apps/plugin-shell';
import { usePluginStore, usePluginCommandStore, usePluginInstallStore } from '@/stores';
import type { PluginInstallRequest } from '@/stores';
import { usePluginSafeModeStore, type SafeModeStatus } from '@/stores/pluginSafeModeStore';
import { useToastStore } from '@/stores/toastStore';
import { safeInvoke } from '@/lib/ipc';
import { listPlugins, reconcilePlugins, setPluginsPaused } from '@/lib/plugins/host';
import { getPluginAppVersion } from '@/lib/plugins/api';
import type { PluginInfo } from '@/lib/plugins/types';
import {
  COMMUNITY_REGISTRY_URL,
  COMMUNITY_REPORT_URL,
  communityIncompatibility,
  communityInstallState,
  communityPluginFileUrl,
  communityPluginSourceUrl,
  parseCommunityRegistry,
  type CommunityPlugin,
} from '@/lib/plugins/registry';
import {
  choosePluginPackage,
  installImportCandidate,
  readImportCandidate,
  type ImportCandidate,
} from '@/lib/plugins/importPackage';
import { PluginPermissionSheet } from '@/components/plugins/PluginPermissionSheet';
import { DotLoader } from '@/components/ui/DotLoader';
import { PluginAboutDialog } from '@/components/plugins/PluginAboutDialog';
import { BrowserClipperCard } from '../BrowserClipperCard';
import {
  PluginInstallDialog,
  type InstalledAccess,
  type PluginInstallDetails,
} from '@/components/plugins/PluginInstallDialog';
import { ConfirmDialog } from '@/components/ui';
import { Toggle } from '../common';

const PLUGINS_DOC_URL = 'https://github.com/mauropereiira/Moldavite/blob/main/docs/PLUGINS.md';
const RECOVERY_DOC_URL = `${PLUGINS_DOC_URL}#if-a-plugin-stops-moldavite-from-working`;

type SheetState = { info: PluginInfo; mode: 'grant' | 'view' } | null;
type RegistryStatus = 'idle' | 'loading' | 'ready' | 'error';
type PendingInstall =
  | { kind: 'community'; plugin: CommunityPlugin; installed: InstalledAccess | null }
  | { kind: 'file'; candidate: ImportCandidate; installed: InstalledAccess | null }
  | null;

const secondaryButtonStyle = {
  backgroundColor: 'transparent',
  border: '1px solid var(--border-default)',
  borderRadius: 'var(--radius-sm)',
  color: 'var(--text-secondary)',
};

function accessOf(info: PluginInfo | undefined): InstalledAccess | null {
  if (!info) return null;
  return {
    version: info.manifest.version,
    permissions: info.manifest.permissions ?? [],
    allowedHosts: info.manifest.allowedHosts ?? [],
  };
}

function communityDetails(plugin: CommunityPlugin): PluginInstallDetails {
  return {
    id: plugin.id,
    name: plugin.name,
    version: plugin.version,
    author: plugin.author,
    description: plugin.description,
    permissions: plugin.permissions,
    allowedHosts: plugin.allowedHosts,
  };
}

function fileDetails({ manifest, pkg }: ImportCandidate): PluginInstallDetails {
  return {
    id: manifest.id,
    name: manifest.name,
    version: manifest.version,
    author: manifest.author,
    description: manifest.description,
    permissions: manifest.permissions ?? [],
    allowedHosts: manifest.allowedHosts ?? [],
    commands: manifest.commands,
    codeSha256: pkg.pluginSha256,
  };
}

function matchesQuery(plugin: CommunityPlugin, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  return [plugin.name, plugin.description, plugin.author, plugin.id, ...plugin.permissions].some(
    (value) => value.toLowerCase().includes(needle)
  );
}

function SafeModeNotice({
  status,
  plugins,
  busy,
  onResume,
}: {
  status: SafeModeStatus;
  plugins: PluginInfo[];
  busy: boolean;
  onResume: () => void;
}) {
  const names = status.pluginIds.map(
    (id) => plugins.find((info) => info.manifest.id === id)?.manifest.name ?? id
  );
  const why =
    status.reason === 'unfinishedStart'
      ? "Plugins are off because Moldavite's last start didn't finish."
      : status.reason === 'launchFlag'
        ? 'Plugins are off because Moldavite was started in safe mode.'
        : 'You stopped all plugins for this session.';
  return (
    <div
      role="status"
      className="p-4 space-y-2 text-sm"
      style={{
        border: '1px solid var(--border-default)',
        borderRadius: 'var(--radius-md)',
        color: 'var(--text-secondary)',
      }}
    >
      <p className="font-medium" style={{ color: 'var(--text-primary)' }}>
        {why}
      </p>
      {names.length > 0 && <p>Plugins that were starting: {names.join(', ')}.</p>}
      <p>
        Your notes are fine. Turn off or uninstall any plugin you suspect below, then turn plugins
        back on. Nothing runs until you do.
      </p>
      <button
        type="button"
        onClick={onResume}
        disabled={busy}
        className="flex items-center gap-2 px-3 py-1.5 text-sm font-medium focus-ring"
        style={secondaryButtonStyle}
      >
        <PlayCircle aria-hidden="true" className="w-4 h-4" />
        Turn plugins back on
      </button>
    </div>
  );
}

export function PluginsSection() {
  const [plugins, setPlugins] = useState<PluginInfo[]>([]);
  const [busy, setBusy] = useState(false);
  const [sheet, setSheet] = useState<SheetState>(null);
  const [about, setAbout] = useState<PluginInfo | null>(null);
  const [pendingUninstall, setPendingUninstall] = useState<PluginInfo | null>(null);
  const [pendingInstall, setPendingInstall] = useState<PendingInstall>(null);
  const [registryStatus, setRegistryStatus] = useState<RegistryStatus>('idle');
  const [communityPlugins, setCommunityPlugins] = useState<CommunityPlugin[]>([]);
  const [registryError, setRegistryError] = useState<string | null>(null);
  const [rejectedEntries, setRejectedEntries] = useState(0);
  const [installingId, setInstallingId] = useState<string | null>(null);
  const [highlightedId, setHighlightedId] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const { isEnabledAndGranted, needsGrant, grant, disable, revoke, approvedHosts, revokeHost } =
    usePluginStore();
  const grants = usePluginStore((s) => s.grants);
  const safeMode = usePluginSafeModeStore((s) => s.status);
  const registeredCommands = usePluginCommandStore((s) => s.commands);
  const addToast = useToastStore((s) => s.addToast);
  const installRequest = usePluginInstallStore((s) => s.pending);
  const clearInstallRequest = usePluginInstallStore((s) => s.clear);

  const refresh = useCallback(async () => {
    const infos = await listPlugins();
    setPlugins(infos);
    return infos;
  }, []);

  const reconcile = useCallback(async () => {
    const infos = await reconcilePlugins();
    setPlugins(infos);
    return infos;
  }, []);

  useEffect(() => {
    void refresh();
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
    await reconcile();
  };

  const confirmGrant = async () => {
    if (!sheet) return;
    grant(sheet.info.manifest.id, sheet.info.manifest.version, sheet.info.contentHash);
    setSheet(null);
    await reconcile();
  };

  const confirmUninstall = async () => {
    const info = pendingUninstall;
    setPendingUninstall(null);
    if (!info) return;
    const { id, name } = info.manifest;
    setBusy(true);
    try {
      await safeInvoke('uninstall_plugin', { id });
      revoke(id); // forget the grant so a re-dropped id must re-consent
      await reconcile();
      addToast('success', `Uninstalled ${name}`);
    } catch (e) {
      addToast('error', e instanceof Error ? e.message : 'Uninstall failed');
    } finally {
      setBusy(false);
    }
  };

  const afterInstall = async (id: string, message: string) => {
    const infos = await reconcile();
    addToast('success', message);
    setAbout(infos.find((info) => info.manifest.id === id) ?? null);
  };

  const installBundled = async (command: string, id: string, name: string) => {
    setBusy(true);
    try {
      await safeInvoke(command);
      await afterInstall(id, `${name} installed. Turn it on below when you're ready.`);
    } catch (e) {
      addToast('error', e instanceof Error ? e.message : 'Install failed');
    } finally {
      setBusy(false);
    }
  };

  const setPaused = async (paused: boolean) => {
    setBusy(true);
    try {
      await setPluginsPaused(paused);
      await refresh();
    } catch (e) {
      addToast('error', e instanceof Error ? e.message : "Couldn't change plugins");
    } finally {
      setBusy(false);
    }
  };

  const browseCommunityPlugins = useCallback(
    async (request?: PluginInstallRequest) => {
      if (request) clearInstallRequest(request.nonce);
      setRegistryStatus('loading');
      setRegistryError(null);
      const controller = new AbortController();
      const timeout = window.setTimeout(() => controller.abort(), 15_000);
      try {
        const installedPlugins = await refresh();
        const response = await fetch(COMMUNITY_REGISTRY_URL, {
          cache: 'no-store',
          signal: controller.signal,
        });
        if (!response.ok) throw new Error(`GitHub returned status ${response.status}`);
        const parsed = parseCommunityRegistry(await response.json());
        setCommunityPlugins(parsed.plugins);
        setRejectedEntries(parsed.rejectedEntries);
        setRegistryStatus('ready');

        if (request) {
          const requestedPlugin = parsed.plugins.find((plugin) => plugin.id === request.id);
          if (!requestedPlugin) {
            addToast('error', `“${request.id}” isn't in the community plugin directory.`);
            return;
          }

          setHighlightedId(requestedPlugin.id);
          const incompatible = communityIncompatibility(requestedPlugin, getPluginAppVersion());
          if (incompatible) {
            addToast('error', `${requestedPlugin.name}: ${incompatible}.`);
          } else if (communityInstallState(requestedPlugin, installedPlugins) === 'installed') {
            addToast('success', `${requestedPlugin.name} is already installed`);
          } else {
            setPendingInstall({
              kind: 'community',
              plugin: requestedPlugin,
              installed: accessOf(
                installedPlugins.find((info) => info.manifest.id === requestedPlugin.id)
              ),
            });
          }
          window.requestAnimationFrame(() => {
            document
              .getElementById(`community-plugin-${requestedPlugin.id}`)
              ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
          });
        }
      } catch (error) {
        const detail =
          error instanceof Error && error.name !== 'AbortError' ? ` ${error.message}` : '';
        setRegistryError(
          `Couldn't reach the community directory. Check your connection and try again. Installed plugins keep working offline.${detail}`
        );
        setRegistryStatus('error');
      } finally {
        window.clearTimeout(timeout);
      }
    },
    [addToast, clearInstallRequest, refresh]
  );

  useEffect(() => {
    if (installRequest) void browseCommunityPlugins(installRequest);
  }, [browseCommunityPlugins, installRequest]);

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
      await afterInstall(
        plugin.id,
        `${plugin.name} ${confirmUpdate ? 'updated' : 'installed'}. Turn it on below when you're ready.`
      );
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

  const importPackage = async (kind: 'zip' | 'folder') => {
    let path: string | null;
    try {
      path = await choosePluginPackage(kind);
    } catch (e) {
      addToast('error', e instanceof Error ? e.message : "Couldn't open the file picker");
      return;
    }
    if (!path) return;
    setBusy(true);
    try {
      const infos = await refresh();
      const candidate = await readImportCandidate(path, getPluginAppVersion());
      setPendingInstall({
        kind: 'file',
        candidate,
        installed: accessOf(infos.find((info) => info.manifest.id === candidate.manifest.id)),
      });
    } catch (e) {
      addToast('error', e instanceof Error ? e.message : "Couldn't read that plugin");
    } finally {
      setBusy(false);
    }
  };

  const confirmPendingInstall = async () => {
    const pending = pendingInstall;
    setPendingInstall(null);
    if (!pending) return;
    if (pending.kind === 'community') {
      await installCommunityPlugin(pending.plugin, !!pending.installed);
      return;
    }
    const { manifest } = pending.candidate;
    setBusy(true);
    try {
      await installImportCandidate(pending.candidate, !!pending.installed);
      await afterInstall(
        manifest.id,
        `${manifest.name} ${pending.installed ? 'replaced' : 'installed'}. Turn it on below when you're ready.`
      );
    } catch (e) {
      addToast('error', e instanceof Error ? e.message : 'Install failed');
    } finally {
      setBusy(false);
    }
  };

  /** Bundled installs refuse to overwrite, so hide the button once it is in. */
  const isInstalled = (id: string) => plugins.some((info) => info.manifest.id === id);

  const statusOf = (info: PluginInfo): { label: string; error: boolean } => {
    if (info.status === 'invalid') return { label: 'Invalid', error: true };
    if (info.status === 'incompatible') return { label: 'Incompatible', error: true };
    const { id, version } = info.manifest;
    if (isEnabledAndGranted(id, version, info.contentHash)) {
      return { label: safeMode.active ? 'Paused' : 'Enabled', error: false };
    }
    if (grants[id]?.enabled) return { label: 'Needs review', error: true };
    return { label: 'Disabled', error: false };
  };

  const appVersion = getPluginAppVersion();
  const visibleCommunityPlugins = communityPlugins.filter((plugin) => matchesQuery(plugin, query));

  return (
    <div className="space-y-6">
      <div className="flex items-start gap-3">
        <div
          className="flex-shrink-0 p-2"
          style={{
            backgroundColor: 'transparent',
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
                backgroundColor: 'transparent',
                padding: '1px 4px',
                borderRadius: 'var(--radius-sm)',
              }}
            >
              .plugins/
            </code>
            , run only after you approve what they ask for, and can read your notes when you allow
            it &mdash; only turn on ones you trust.
          </p>
        </div>
      </div>

      {safeMode.active && (
        <SafeModeNotice
          status={safeMode}
          plugins={plugins}
          busy={busy}
          onResume={() => void setPaused(false)}
        />
      )}

      {/* Installed plugins */}
      {plugins.length === 0 ? (
        <div
          className="p-6 text-center"
          style={{
            backgroundColor: 'transparent',
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
            const status = statusOf(info);
            // classify() stands in `version: '?'` when the manifest itself is unusable.
            const readable = version !== '?';
            return (
              <div
                key={id}
                className="p-4 flex items-start justify-between gap-3"
                style={{ backgroundColor: 'transparent', borderRadius: 'var(--radius-md)' }}
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                      {readable ? name : id}
                    </span>
                    {readable && (
                      <span className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
                        v{version}
                        {author ? ` · ${author}` : ''}
                      </span>
                    )}
                    <span
                      className="text-[10px] px-1.5 py-0.5"
                      style={{
                        backgroundColor: 'transparent',
                        color: status.error ? 'var(--text-error)' : 'var(--text-tertiary)',
                        borderRadius: 'var(--radius-sm)',
                      }}
                    >
                      {status.label}
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
                  {status.label === 'Needs review' && (
                    <p className="text-xs mt-1" style={{ color: 'var(--text-secondary)' }}>
                      Its files changed since you approved it, so it&apos;s off. Turn it on to
                      review what it asks for now.
                    </p>
                  )}
                  {!ok && info.reason && (
                    <p className="text-xs mt-1" style={{ color: 'var(--text-error)' }}>
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
                      onClick={() => setPendingUninstall(info)}
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
                  <Toggle
                    enabled={enabled}
                    onChange={(next) => handleToggle(info, next)}
                    ariaLabel={`Enable ${name}`}
                  />
                )}
              </div>
            );
          })}
        </div>
      )}

      <div
        className="p-4 space-y-3"
        style={{ backgroundColor: 'transparent', borderRadius: 'var(--radius-md)' }}
      >
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => void browseCommunityPlugins()}
            disabled={registryStatus === 'loading' || busy}
            className="flex items-center gap-2 px-3 py-1.5 text-sm font-medium transition-colors"
            style={secondaryButtonStyle}
          >
            {registryStatus === 'loading' ? (
              <DotLoader label="Loading community plugins" />
            ) : (
              <Globe2 aria-hidden="true" className="w-4 h-4" />
            )}
            {registryStatus === 'idle' ? 'Browse community plugins' : 'Refresh community plugins'}
          </button>
          <button
            type="button"
            onClick={() => void importPackage('zip')}
            disabled={busy}
            className="flex items-center gap-2 px-3 py-1.5 text-sm font-medium transition-colors"
            style={secondaryButtonStyle}
          >
            <FileArchive aria-hidden="true" className="w-4 h-4" />
            Install from .zip…
          </button>
          <button
            type="button"
            onClick={() => void importPackage('folder')}
            disabled={busy}
            className="flex items-center gap-2 px-3 py-1.5 text-sm font-medium transition-colors"
            style={secondaryButtonStyle}
          >
            <FolderOpen aria-hidden="true" className="w-4 h-4" />
            Install from folder…
          </button>
          {!isInstalled('moldavite-wordpress') && (
            <button
              type="button"
              onClick={() =>
                void installBundled(
                  'install_wordpress_plugin',
                  'moldavite-wordpress',
                  'Publish to WordPress'
                )
              }
              disabled={busy}
              className="flex items-center gap-2 px-3 py-1.5 text-sm font-medium transition-colors"
              style={secondaryButtonStyle}
            >
              <Download aria-hidden="true" className="w-4 h-4" />
              Install Publish to WordPress
            </button>
          )}
          {!isInstalled('moldavite-example') && (
            <button
              type="button"
              onClick={() =>
                void installBundled('install_example_plugin', 'moldavite-example', 'Example Plugin')
              }
              disabled={busy}
              className="flex items-center gap-2 px-3 py-1.5 text-sm font-medium transition-colors"
              style={secondaryButtonStyle}
            >
              <Download aria-hidden="true" className="w-4 h-4" />
              Install example plugin
            </button>
          )}
          <button
            type="button"
            onClick={() => openExternal(PLUGINS_DOC_URL)}
            className="flex items-center gap-2 px-3 py-1.5 text-sm font-medium transition-colors"
            style={secondaryButtonStyle}
          >
            <FileCode aria-hidden="true" className="w-4 h-4" />
            Build your own
            <ExternalLink aria-hidden="true" className="w-3 h-3" />
          </button>
        </div>
        {registryStatus === 'idle' && (
          <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
            Browse community plugins contacts GitHub only when you click it. Moldavite never checks
            the directory at startup or in the background.
          </p>
        )}
        <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
          A plugin package is a folder, or a .zip of one, holding manifest.json and plugin.js. New
          plugins stay off until you turn them on and approve what they ask for.
        </p>
      </div>

      {!safeMode.active && plugins.length > 0 && (
        <div className="p-4 space-y-2" style={{ borderRadius: 'var(--radius-md)' }}>
          <button
            type="button"
            onClick={() => void setPaused(true)}
            disabled={busy}
            className="flex items-center gap-2 px-3 py-1.5 text-sm font-medium transition-colors"
            style={secondaryButtonStyle}
          >
            <PauseCircle aria-hidden="true" className="w-4 h-4" />
            Stop all plugins
          </button>
          <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
            Stops every plugin until you turn them back on or restart Moldavite. If a plugin keeps
            Moldavite from opening,{' '}
            <button
              type="button"
              onClick={() => openExternal(RECOVERY_DOC_URL)}
              className="underline"
              style={{ color: 'var(--accent-primary)', background: 'transparent' }}
            >
              start it without plugins
            </button>
            .
          </p>
        </div>
      )}

      <BrowserClipperCard />

      {registryStatus === 'error' && (
        <div
          role="alert"
          className="p-4 text-sm"
          style={{
            backgroundColor: 'transparent',
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
              Every listed plugin was reviewed by the Moldavite maintainer. Files come only from
              Moldavite&apos;s pinned community repository, and both hashes are checked before
              anything is installed.
            </p>
          </div>

          {communityPlugins.length > 3 && (
            <label className="flex items-center gap-2 text-sm">
              <Search
                aria-hidden="true"
                className="w-4 h-4"
                style={{ color: 'var(--text-tertiary)' }}
              />
              <span className="sr-only">Search community plugins</span>
              <input
                type="search"
                className="input"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search by name, author or permission"
              />
            </label>
          )}

          {rejectedEntries > 0 && (
            <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
              {rejectedEntries} malformed directory{' '}
              {rejectedEntries === 1 ? 'entry was' : 'entries were'} skipped.
            </p>
          )}

          {visibleCommunityPlugins.length === 0 ? (
            <div
              className="p-5 text-center text-sm"
              style={{
                backgroundColor: 'transparent',
                border: '1px dashed var(--border-default)',
                borderRadius: 'var(--radius-md)',
                color: 'var(--text-tertiary)',
              }}
            >
              {communityPlugins.length === 0
                ? 'No valid community plugins are listed right now.'
                : 'No plugins match your search.'}
            </div>
          ) : (
            <div className="space-y-2">
              {visibleCommunityPlugins.map((plugin) => {
                const installState = communityInstallState(plugin, plugins);
                const incompatible = communityIncompatibility(plugin, appVersion);
                const installing = installingId === plugin.id;
                const installed = plugins.find((info) => info.manifest.id === plugin.id);
                return (
                  <article
                    key={plugin.id}
                    id={`community-plugin-${plugin.id}`}
                    className="p-4"
                    style={{
                      backgroundColor: 'transparent',
                      border:
                        highlightedId === plugin.id
                          ? '2px solid var(--accent-primary)'
                          : '1px solid var(--border-default)',
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
                        {incompatible && (
                          <p className="text-xs mt-1" style={{ color: 'var(--text-error)' }}>
                            {incompatible}
                          </p>
                        )}
                      </div>
                      <button
                        type="button"
                        disabled={busy || installState === 'installed' || !!incompatible}
                        onClick={() =>
                          setPendingInstall({
                            kind: 'community',
                            plugin,
                            installed: accessOf(installed),
                          })
                        }
                        className="flex-shrink-0 px-3 py-1.5 text-xs font-medium focus-ring"
                        style={{
                          backgroundColor: 'transparent',
                          borderRadius: 'var(--radius-sm)',
                          color:
                            installState === 'installed' || incompatible
                              ? 'var(--text-tertiary)'
                              : 'var(--text-primary)',
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
                            backgroundColor: 'transparent',
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
                            backgroundColor: 'transparent',
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
                            backgroundColor: 'transparent',
                            color: 'var(--text-secondary)',
                          }}
                        >
                          host: {host}
                        </span>
                      ))}
                    </div>
                    <div className="flex gap-3 mt-2">
                      <button
                        type="button"
                        onClick={() => openExternal(communityPluginSourceUrl(plugin))}
                        className="text-xs hover:underline"
                        style={{ color: 'var(--accent-primary)', background: 'transparent' }}
                      >
                        View source
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          openExternal(
                            `${COMMUNITY_REPORT_URL}&title=${encodeURIComponent(`Report: ${plugin.id}`)}`
                          )
                        }
                        className="text-xs hover:underline"
                        style={{ color: 'var(--text-tertiary)', background: 'transparent' }}
                      >
                        Report a problem
                      </button>
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
          message={`Uninstall "${pendingUninstall.manifest.name}"? This deletes its folder from your Forge and the credentials it saved, unless another Forge still has it. Your notes aren't touched.`}
          confirmLabel="Uninstall"
          danger
          onConfirm={confirmUninstall}
          onCancel={() => setPendingUninstall(null)}
        />
      )}

      {pendingInstall && (
        <PluginInstallDialog
          plugin={
            pendingInstall.kind === 'community'
              ? communityDetails(pendingInstall.plugin)
              : fileDetails(pendingInstall.candidate)
          }
          source={pendingInstall.kind}
          installed={pendingInstall.installed}
          onViewSource={
            pendingInstall.kind === 'community'
              ? () => openExternal(communityPluginSourceUrl(pendingInstall.plugin))
              : undefined
          }
          onInstall={() => void confirmPendingInstall()}
          onClose={() => setPendingInstall(null)}
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

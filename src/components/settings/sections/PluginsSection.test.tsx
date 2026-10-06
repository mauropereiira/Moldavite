import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PluginInfo } from '@/lib/plugins/types';

vi.mock('@/lib/plugins/host', () => ({
  listPlugins: vi.fn(),
  reconcilePlugins: vi.fn(),
  setPluginsPaused: vi.fn(),
}));
vi.mock('@/lib/plugins/api', () => ({ getPluginAppVersion: () => '2.10.0' }));
vi.mock('@/lib/ipc', () => ({ safeInvoke: vi.fn() }));
vi.mock('@tauri-apps/plugin-shell', () => ({ open: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@/lib/plugins/importPackage', () => ({
  choosePluginPackage: vi.fn(),
  readImportCandidate: vi.fn(),
  installImportCandidate: vi.fn(),
}));
vi.mock('../BrowserClipperCard', () => ({ BrowserClipperCard: () => null }));

import { listPlugins, reconcilePlugins, setPluginsPaused } from '@/lib/plugins/host';
import { safeInvoke } from '@/lib/ipc';
import {
  choosePluginPackage,
  installImportCandidate,
  readImportCandidate,
} from '@/lib/plugins/importPackage';
import { usePluginStore } from '@/stores/pluginStore';
import { PLUGINS_RUNNING, usePluginSafeModeStore } from '@/stores/pluginSafeModeStore';
import { PluginsSection } from './PluginsSection';

const HASH = 'h'.repeat(64);

function installed(overrides: Partial<PluginInfo['manifest']> = {}): PluginInfo {
  return {
    manifest: {
      id: 'word-count',
      name: 'Word Count',
      version: '1.0.0',
      apiVersion: 2,
      permissions: ['ui'],
      ...overrides,
    },
    status: 'ok',
    contentHash: HASH,
  };
}

function registryEntry(overrides: Record<string, unknown> = {}) {
  return {
    id: 'word-count',
    name: 'Word Count',
    version: '1.1.0',
    description: 'Counts words.',
    author: 'Someone',
    apiVersion: 2,
    permissions: ['ui', 'notes.read'],
    allowedHosts: [],
    files: { 'manifest.json': { sha256: 'a'.repeat(64) }, 'plugin.js': { sha256: 'b'.repeat(64) } },
    path: 'plugins/word-count',
    ...overrides,
  };
}

function serveRegistry(plugins: unknown[]) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      if (url.endsWith('registry.json')) {
        return { ok: true, json: async () => ({ registryVersion: 1, plugins }) };
      }
      return { ok: true, text: async () => `file:${url}` };
    })
  );
}

function setInstalled(list: PluginInfo[]) {
  vi.mocked(listPlugins).mockResolvedValue(list);
  vi.mocked(reconcilePlugins).mockResolvedValue(list);
}

describe('PluginsSection', () => {
  beforeEach(() => {
    vi.mocked(safeInvoke).mockReset().mockResolvedValue(undefined);
    usePluginStore.setState({ grants: {} });
    usePluginSafeModeStore.setState({ status: PLUGINS_RUNNING });
    setInstalled([installed()]);
  });
  afterEach(() => vi.unstubAllGlobals());

  // The example plugin is for plugin authors: the build docs point to it in the directory.
  it('offers installs for users, not the example plugin', async () => {
    render(<PluginsSection />);
    await screen.findByText('Word Count');

    expect(screen.getByRole('button', { name: /Build your own/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /example plugin/i })).not.toBeInTheDocument();
  });

  it('keeps installed plugins manageable when the directory is unreachable', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Load failed')));
    render(<PluginsSection />);
    expect(await screen.findByText('Word Count')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Browse community plugins' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Installed plugins keep working offline'
    );
    expect(screen.getByRole('switch', { name: 'Enable Word Count' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Uninstall/ })).toBeEnabled();
  });

  it('asks before installing from the directory, then verifies the listed hashes', async () => {
    setInstalled([]);
    serveRegistry([registryEntry({ id: 'fresh', name: 'Fresh', path: 'plugins/fresh' })]);
    render(<PluginsSection />);
    fireEvent.click(screen.getByRole('button', { name: 'Browse community plugins' }));
    const card = await screen.findByRole('article');
    fireEvent.click(within(card).getByRole('button', { name: 'Install' }));

    const dialog = await screen.findByRole('dialog', { name: 'Install community plugin?' });
    expect(safeInvoke).not.toHaveBeenCalledWith('install_plugin_from_data', expect.anything());
    fireEvent.click(within(dialog).getByRole('button', { name: 'Install' }));

    await waitFor(() =>
      expect(safeInvoke).toHaveBeenCalledWith(
        'install_plugin_from_data',
        expect.objectContaining({
          id: 'fresh',
          expectedManifestSha256: 'a'.repeat(64),
          expectedPluginSha256: 'b'.repeat(64),
          confirmUpdate: false,
        })
      )
    );
    expect(reconcilePlugins).toHaveBeenCalled();
  });

  it('shows what an update newly asks for before replacing the installed copy', async () => {
    serveRegistry([registryEntry()]);
    render(<PluginsSection />);
    fireEvent.click(await screen.findByRole('button', { name: 'Browse community plugins' }));
    const card = await screen.findByRole('article');
    fireEvent.click(within(card).getByRole('button', { name: 'Update' }));

    const dialog = await screen.findByRole('dialog', { name: 'Update Word Count?' });
    expect(
      within(dialog).getByText('List notes and read unlocked Markdown content').closest('li')
    ).toHaveTextContent('New');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Update' }));
    await waitFor(() =>
      expect(safeInvoke).toHaveBeenCalledWith(
        'install_plugin_from_data',
        expect.objectContaining({ confirmUpdate: true })
      )
    );
  });

  it('cannot install a listed plugin that needs a newer Moldavite', async () => {
    setInstalled([]);
    serveRegistry([registryEntry({ id: 'future', path: 'plugins/future', apiVersion: 3 })]);
    render(<PluginsSection />);
    fireEvent.click(screen.getByRole('button', { name: 'Browse community plugins' }));
    const card = await screen.findByRole('article');
    expect(within(card).getByText('Needs a newer version of Moldavite')).toBeInTheDocument();
    expect(within(card).getByRole('button', { name: 'Install' })).toBeDisabled();
  });

  it('installs a package from a file only after the user confirms, and leaves it off', async () => {
    vi.mocked(choosePluginPackage).mockResolvedValue('/Users/me/Downloads/hello.zip');
    const candidate = {
      manifest: { id: 'hello', name: 'Hello', version: '1.0.0', apiVersion: 2, permissions: [] },
      pkg: {
        manifestJson: '{}',
        pluginJs: '',
        manifestSha256: 'a'.repeat(64),
        pluginSha256: 'b'.repeat(64),
      },
    };
    vi.mocked(readImportCandidate).mockResolvedValue(candidate);
    vi.mocked(installImportCandidate).mockResolvedValue(undefined);
    render(<PluginsSection />);

    fireEvent.click(screen.getByRole('button', { name: 'Install from .zip…' }));
    const dialog = await screen.findByRole('dialog', { name: 'Install plugin from a file?' });
    expect(within(dialog).getByText(/not the reviewed community directory/)).toBeInTheDocument();
    expect(installImportCandidate).not.toHaveBeenCalled();

    fireEvent.click(within(dialog).getByRole('button', { name: 'Install' }));
    await waitFor(() => expect(installImportCandidate).toHaveBeenCalledWith(candidate, false));
    expect(usePluginStore.getState().grants.hello).toBeUndefined();
  });

  it('reports a package that fails validation without installing it', async () => {
    vi.mocked(choosePluginPackage).mockResolvedValue('/tmp/bad');
    vi.mocked(readImportCandidate).mockRejectedValue(
      new Error('This plugin can\'t be installed: unknown manifest field "x".')
    );
    vi.mocked(installImportCandidate).mockClear();
    render(<PluginsSection />);
    fireEvent.click(screen.getByRole('button', { name: 'Install from folder…' }));
    await waitFor(() => expect(readImportCandidate).toHaveBeenCalled());
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(installImportCandidate).not.toHaveBeenCalled();
  });

  it('flags a plugin whose files changed after it was approved', async () => {
    usePluginStore.getState().grant('word-count', '1.0.0', 'old-hash');
    render(<PluginsSection />);
    expect(await screen.findByText('Needs review')).toBeInTheDocument();
    expect(screen.getByText(/files changed since you approved it/)).toBeInTheDocument();
  });

  it('explains safe mode and turns plugins back on', async () => {
    usePluginSafeModeStore.setState({
      status: { active: true, reason: 'unfinishedStart', pluginIds: ['word-count'] },
    });
    vi.mocked(setPluginsPaused).mockResolvedValue(PLUGINS_RUNNING);
    render(<PluginsSection />);

    const notice = await screen.findByRole('status');
    expect(notice).toHaveTextContent("last start didn't finish");
    await waitFor(() =>
      expect(notice).toHaveTextContent('Plugins that were starting: Word Count.')
    );
    expect(screen.queryByRole('button', { name: 'Stop all plugins' })).not.toBeInTheDocument();

    fireEvent.click(within(notice).getByRole('button', { name: 'Turn plugins back on' }));
    await waitFor(() => expect(setPluginsPaused).toHaveBeenCalledWith(false));
  });

  it('can stop every plugin for the session', async () => {
    vi.mocked(setPluginsPaused).mockResolvedValue({
      active: true,
      reason: 'userRequest',
      pluginIds: [],
    });
    render(<PluginsSection />);
    fireEvent.click(await screen.findByRole('button', { name: 'Stop all plugins' }));
    await waitFor(() => expect(setPluginsPaused).toHaveBeenCalledWith(true));
  });
});

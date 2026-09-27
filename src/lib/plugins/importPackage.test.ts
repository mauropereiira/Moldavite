import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@tauri-apps/plugin-dialog', () => ({ open: vi.fn() }));
vi.mock('@/lib/ipc', () => ({ safeInvoke: vi.fn() }));

import { open } from '@tauri-apps/plugin-dialog';
import { safeInvoke } from '@/lib/ipc';
import {
  choosePluginPackage,
  installImportCandidate,
  readImportCandidate,
  type PluginPackage,
} from './importPackage';

const manifest = {
  id: 'hello-world',
  name: 'Hello World',
  version: '1.0.0',
  apiVersion: 2,
  permissions: ['ui'],
};

function pkg(manifestJson: string): PluginPackage {
  return {
    manifestJson,
    pluginJs: 'export default function register() {}',
    manifestSha256: 'a'.repeat(64),
    pluginSha256: 'b'.repeat(64),
  };
}

describe('choosePluginPackage', () => {
  beforeEach(() => vi.mocked(open).mockReset());

  it('asks for a .zip or a folder and returns one path', async () => {
    vi.mocked(open).mockResolvedValueOnce('/Users/me/Downloads/hello.zip');
    expect(await choosePluginPackage('zip')).toBe('/Users/me/Downloads/hello.zip');
    expect(open).toHaveBeenCalledWith(
      expect.objectContaining({
        directory: false,
        filters: [{ name: 'Moldavite plugin', extensions: ['zip'] }],
      })
    );

    vi.mocked(open).mockResolvedValueOnce('/Users/me/hello');
    expect(await choosePluginPackage('folder')).toBe('/Users/me/hello');
    expect(open).toHaveBeenLastCalledWith(expect.objectContaining({ directory: true }));
  });

  it('returns nothing when the picker is cancelled', async () => {
    vi.mocked(open).mockResolvedValueOnce(null);
    expect(await choosePluginPackage('zip')).toBeNull();
  });
});

describe('readImportCandidate', () => {
  beforeEach(() => vi.mocked(safeInvoke).mockReset());

  it('validates the manifest with the installed-plugin rules', async () => {
    vi.mocked(safeInvoke).mockResolvedValueOnce(pkg(JSON.stringify(manifest)));
    const candidate = await readImportCandidate('/tmp/hello.zip', '2.10.0');
    expect(safeInvoke).toHaveBeenCalledWith('read_plugin_package', { path: '/tmp/hello.zip' });
    expect(candidate.manifest).toMatchObject({ id: 'hello-world', permissions: ['ui'] });
  });

  it.each([
    ['broken JSON', '{nope', "manifest.json isn't valid JSON"],
    ['an unknown field', JSON.stringify({ ...manifest, runAtStartup: true }), 'runAtStartup'],
    [
      'an unsupported permission',
      JSON.stringify({ ...manifest, permissions: ['fs'] }),
      'supported capabilities',
    ],
    ['an unsupported API version', JSON.stringify({ ...manifest, apiVersion: 9 }), 'apiVersion'],
  ])('refuses %s before anything is installed', async (_name, json, reason) => {
    vi.mocked(safeInvoke).mockResolvedValueOnce(pkg(json));
    await expect(readImportCandidate('/tmp/x.zip', '2.10.0')).rejects.toThrow(reason);
    expect(safeInvoke).toHaveBeenCalledTimes(1);
  });

  it('refuses a plugin that needs a newer Moldavite', async () => {
    vi.mocked(safeInvoke).mockResolvedValueOnce(
      pkg(JSON.stringify({ ...manifest, minAppVersion: '3.0.0' }))
    );
    await expect(readImportCandidate('/tmp/x.zip', '2.10.0')).rejects.toThrow(
      'needs Moldavite 3.0.0 or later'
    );
  });
});

describe('installImportCandidate', () => {
  it('installs exactly the bytes that were reviewed', async () => {
    vi.mocked(safeInvoke).mockReset().mockResolvedValueOnce(undefined);
    const reviewed = pkg(JSON.stringify(manifest));
    await installImportCandidate(
      { manifest: { ...manifest, version: '1.0.0' }, pkg: reviewed },
      true
    );
    expect(safeInvoke).toHaveBeenCalledWith('install_plugin_from_data', {
      id: 'hello-world',
      manifestJson: reviewed.manifestJson,
      pluginJs: reviewed.pluginJs,
      expectedManifestSha256: reviewed.manifestSha256,
      expectedPluginSha256: reviewed.pluginSha256,
      confirmUpdate: true,
    });
  });
});

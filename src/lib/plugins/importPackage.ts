/**
 * Installing a plugin from the user's own files: a plugin folder, or a .zip
 * of one. Rust reads the package into memory; the manifest passes the same
 * validator as every installed plugin; the bytes the user reviewed are the
 * bytes installed, disabled, by the shared staged installer.
 */

import { open } from '@tauri-apps/plugin-dialog';
import { safeInvoke } from '@/lib/ipc';
import { isNewerVersion } from '@/lib/changelog';
import { validateManifest } from './manifest';
import type { PluginManifest } from './types';

export interface PluginPackage {
  manifestJson: string;
  pluginJs: string;
  manifestSha256: string;
  pluginSha256: string;
}

export interface ImportCandidate {
  manifest: PluginManifest;
  pkg: PluginPackage;
}

export async function choosePluginPackage(kind: 'zip' | 'folder'): Promise<string | null> {
  const picked =
    kind === 'zip'
      ? await open({
          title: 'Choose a plugin .zip',
          multiple: false,
          directory: false,
          filters: [{ name: 'Moldavite plugin', extensions: ['zip'] }],
        })
      : await open({ title: 'Choose a plugin folder', multiple: false, directory: true });
  return typeof picked === 'string' ? picked : null;
}

export async function readImportCandidate(
  path: string,
  appVersion: string
): Promise<ImportCandidate> {
  const pkg = await safeInvoke<PluginPackage>('read_plugin_package', { path });
  let raw: unknown;
  try {
    raw = JSON.parse(pkg.manifestJson);
  } catch {
    throw new Error("This plugin can't be installed: manifest.json isn't valid JSON.");
  }
  const id = (raw as { id?: unknown } | null)?.id;
  const result = validateManifest(raw, typeof id === 'string' ? id : '');
  if (!result.ok) throw new Error(`This plugin can't be installed: ${result.reason}.`);
  const needs = result.manifest.minAppVersion;
  if (needs && isNewerVersion(needs, appVersion)) {
    throw new Error(`This plugin needs Moldavite ${needs} or later.`);
  }
  return { manifest: result.manifest, pkg };
}

export function installImportCandidate(
  { manifest, pkg }: ImportCandidate,
  confirmUpdate: boolean
): Promise<void> {
  return safeInvoke('install_plugin_from_data', {
    id: manifest.id,
    manifestJson: pkg.manifestJson,
    pluginJs: pkg.pluginJs,
    expectedManifestSha256: pkg.manifestSha256,
    expectedPluginSha256: pkg.pluginSha256,
    confirmUpdate,
  });
}

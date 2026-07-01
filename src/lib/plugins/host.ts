import { safeInvoke } from '@/lib/ipc';
import { getVersion } from '@tauri-apps/api/app';
import { validateManifest } from './manifest';
import { buildPluginAPI, setPluginAppVersion } from './api';
import type { PluginInfo } from './types';
import { usePluginStore } from '@/stores/pluginStore';
import { usePluginCommandStore } from '@/stores/pluginCommandStore';

interface RawPlugin {
  id: string;
  manifestRaw: unknown | null;
  readError: string | null;
}

/** Turn a backend RawPlugin into a classified PluginInfo (validation lives here). */
function classify(raw: RawPlugin): PluginInfo {
  if (raw.readError || raw.manifestRaw === null || raw.manifestRaw === undefined) {
    return {
      manifest: { id: raw.id, name: raw.id, version: '?', apiVersion: 0 },
      status: 'invalid',
      reason: raw.readError ?? 'missing manifest',
    };
  }
  const v = validateManifest(raw.manifestRaw, raw.id);
  if (!v.ok) {
    const incompatible = v.reason.includes('apiVersion');
    return {
      manifest: { id: raw.id, name: raw.id, version: '?', apiVersion: 0 },
      status: incompatible ? 'incompatible' : 'invalid',
      reason: v.reason,
    };
  }
  return { manifest: v.manifest, status: 'ok' };
}

async function loadOne(info: PluginInfo): Promise<void> {
  const { id } = info.manifest;
  try {
    const mod = await import(/* @vite-ignore */ `plugin://localhost/${id}/plugin.js`);
    const register = mod?.default;
    if (typeof register !== 'function') {
      throw new Error('plugin.js has no default export function');
    }
    await register(buildPluginAPI(id));
  } catch (err) {
    console.error(`[plugin:${id}] failed to load:`, err);
  }
}

/**
 * Scan the active Forge's plugins, (re)load every enabled + granted +
 * compatible one, and return the full classified list for the Settings UI.
 * Clears previously-registered commands first so it is safe to call on
 * enable/disable/refresh.
 */
export async function loadEnabledPlugins(): Promise<PluginInfo[]> {
  setPluginAppVersion(await getVersion().catch(() => '0.0.0'));

  let raw: RawPlugin[];
  try {
    raw = (await safeInvoke<RawPlugin[]>('list_plugins')) ?? [];
  } catch (err) {
    console.error('[plugins] list_plugins failed:', err);
    return [];
  }

  const infos = raw.map(classify);
  usePluginCommandStore.getState().clear();

  const store = usePluginStore.getState();
  for (const info of infos) {
    if (info.status !== 'ok') continue;
    if (store.isEnabledAndGranted(info.manifest.id, info.manifest.version)) {
      await loadOne(info);
    }
  }
  return infos;
}

/** Remove a plugin's live commands (on disable/uninstall). */
export function unloadPlugin(id: string): void {
  usePluginCommandStore.getState().removeByPlugin(id);
}

import { PLUGIN_API_VERSION, type PluginManifest } from './types';

const ID_RE = /^[a-z0-9][a-z0-9-]*$/;

type Result =
  | { ok: true; manifest: PluginManifest }
  | { ok: false; reason: string };

export function validateManifest(raw: unknown, folderId: string): Result {
  if (typeof raw !== 'object' || raw === null) {
    return { ok: false, reason: 'manifest.json is not an object' };
  }
  const m = raw as Record<string, unknown>;
  const str = (k: string) => (typeof m[k] === 'string' ? (m[k] as string) : undefined);

  const id = str('id');
  const name = str('name');
  const version = str('version');
  const apiVersion = typeof m.apiVersion === 'number' ? m.apiVersion : undefined;

  if (!id || !name || !version || apiVersion === undefined) {
    return { ok: false, reason: 'missing required fields (id, name, version, apiVersion)' };
  }
  if (!ID_RE.test(id)) {
    return { ok: false, reason: `invalid id "${id}" (use lowercase letters, digits, hyphens)` };
  }
  if (id !== folderId) {
    return { ok: false, reason: `id "${id}" does not match folder "${folderId}"` };
  }
  if (apiVersion !== PLUGIN_API_VERSION) {
    return {
      ok: false,
      reason: `apiVersion ${apiVersion} is incompatible (this app supports ${PLUGIN_API_VERSION})`,
    };
  }
  const permissions = Array.isArray(m.permissions)
    ? (m.permissions.filter((p) => typeof p === 'string') as string[])
    : undefined;

  return {
    ok: true,
    manifest: {
      id,
      name,
      version,
      apiVersion,
      author: str('author'),
      description: str('description'),
      minAppVersion: str('minAppVersion'),
      permissions,
    },
  };
}

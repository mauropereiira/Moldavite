/**
 * Strict validation for untrusted plugin manifests.
 *
 * Only the documented field set crosses into `PluginInfo`; ids must match their
 * containing folder, API versions must be supported, permissions are allowlisted,
 * and network entries are exact hostnames rather than URLs or wildcard patterns.
 * Validation must never grant a capability merely because a type declaration says
 * a field exists.
 */

import { PLUGIN_API_VERSION, SUPPORTED_PLUGIN_API_VERSIONS, type PluginManifest } from './types';

const ID_RE = /^[a-z0-9][a-z0-9-]*$/;
const MANIFEST_FIELDS = new Set([
  'id',
  'name',
  'version',
  'apiVersion',
  'author',
  'description',
  'minAppVersion',
  'permissions',
  'allowedHosts',
]);

type Result = { ok: true; manifest: PluginManifest } | { ok: false; reason: string };

/** Convert an unknown JSON value into a complete, capability-safe manifest. */
export function validateManifest(raw: unknown, folderId: string): Result {
  if (typeof raw !== 'object' || raw === null) {
    return { ok: false, reason: 'manifest.json is not an object' };
  }
  const m = raw as Record<string, unknown>;
  const str = (k: string) => (typeof m[k] === 'string' ? (m[k] as string) : undefined);

  const extra = Object.keys(m).find((key) => !MANIFEST_FIELDS.has(key));
  if (extra) return { ok: false, reason: `unknown manifest field "${extra}"` };

  const id = str('id');
  const name = str('name');
  const version = str('version');
  const apiVersion = typeof m.apiVersion === 'number' ? m.apiVersion : undefined;

  if (!id || !name || !version || apiVersion === undefined) {
    return { ok: false, reason: 'missing required fields (id, name, version, apiVersion)' };
  }
  for (const field of ['author', 'description', 'minAppVersion']) {
    if (m[field] !== undefined && typeof m[field] !== 'string') {
      return { ok: false, reason: `${field} must be a string` };
    }
  }
  if (id.length > 64 || !ID_RE.test(id)) {
    return { ok: false, reason: `invalid id "${id}" (use lowercase letters, digits, hyphens)` };
  }
  if (id !== folderId) {
    return { ok: false, reason: `id "${id}" does not match folder "${folderId}"` };
  }
  if (!(SUPPORTED_PLUGIN_API_VERSIONS as readonly number[]).includes(apiVersion)) {
    return {
      ok: false,
      reason: `apiVersion ${apiVersion} is incompatible (this app supports 1-${PLUGIN_API_VERSION})`,
    };
  }
  const permissions = Array.isArray(m.permissions)
    ? (m.permissions.filter((p) => typeof p === 'string') as string[])
    : undefined;
  const allowedHosts = Array.isArray(m.allowedHosts)
    ? (m.allowedHosts.filter((host) => typeof host === 'string') as string[])
    : undefined;

  if (
    m.permissions !== undefined &&
    (!Array.isArray(m.permissions) || permissions?.length !== m.permissions.length)
  ) {
    return { ok: false, reason: 'permissions must be an array of strings' };
  }

  if (
    m.allowedHosts !== undefined &&
    (!Array.isArray(m.allowedHosts) || allowedHosts?.length !== m.allowedHosts.length)
  ) {
    return { ok: false, reason: 'allowedHosts must be an array of hostnames' };
  }
  if (allowedHosts?.some((host) => !isValidAllowedHost(host))) {
    return {
      ok: false,
      reason:
        'allowedHosts entries must be lowercase DNS hostnames without schemes, ports, paths, or wildcards',
    };
  }
  if (allowedHosts && new Set(allowedHosts).size !== allowedHosts.length) {
    return { ok: false, reason: 'allowedHosts must not contain duplicates' };
  }
  if (apiVersion === 2 && permissions?.includes('net.fetch') && !allowedHosts?.length) {
    return { ok: false, reason: 'net.fetch permission requires at least one allowedHosts entry' };
  }

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
      allowedHosts,
    },
  };
}

/** Shared validator for manifest-declared and user-approved network hosts. */
export function isValidAllowedHost(host: string): boolean {
  if (
    host.length > 253 ||
    host !== host.toLowerCase() ||
    host.includes('*') ||
    host.includes(':') ||
    host.includes('[') ||
    host.includes(']')
  ) {
    return false;
  }
  const labels = host.split('.');
  if (labels.length < 2 || labels.every((label) => /^\d+$/.test(label))) return false;
  if (labels.includes('localhost')) return false;
  return labels.every(
    (label) =>
      label.length > 0 && label.length <= 63 && /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label)
  );
}

/**
 * Host-side implementations of the RPC methods a plugin may invoke.
 *
 * Method names, arguments, URLs, redirect targets, and response sizes cross the
 * worker boundary and are untrusted. This is the authoritative permission and
 * input-validation boundary; worker-side checks are defense in depth. Plugin code
 * must never receive raw Tauri IPC, direct filesystem access, unrestricted fetch,
 * another plugin's secrets, or unfiltered response headers.
 */

import { useNoteStore } from '@/stores/noteStore';
import { useToastStore } from '@/stores/toastStore';
import { editorHandle } from '@/stores/editorHandleStore';
import { listNotes, noteFileBackendPath, readNote } from '@/lib/fileSystem';
import { safeInvoke } from '@/lib/ipc';
import { usePluginStore } from '@/stores/pluginStore';
import { PLUGIN_API_VERSION } from './types';
import type { PluginFetchResponse, PluginPromptField, PluginPromptOptions } from './types';
import type { HostMethod } from './rpc';
import { isValidAllowedHost } from './manifest';
import { requestPluginHostAccess, requestPluginPrompt } from './dialogs';

// App version is injected by the host during initial load so tests don't need Tauri.
let appVersion = '0.0.0';
export function setPluginAppVersion(v: string) {
  appVersion = v;
}
export function getPluginAppVersion(): string {
  return appVersion;
}
export function getPluginApiVersion(): number {
  return PLUGIN_API_VERSION;
}

export class PermissionDeniedError extends Error {
  constructor(pluginId: string, permission: string) {
    super(
      `Plugin "${pluginId}" tried to use the "${permission}" API without declaring it in manifest permissions`
    );
    this.name = 'PermissionDeniedError';
  }
}

const METHOD_PERMISSIONS: Partial<Record<HostMethod, string>> = {
  'editor.getActiveNote': 'editor',
  'editor.insertText': 'editor',
  'ui.toast': 'ui',
  'ui.prompt': 'ui',
  'notes.list': 'notes.read',
  'notes.read': 'notes.read',
  'net.fetch': 'net.fetch',
  'net.requestHostAccess': 'net.fetch',
  'secrets.get': 'secrets',
  'secrets.set': 'secrets',
  'secrets.delete': 'secrets',
};

/**
 * Dispatch a single RPC call from a plugin worker. Throws on permission
 * violation or malformed arguments; the caller (host.ts) turns the throw
 * into a `callResult` message with `ok: false`.
 */
export async function dispatchPluginCall(
  pluginId: string,
  permissions: readonly string[],
  method: HostMethod,
  args: unknown[],
  allowedHosts: readonly string[] = [],
  apiVersion = PLUGIN_API_VERSION,
  pluginName = pluginId
): Promise<unknown> {
  if (apiVersion < 2 && !method.startsWith('editor.') && method !== 'ui.toast') {
    throw new Error(`Plugin API v${apiVersion} does not support ${method}`);
  }
  const required = METHOD_PERMISSIONS[method];
  if (required && !permissions.includes(required)) {
    throw new PermissionDeniedError(pluginId, required);
  }

  switch (method) {
    case 'editor.getActiveNote': {
      const note = useNoteStore.getState().currentNote;
      return note ? { path: note.id, title: note.title, content: note.content } : null;
    }
    case 'editor.insertText': {
      const text = args[0];
      if (typeof text !== 'string') throw new Error('editor.insertText: text must be a string');
      const ok = editorHandle.insertTextAtCursor(text);
      if (!ok) useToastStore.getState().addToast('error', 'No active editor to insert into');
      return null;
    }
    case 'ui.toast': {
      const message = args[0];
      const kind = args[1];
      if (typeof message !== 'string') throw new Error('ui.toast: message must be a string');
      const normalizedKind = kind === 'error' ? 'error' : 'success';
      useToastStore.getState().addToast(normalizedKind, message);
      return null;
    }
    case 'ui.prompt':
      return await requestPluginPrompt(pluginId, pluginName, normalizePromptOptions(args[0]));
    case 'notes.list': {
      const notes = await listNotes();
      return notes.map((note) => ({
        path: note.path,
        title: note.name.replace(/\.md$/, ''),
        kind: note.isDaily ? 'daily' : note.isWeekly ? 'weekly' : 'standalone',
        folder: note.folderPath ?? null,
      }));
    }
    case 'notes.read': {
      const path = args[0];
      if (typeof path !== 'string') throw new Error('notes.read: path must be a string');
      const note = (await listNotes()).find((candidate) => candidate.path === path);
      if (!note) throw new Error(`notes.read: note not found: ${path}`);
      if (note.isLocked) throw new Error(`notes.read: locked notes cannot be read: ${path}`);
      return await readNote(noteFileBackendPath(note), note.isDaily, note.isWeekly);
    }
    case 'net.fetch': {
      return await pluginFetch(args[0], args[1], allowedHosts, pluginId);
    }
    case 'net.requestHostAccess': {
      const host = args[0];
      if (typeof host !== 'string' || !isValidAllowedHost(host)) {
        throw new Error('net.requestHostAccess: host must follow allowedHosts hostname rules');
      }
      if (
        allowedHosts.includes(host) ||
        usePluginStore.getState().approvedHosts(pluginId).includes(host)
      ) {
        return true;
      }
      const approved = await requestPluginHostAccess(pluginId, pluginName, host);
      if (approved) usePluginStore.getState().approveHost(pluginId, host);
      return approved;
    }
    case 'secrets.get': {
      const key = requireSecretKey(args[0], 'secrets.get');
      return await safeInvoke<string | null>('plugin_secret_get', { pluginId, key });
    }
    case 'secrets.set': {
      const key = requireSecretKey(args[0], 'secrets.set');
      const value = args[1];
      if (typeof value !== 'string') throw new Error('secrets.set: value must be a string');
      await safeInvoke('plugin_secret_set', { pluginId, key, value });
      return null;
    }
    case 'secrets.delete': {
      const key = requireSecretKey(args[0], 'secrets.delete');
      await safeInvoke('plugin_secret_delete', { pluginId, key });
      return null;
    }
    default: {
      // Exhaustiveness — unknown HostMethod values throw so a rogue worker
      // can't force the host into unintended state.
      const _exhaustive: never = method;
      throw new Error(`Unknown plugin API method: ${_exhaustive}`);
    }
  }
}

function normalizePromptOptions(value: unknown): PluginPromptOptions {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('ui.prompt: options must be an object');
  }
  const options = value as Record<string, unknown>;
  const title = requirePromptText(options.title, 'title', 200, false);
  const message =
    options.message === undefined
      ? undefined
      : requirePromptText(options.message, 'message', 2_000, true);
  const confirmLabel =
    options.confirmLabel === undefined
      ? undefined
      : requirePromptText(options.confirmLabel, 'confirmLabel', 80, false);
  if (!Array.isArray(options.fields) || options.fields.length < 1 || options.fields.length > 12) {
    throw new Error('ui.prompt: fields must contain 1-12 fields');
  }
  const names = new Set<string>();
  const fields = options.fields.map((raw, index): PluginPromptField => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      throw new Error(`ui.prompt: field ${index + 1} must be an object`);
    }
    const field = raw as Record<string, unknown>;
    const name = requirePromptText(field.name, 'field name', 64, false);
    if (!/^[A-Za-z][A-Za-z0-9_-]*$/.test(name) || names.has(name)) {
      throw new Error('ui.prompt: field names must be unique identifiers');
    }
    names.add(name);
    const label = requirePromptText(field.label, 'field label', 160, false);
    if (field.type !== 'text' && field.type !== 'password' && field.type !== 'url') {
      throw new Error('ui.prompt: field type must be text, password, or url');
    }
    const placeholder =
      field.placeholder === undefined
        ? undefined
        : requirePromptText(field.placeholder, 'field placeholder', 300, true);
    if (field.required !== undefined && typeof field.required !== 'boolean') {
      throw new Error('ui.prompt: field required must be a boolean');
    }
    return { name, label, type: field.type, placeholder, required: field.required as boolean };
  });
  return { title, message, fields, confirmLabel };
}

function requirePromptText(value: unknown, name: string, max: number, allowEmpty: boolean): string {
  if (typeof value !== 'string' || value.length > max || (!allowEmpty && value.trim() === '')) {
    throw new Error(
      `ui.prompt: ${name} must be ${allowEmpty ? '' : 'a non-empty '}string up to ${max} characters`
    );
  }
  return value;
}

function requireSecretKey(value: unknown, method: string): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value)) {
    throw new Error(`${method}: key must be 1-128 letters, digits, dots, underscores, or hyphens`);
  }
  return value;
}

interface NormalizedFetchOptions {
  method: string;
  headers: Headers;
  body?: string;
}

function normalizeFetchOptions(value: unknown): NormalizedFetchOptions {
  if (
    value !== undefined &&
    (typeof value !== 'object' || value === null || Array.isArray(value))
  ) {
    throw new Error('net.fetch: options must be an object');
  }
  const options = (value ?? {}) as Record<string, unknown>;
  const method = options.method === undefined ? 'GET' : options.method;
  if (typeof method !== 'string' || !/^[A-Za-z]+$/.test(method)) {
    throw new Error('net.fetch: method must contain letters only');
  }
  const normalizedMethod = method.toUpperCase();
  if (['CONNECT', 'TRACE', 'TRACK'].includes(normalizedMethod)) {
    throw new Error(`net.fetch: method ${normalizedMethod} is not allowed`);
  }
  if (
    options.headers !== undefined &&
    (typeof options.headers !== 'object' ||
      options.headers === null ||
      Array.isArray(options.headers))
  ) {
    throw new Error('net.fetch: headers must be a string map');
  }
  const headerEntries = Object.entries((options.headers ?? {}) as Record<string, unknown>);
  if (headerEntries.some(([, headerValue]) => typeof headerValue !== 'string')) {
    throw new Error('net.fetch: header values must be strings');
  }
  const headers = new Headers(headerEntries as [string, string][]);
  if (options.body !== undefined && typeof options.body !== 'string') {
    throw new Error('net.fetch: body must be a string');
  }
  return { method: normalizedMethod, headers, body: options.body as string | undefined };
}

function validateFetchUrl(value: unknown, allowedHosts: readonly string[]): URL {
  if (typeof value !== 'string') throw new Error('net.fetch: url must be a string');
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error('net.fetch: url must be an absolute URL');
  }
  if (url.protocol !== 'https:') throw new Error('net.fetch: only https URLs are allowed');
  if (url.username || url.password) throw new Error('net.fetch: URL credentials are not allowed');
  if (!allowedHosts.includes(url.host)) {
    throw new Error(`net.fetch: host "${url.host}" is not in this plugin's allowedHosts`);
  }
  return url;
}

/**
 * Validates the call, then hands the actual request to the `plugin_fetch`
 * Tauri command — the webview CSP's fixed `connect-src` would otherwise block
 * a plugin's request to any host beyond `self` and the registry's GitHub
 * hosts before this code even ran. The Rust side re-checks every rule here
 * independently (defense in depth) and owns the redirect loop, response cap,
 * and timeout; this function's job is the up-front reject-fast validation
 * plus computing the effective host allowlist for this call.
 */
async function pluginFetch(
  urlValue: unknown,
  optionsValue: unknown,
  manifestHosts: readonly string[],
  pluginId: string
): Promise<PluginFetchResponse> {
  const allowedHosts = [...manifestHosts, ...usePluginStore.getState().approvedHosts(pluginId)];
  const url = validateFetchUrl(urlValue, allowedHosts);
  const { method, headers, body } = normalizeFetchOptions(optionsValue);
  return await safeInvoke<PluginFetchResponse>('plugin_fetch', {
    url: url.href,
    method,
    headers: Object.fromEntries(headers.entries()),
    body,
    allowedHosts,
  });
}

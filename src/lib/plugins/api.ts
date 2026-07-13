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
import type { PluginPromptField, PluginPromptOptions } from './types';
import type { HostMethod } from './rpc';
import { isValidAllowedHost } from './manifest';
import { requestPluginHostAccess, requestPluginPrompt } from './dialogs';

const FETCH_TIMEOUT_MS = 30_000;
const FETCH_MAX_BYTES = 10 * 1024 * 1024;
const FETCH_MAX_REDIRECTS = 5;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const SAFE_RESPONSE_HEADERS = new Set([
  'content-type',
  'content-length',
  'etag',
  'last-modified',
  'link',
  'retry-after',
  'x-wp-total',
  'x-wp-totalpages',
]);

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

async function pluginFetch(
  urlValue: unknown,
  optionsValue: unknown,
  manifestHosts: readonly string[],
  pluginId: string
): Promise<{
  status: number;
  headers: Record<string, string>;
  bodyText: string;
  bodyBase64?: string;
}> {
  const effectiveHosts = () => [
    ...manifestHosts,
    ...usePluginStore.getState().approvedHosts(pluginId),
  ];
  let url = validateFetchUrl(urlValue, effectiveHosts());
  let { method, headers, body } = normalizeFetchOptions(optionsValue);
  const controller = new AbortController();
  const timeout = globalThis.setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    for (let redirects = 0; ; redirects += 1) {
      const response = await fetch(url, {
        method,
        headers,
        body,
        redirect: 'manual',
        signal: controller.signal,
      });
      // WebKit may hide a cross-origin manual redirect as an opaque response.
      // It has not been followed; reject because its target cannot be validated.
      if (response.type === 'opaqueredirect') {
        throw new Error('net.fetch: redirect target was hidden and could not be validated');
      }
      if (!REDIRECT_STATUSES.has(response.status)) return await serializeFetchResponse(response);
      if (redirects >= FETCH_MAX_REDIRECTS) throw new Error('net.fetch: too many redirects');
      const location = response.headers.get('location');
      if (!location)
        throw new Error('net.fetch: redirect response did not expose a Location header');
      // Re-read user grants at every hop so revocation affects in-flight redirects.
      const nextUrl = validateFetchUrl(new URL(location, url).href, effectiveHosts());

      if (
        response.status === 303 ||
        ((response.status === 301 || response.status === 302) && method === 'POST')
      ) {
        method = 'GET';
        body = undefined;
        headers = new Headers(headers);
        headers.delete('content-type');
        headers.delete('content-length');
      }
      if (nextUrl.origin !== url.origin) {
        const safeHeaders = new Headers();
        for (const name of ['accept', 'accept-language']) {
          const value = headers.get(name);
          if (value !== null) safeHeaders.set(name, value);
        }
        if (body !== undefined) {
          const contentType = headers.get('content-type');
          if (contentType !== null) safeHeaders.set('content-type', contentType);
        }
        headers = safeHeaders;
      }
      url = nextUrl;
    }
  } catch (error) {
    if (controller.signal.aborted) throw new Error('net.fetch: request timed out after 30 seconds');
    throw error;
  } finally {
    globalThis.clearTimeout(timeout);
  }
}

async function serializeFetchResponse(response: Response) {
  const declaredLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > FETCH_MAX_BYTES) {
    throw new Error('net.fetch: response exceeds the 10 MB limit');
  }

  const reader = response.body?.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  if (reader) {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > FETCH_MAX_BYTES) {
        await reader.cancel();
        throw new Error('net.fetch: response exceeds the 10 MB limit');
      }
      chunks.push(value);
    }
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  const safeHeaders: Record<string, string> = {};
  for (const [name, value] of response.headers.entries()) {
    if (SAFE_RESPONSE_HEADERS.has(name.toLowerCase())) safeHeaders[name.toLowerCase()] = value;
  }
  const contentType = response.headers.get('content-type')?.toLowerCase() ?? '';
  const isText =
    contentType.startsWith('text/') ||
    /(?:json|xml|javascript|x-www-form-urlencoded)/.test(contentType);
  return {
    status: response.status,
    headers: safeHeaders,
    bodyText: new globalThis.TextDecoder().decode(bytes),
    ...(isText ? {} : { bodyBase64: bytesToBase64(bytes) }),
  };
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunkSize = 32_768;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return globalThis.btoa(binary);
}

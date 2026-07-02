// Host-side implementations of the RPC methods a plugin can invoke over the
// worker bridge. Every call arrives as a postMessage from the sandboxed
// worker; we enforce the plugin's declared permissions here (defense in
// depth — the worker also throws locally when a plugin uses an undeclared
// API, but this is the real security boundary).

import { useNoteStore } from '@/stores/noteStore';
import { useToastStore } from '@/stores/toastStore';
import { editorHandle } from '@/stores/editorHandleStore';
import { PLUGIN_API_VERSION } from './types';
import type { HostMethod } from './rpc';

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

const METHOD_PERMISSIONS: Record<HostMethod, string> = {
  'editor.getActiveNote': 'editor',
  'editor.insertText': 'editor',
  'ui.toast': 'ui',
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
  args: unknown[]
): Promise<unknown> {
  const required = METHOD_PERMISSIONS[method];
  if (required && !permissions.includes(required)) {
    throw new PermissionDeniedError(pluginId, required);
  }

  switch (method) {
    case 'editor.getActiveNote': {
      const note = useNoteStore.getState().currentNote;
      return note ? { title: note.title, content: note.content } : null;
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
    default: {
      // Exhaustiveness — unknown HostMethod values throw so a rogue worker
      // can't force the host into unintended state.
      const _exhaustive: never = method;
      throw new Error(`Unknown plugin API method: ${_exhaustive}`);
    }
  }
}

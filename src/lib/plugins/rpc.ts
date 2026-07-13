/**
 * Serializable wire protocol between the main-thread host and plugin Workers.
 *
 * Only discriminated data messages cross the boundary; request ids pair calls
 * with replies. These types document shape but confer no trust or permission—both
 * peers validate message kinds, and the host validates every method argument.
 * Functions, host objects, Tauri handles, and raw exception objects must never be
 * added to this protocol.
 */

/** API methods the plugin can call — the host validates permissions per method. */
export type HostMethod =
  | 'editor.getActiveNote'
  | 'editor.insertText'
  | 'ui.toast'
  | 'ui.prompt'
  | 'notes.list'
  | 'notes.read'
  | 'net.fetch'
  | 'net.requestHostAccess'
  | 'secrets.get'
  | 'secrets.set'
  | 'secrets.delete';

// -----------------------------------------------------------------------------
// Host → Worker
// -----------------------------------------------------------------------------

export interface InitMessage {
  kind: 'init';
  pluginId: string;
  /** Raw source of plugin.js — the worker loads it via a Blob URL. */
  code: string;
  /** Declared permissions from the manifest. Enforced on the host side too. */
  permissions: string[];
  /** Plugin API version the app implements. Exposed to the plugin as api.app.apiVersion. */
  apiVersion: number;
  /** App version. Exposed as api.app.version. */
  appVersion: string;
}

export interface InvokeMessage {
  kind: 'invoke';
  invocationId: number;
  /** The plugin-local id (without the `${pluginId}:` prefix). */
  commandLocalId: string;
}

export interface CallResultMessage {
  kind: 'callResult';
  requestId: number;
  ok: boolean;
  value?: unknown;
  error?: string;
}

export type HostToWorker = InitMessage | InvokeMessage | CallResultMessage;

// -----------------------------------------------------------------------------
// Worker → Host
// -----------------------------------------------------------------------------

export interface LoadedMessage {
  kind: 'loaded';
}

export interface LoadErrorMessage {
  kind: 'loadError';
  error: string;
}

export interface CommandRegisteredMessage {
  kind: 'commandRegistered';
  localId: string;
  label: string;
}

export interface CallMessage {
  kind: 'call';
  requestId: number;
  method: HostMethod;
  args: unknown[];
}

export interface InvokeResultMessage {
  kind: 'invokeResult';
  invocationId: number;
  ok: boolean;
  error?: string;
}

export interface LogMessage {
  kind: 'log';
  level: 'log' | 'warn' | 'error';
  args: unknown[];
}

export type WorkerToHost =
  | LoadedMessage
  | LoadErrorMessage
  | CommandRegisteredMessage
  | CallMessage
  | InvokeResultMessage
  | LogMessage;

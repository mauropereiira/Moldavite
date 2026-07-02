// Wire protocol between the main-thread host and each per-plugin Worker.
// Every message uses a `kind` discriminator; requests carry an id so the
// sender can match a reply to its Promise.

/** API methods the plugin can call — the host validates permissions per method. */
export type HostMethod =
  | 'editor.getActiveNote'
  | 'editor.insertText'
  | 'ui.toast';

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

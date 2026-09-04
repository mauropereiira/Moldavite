/**
 * Per-plugin module Worker bootstrap and curated API proxy.
 *
 * Untrusted plugin source and host messages meet only inside this Worker. Before
 * source loads, the scope is reduced to an allowlist of pure-computation globals;
 * the sole outbound channel is the discriminated RPC protocol over
 * `postMessage`. Plugin code must
 * never receive DOM or Zustand objects, Tauri IPC, host functions, raw filesystem
 * paths, unrestricted network globals, or another plugin's pending call state.
 */

import type {
  CallMessage,
  CommandRegisteredMessage,
  HostMethod,
  HostToWorker,
  InvokeResultMessage,
  LoadErrorMessage,
  LoadedMessage,
  WorkerToHost,
} from './rpc';

/**
 * The only globals untrusted plugin code keeps.
 *
 * This is deliberately an allowlist: a denylist silently re-opens the sandbox
 * every time a browser ships a new API. It already had — `Worker` survived, and
 * a nested worker starts with a pristine scope, handing any plugin an un-gated
 * `fetch` that bypasses both the `net.fetch` permission and `allowedHosts`.
 * `caches`, `indexedDB`, and `navigator.sendBeacon` were reachable for the
 * same reason.
 *
 * Anything added here must be pure computation: no network, no storage shared
 * with the app or with another plugin, and no way to spawn a fresh scope.
 */
const ALLOWED_WORKER_GLOBALS = new Set<string>([
  // ECMAScript intrinsics. Plugin code (and anything it bundles) cannot run
  // without these, and none of them reach outside the worker.
  'globalThis',
  'undefined',
  'NaN',
  'Infinity',
  'eval',
  'isFinite',
  'isNaN',
  'parseFloat',
  'parseInt',
  'decodeURI',
  'decodeURIComponent',
  'encodeURI',
  'encodeURIComponent',
  'escape',
  'unescape',
  'constructor',
  'Object',
  'Function',
  'Boolean',
  'Symbol',
  'Error',
  'AggregateError',
  'EvalError',
  'RangeError',
  'ReferenceError',
  'SyntaxError',
  'TypeError',
  'URIError',
  'Number',
  'BigInt',
  'Math',
  'Date',
  'String',
  'RegExp',
  'Array',
  'Int8Array',
  'Uint8Array',
  'Uint8ClampedArray',
  'Int16Array',
  'Uint16Array',
  'Int32Array',
  'Uint32Array',
  'Float16Array',
  'Float32Array',
  'Float64Array',
  'BigInt64Array',
  'BigUint64Array',
  'Map',
  'Set',
  'WeakMap',
  'WeakSet',
  'ArrayBuffer',
  'DataView',
  'JSON',
  'Promise',
  'Reflect',
  'Proxy',
  'Intl',
  'WeakRef',
  'FinalizationRegistry',
  'Iterator',
  // Worker plumbing this bootstrap still needs after hardening: `Blob`/`URL`
  // load the plugin module, and self/postMessage/addEventListener are the sole
  // channel to the host. The `on*` hooks carry no capability of their own.
  'self',
  'postMessage',
  'addEventListener',
  'removeEventListener',
  'dispatchEvent',
  'onmessage',
  'onmessageerror',
  'onerror',
  'onunhandledrejection',
  'onrejectionhandled',
  'Blob',
  'URL',
  'URLSearchParams',
  // Data-only helpers the documented plugin API and the bundled plugins use.
  'console',
  'setTimeout',
  'clearTimeout',
  'setInterval',
  'clearInterval',
  'queueMicrotask',
  'structuredClone',
  'TextEncoder',
  'TextDecoder',
  'atob',
  'btoa',
  'crypto',
  'performance',
  // Survives only as the frozen snapshot built by `neutraliseNavigator`.
  'navigator',
]);

/** Every property name reachable from the scope, prototypes included. */
function collectScopeNames(scope: object): Set<string> {
  const names = new Set<string>();
  for (
    let obj: object | null = scope;
    obj && obj !== Object.prototype;
    obj = Object.getPrototypeOf(obj)
  ) {
    for (const name of Object.getOwnPropertyNames(obj)) {
      names.add(name);
    }
  }
  return names;
}

/**
 * Web platform globals are defined on the scope's prototypes, not on the scope
 * itself, so deleting the own property is a no-op that leaves `fetch` and
 * friends fully reachable. Walk the chain, then shadow whatever survives.
 */
function removeGlobal(scope: object, name: string): void {
  for (
    let obj: object | null = scope;
    obj && obj !== Object.prototype;
    obj = Object.getPrototypeOf(obj)
  ) {
    if (!Object.prototype.hasOwnProperty.call(obj, name)) continue;
    try {
      delete (obj as Record<string, unknown>)[name];
    } catch {
      // Non-configurable: the shadow below is the fallback.
    }
  }
  if (!(name in scope)) return;
  try {
    Object.defineProperty(scope, name, { value: undefined, writable: false, configurable: false });
  } catch {
    // Locked by the platform; nothing further is possible here.
  }
}

/**
 * `navigator.sendBeacon` posts to any URL without touching a gated API, and the
 * worker navigator also exposes storage, locks, and device entry points. Nothing
 * in the plugin API needs those, so replace it with an inert frozen snapshot of
 * the descriptive fields libraries feature-detect on.
 */
function neutraliseNavigator(scope: Record<string, unknown>): void {
  const source = scope.navigator as Record<string, unknown> | undefined;
  if (!source) return;
  const languages = Array.isArray(source.languages) ? source.languages : [];
  const snapshot = Object.freeze({
    userAgent: typeof source.userAgent === 'string' ? source.userAgent : '',
    language: typeof source.language === 'string' ? source.language : '',
    languages: Object.freeze(languages.filter((lang): lang is string => typeof lang === 'string')),
    hardwareConcurrency:
      typeof source.hardwareConcurrency === 'number' ? source.hardwareConcurrency : 1,
  });
  try {
    Object.defineProperty(scope, 'navigator', {
      value: snapshot,
      writable: false,
      configurable: false,
      enumerable: true,
    });
  } catch {
    // The platform refused to let navigator be shadowed: at minimum take away
    // the one method on it that can reach the network.
    removeGlobal(source, 'sendBeacon');
  }
}

/**
 * Remove ambient capabilities before any untrusted plugin module is evaluated.
 * Exported for tests, which run it against a simulated scope rather than the
 * real one.
 */
export function hardenGlobalScope(scope: object = globalThis): void {
  for (const name of collectScopeNames(scope)) {
    if (ALLOWED_WORKER_GLOBALS.has(name)) continue;
    removeGlobal(scope, name);
  }
  neutraliseNavigator(scope as Record<string, unknown>);
}

function send(msg: WorkerToHost): void {
  (self as unknown as Worker).postMessage(msg);
}

// -----------------------------------------------------------------------------
// Host-call plumbing: turns a method name + args into a Promise that resolves
// when the host posts back a `callResult` with the matching requestId.
// -----------------------------------------------------------------------------

let nextRequestId = 1;
const pendingCalls = new Map<
  number,
  { resolve: (v: unknown) => void; reject: (e: Error) => void }
>();

function callHost(method: HostMethod, args: unknown[]): Promise<unknown> {
  const requestId = nextRequestId++;
  return new Promise((resolve, reject) => {
    pendingCalls.set(requestId, { resolve, reject });
    const msg: CallMessage = { kind: 'call', requestId, method, args };
    send(msg);
  });
}

// -----------------------------------------------------------------------------
// Plugin API proxy (worker-side). Every editor/ui method is one host call.
// Permission checks are also enforced server-side; these throw locally so a
// well-behaved plugin author sees the error at the call site.
// -----------------------------------------------------------------------------

const commandHandlers = new Map<string, () => void | Promise<void>>();

interface PluginCommand {
  id: string;
  label: string;
  handler: () => void | Promise<void>;
}

export function buildPluginAPI(
  pluginId: string,
  permissions: string[],
  appVersion: string,
  apiVersion: number
) {
  const has = (perm: string) => permissions.includes(perm);
  const require = (perm: string) => {
    if (!has(perm)) {
      throw new Error(
        `Plugin "${pluginId}" used the "${perm}" API without declaring it in manifest permissions`
      );
    }
  };
  const api = {
    app: { version: appVersion, apiVersion },
    commands: {
      add(cmd: PluginCommand) {
        require('commands');
        if (
          typeof cmd?.id !== 'string' ||
          typeof cmd?.label !== 'string' ||
          typeof cmd?.handler !== 'function'
        ) {
          throw new Error('commands.add expects { id, label, handler }');
        }
        commandHandlers.set(cmd.id, cmd.handler);
        const msg: CommandRegisteredMessage = {
          kind: 'commandRegistered',
          localId: cmd.id,
          label: cmd.label,
        };
        send(msg);
      },
    },
    editor: {
      async getActiveNote() {
        require('editor');
        return callHost('editor.getActiveNote', []) as Promise<{
          path: string;
          title: string;
          content: string;
        } | null>;
      },
      async insertText(text: string) {
        require('editor');
        await callHost('editor.insertText', [text]);
      },
    },
    ui: {
      async toast(message: string, kind: 'info' | 'success' | 'error' = 'info') {
        require('ui');
        await callHost('ui.toast', [message, kind]);
      },
    },
  };
  if (apiVersion < 2) return api;
  return Object.assign(api, {
    ui: {
      ...api.ui,
      async prompt(options: unknown) {
        require('ui');
        return callHost('ui.prompt', [options]);
      },
    },
    notes: {
      async list() {
        require('notes.read');
        return callHost('notes.list', []);
      },
      async read(path: string) {
        require('notes.read');
        return callHost('notes.read', [path]);
      },
    },
    net: {
      async fetch(url: string, options?: unknown) {
        require('net.fetch');
        return callHost('net.fetch', [url, options]);
      },
      async requestHostAccess(host: string) {
        require('net.fetch');
        return callHost('net.requestHostAccess', [host]);
      },
    },
    secrets: {
      async get(key: string) {
        require('secrets');
        return callHost('secrets.get', [key]);
      },
      async set(key: string, value: string) {
        require('secrets');
        await callHost('secrets.set', [key, value]);
      },
      async delete(key: string) {
        require('secrets');
        await callHost('secrets.delete', [key]);
      },
    },
  });
}

// -----------------------------------------------------------------------------
// Message handler.
// -----------------------------------------------------------------------------

self.addEventListener('message', async (event: MessageEvent<HostToWorker>) => {
  const msg = event.data;
  if (!msg || typeof msg !== 'object') return;

  if (msg.kind === 'init') {
    hardenGlobalScope();

    let blobUrl: string | null = null;
    try {
      const blob = new Blob([msg.code], { type: 'text/javascript' });
      blobUrl = URL.createObjectURL(blob);
      // Vite ignores this dynamic import at build time — the URL is only known at runtime.
      const mod = (await import(/* @vite-ignore */ blobUrl)) as { default?: unknown };
      const register = mod?.default;
      if (typeof register !== 'function') {
        throw new Error('plugin.js has no default export function');
      }
      const api = buildPluginAPI(msg.pluginId, msg.permissions, msg.appVersion, msg.apiVersion);
      await (register as (api: unknown) => unknown)(api);
      const loaded: LoadedMessage = { kind: 'loaded' };
      send(loaded);
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      const failed: LoadErrorMessage = { kind: 'loadError', error };
      send(failed);
    } finally {
      if (blobUrl) URL.revokeObjectURL(blobUrl);
    }
    return;
  }

  if (msg.kind === 'invoke') {
    const handler = commandHandlers.get(msg.commandLocalId);
    if (!handler) {
      const result: InvokeResultMessage = {
        kind: 'invokeResult',
        invocationId: msg.invocationId,
        ok: false,
        error: `unknown command: ${msg.commandLocalId}`,
      };
      send(result);
      return;
    }
    try {
      await handler();
      const result: InvokeResultMessage = {
        kind: 'invokeResult',
        invocationId: msg.invocationId,
        ok: true,
      };
      send(result);
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      const result: InvokeResultMessage = {
        kind: 'invokeResult',
        invocationId: msg.invocationId,
        ok: false,
        error,
      };
      send(result);
    }
    return;
  }

  if (msg.kind === 'callResult') {
    const pending = pendingCalls.get(msg.requestId);
    if (!pending) return;
    pendingCalls.delete(msg.requestId);
    if (msg.ok) pending.resolve(msg.value);
    else pending.reject(new Error(msg.error ?? 'host call failed'));
    return;
  }
});

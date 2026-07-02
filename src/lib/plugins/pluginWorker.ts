// Runs inside a per-plugin module Worker. Establishes the sandbox, loads the
// plugin, and proxies its curated PluginAPI calls back to the host over
// postMessage. The worker has no DOM, no Zustand access, and no Tauri IPC —
// the only channel out is `postMessage`.

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

/** Delete network/DOM-ish globals that a Worker would otherwise expose to
 *  plugin code. This is defense in depth — the real boundary is that plugin
 *  code has no channel to the app except postMessage — but removing these
 *  makes accidental (or lazy) network access impossible. */
function hardenGlobalScope(): void {
  const scope = globalThis as Record<string, unknown>;
  const toRemove = [
    'fetch',
    'XMLHttpRequest',
    'WebSocket',
    'EventSource',
    'importScripts',
    'Notification',
    'BroadcastChannel',
  ];
  for (const name of toRemove) {
    try {
      delete scope[name];
    } catch {
      // Non-configurable: shadow with undefined so at least direct access fails.
      try {
        Object.defineProperty(scope, name, { value: undefined, configurable: false });
      } catch {
        // ignore
      }
    }
  }
}

function send(msg: WorkerToHost): void {
  (self as unknown as Worker).postMessage(msg);
}

// -----------------------------------------------------------------------------
// Host-call plumbing: turns a method name + args into a Promise that resolves
// when the host posts back a `callResult` with the matching requestId.
// -----------------------------------------------------------------------------

let nextRequestId = 1;
const pendingCalls = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();

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

function buildPluginAPI(pluginId: string, permissions: string[], appVersion: string, apiVersion: number) {
  const has = (perm: string) => permissions.includes(perm);
  const require = (perm: string) => {
    if (!has(perm)) {
      throw new Error(
        `Plugin "${pluginId}" used the "${perm}" API without declaring it in manifest permissions`
      );
    }
  };
  return {
    app: { version: appVersion, apiVersion },
    commands: {
      add(cmd: PluginCommand) {
        if (typeof cmd?.id !== 'string' || typeof cmd?.label !== 'string' || typeof cmd?.handler !== 'function') {
          throw new Error('commands.add expects { id, label, handler }');
        }
        commandHandlers.set(cmd.id, cmd.handler);
        const msg: CommandRegisteredMessage = { kind: 'commandRegistered', localId: cmd.id, label: cmd.label };
        send(msg);
      },
    },
    editor: {
      async getActiveNote() {
        require('editor');
        return callHost('editor.getActiveNote', []) as Promise<{ title: string; content: string } | null>;
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
      const result: InvokeResultMessage = { kind: 'invokeResult', invocationId: msg.invocationId, ok: true };
      send(result);
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      const result: InvokeResultMessage = { kind: 'invokeResult', invocationId: msg.invocationId, ok: false, error };
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

import { safeInvoke } from '@/lib/ipc';
import { getVersion } from '@tauri-apps/api/app';
import { validateManifest } from './manifest';
import { dispatchPluginCall, setPluginAppVersion, getPluginAppVersion } from './api';
import type { PluginInfo } from './types';
import type {
  CallMessage,
  CommandRegisteredMessage,
  HostToWorker,
  InvokeMessage,
  InvokeResultMessage,
  LoadErrorMessage,
  LoadedMessage,
  LogMessage,
  WorkerToHost,
} from './rpc';
import { usePluginStore } from '@/stores/pluginStore';
import { usePluginCommandStore } from '@/stores/pluginCommandStore';
import PluginWorker from './pluginWorker.ts?worker';
import { cancelPluginDialog } from './dialogs';

interface RawPlugin {
  id: string;
  manifestRaw: unknown | null;
  readError: string | null;
  contentHash: string | null;
}

/** Turn a backend RawPlugin into a classified PluginInfo (validation lives here). */
function classify(raw: RawPlugin): PluginInfo {
  const contentHash = raw.contentHash ?? undefined;
  if (raw.readError || raw.manifestRaw === null || raw.manifestRaw === undefined) {
    return {
      manifest: { id: raw.id, name: raw.id, version: '?', apiVersion: 0 },
      status: 'invalid',
      reason: raw.readError ?? 'missing manifest',
      contentHash,
    };
  }
  const v = validateManifest(raw.manifestRaw, raw.id);
  if (!v.ok) {
    const incompatible = v.reason.includes('apiVersion');
    return {
      manifest: { id: raw.id, name: raw.id, version: '?', apiVersion: 0 },
      status: incompatible ? 'incompatible' : 'invalid',
      reason: v.reason,
      contentHash,
    };
  }
  return { manifest: v.manifest, status: 'ok', contentHash };
}

// -----------------------------------------------------------------------------
// Per-plugin runtime state.
// -----------------------------------------------------------------------------

interface PluginRuntime {
  worker: Worker;
  permissions: readonly string[];
  manifestHosts: readonly string[];
  pluginName: string;
  apiVersion: number;
  /** Fire-and-await from the host: match `invokeResult` back to a Promise. */
  pendingInvocations: Map<
    number,
    { resolve: () => void; reject: (e: Error) => void; timeout: ReturnType<typeof setTimeout> }
  >;
  nextInvocationId: number;
}

const runtimes = new Map<string, PluginRuntime>();
const INVOCATION_TIMEOUT_MS = 30_000;

async function fetchPluginSource(pluginId: string): Promise<string> {
  const url = `plugin://localhost/${pluginId}/plugin.js`;
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`fetch ${url} failed with status ${resp.status}`);
  return await resp.text();
}

function terminateRuntime(pluginId: string, reason = 'plugin was unloaded') {
  const rt = runtimes.get(pluginId);
  if (!rt) return;
  rt.worker.terminate();
  cancelPluginDialog(pluginId);
  for (const pending of rt.pendingInvocations.values()) {
    clearTimeout(pending.timeout);
    pending.reject(new Error(reason));
  }
  rt.pendingInvocations.clear();
  runtimes.delete(pluginId);
  usePluginCommandStore.getState().removeByPlugin(pluginId);
}

/** Invoke a plugin command via its worker; resolves when the command handler completes. */
function invokeCommandInWorker(pluginId: string, commandLocalId: string): Promise<void> {
  const rt = runtimes.get(pluginId);
  if (!rt) return Promise.reject(new Error(`plugin ${pluginId} is not running`));
  const invocationId = rt.nextInvocationId++;
  return new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      const current = runtimes.get(pluginId);
      const pending = current?.pendingInvocations.get(invocationId);
      if (!pending) return;
      current?.pendingInvocations.delete(invocationId);
      pending.reject(new Error('plugin command timed out'));
    }, INVOCATION_TIMEOUT_MS);
    rt.pendingInvocations.set(invocationId, { resolve, reject, timeout });
    const msg: InvokeMessage = { kind: 'invoke', invocationId, commandLocalId };
    rt.worker.postMessage(msg);
  });
}

async function handleWorkerMessage(pluginId: string, event: MessageEvent<WorkerToHost>) {
  const rt = runtimes.get(pluginId);
  if (!rt) return;
  const msg = event.data;
  if (!msg || typeof msg !== 'object') return;

  switch (msg.kind) {
    case 'commandRegistered': {
      const { localId, label } = msg as CommandRegisteredMessage;
      usePluginCommandStore.getState().addCommand({
        pluginId,
        id: `${pluginId}:${localId}`,
        label,
        handler: () => invokeCommandInWorker(pluginId, localId),
      });
      return;
    }
    case 'call': {
      const call = msg as CallMessage;
      try {
        const value = await dispatchPluginCall(
          pluginId,
          rt.permissions,
          call.method,
          call.args,
          rt.manifestHosts,
          rt.apiVersion,
          rt.pluginName
        );
        rt.worker.postMessage({ kind: 'callResult', requestId: call.requestId, ok: true, value });
      } catch (err) {
        const error = err instanceof Error ? err.message : String(err);
        rt.worker.postMessage({ kind: 'callResult', requestId: call.requestId, ok: false, error });
      }
      return;
    }
    case 'invokeResult': {
      const result = msg as InvokeResultMessage;
      const pending = rt.pendingInvocations.get(result.invocationId);
      if (!pending) return;
      rt.pendingInvocations.delete(result.invocationId);
      clearTimeout(pending.timeout);
      if (result.ok) pending.resolve();
      else pending.reject(new Error(result.error ?? 'command failed'));
      return;
    }
    case 'loaded': {
      // Nothing to do — commandRegistered messages already populated the store.
      // Kept as a distinct message so future logic (e.g. "plugin is ready" UI) can hook in.
      void (msg as LoadedMessage);
      return;
    }
    case 'loadError': {
      const err = msg as LoadErrorMessage;
      console.error(`[plugin:${pluginId}] failed to load:`, err.error);
      terminateRuntime(pluginId, `plugin failed to load: ${err.error}`);
      return;
    }
    case 'log': {
      const log = msg as LogMessage;
      // Plugin console forwarding intentionally preserves log severity.
      /* eslint-disable no-console */
      const fn =
        log.level === 'error' ? console.error : log.level === 'warn' ? console.warn : console.log;
      /* eslint-enable no-console */
      fn(`[plugin:${pluginId}]`, ...log.args);
      return;
    }
  }
}

async function loadOne(info: PluginInfo): Promise<void> {
  const { id, permissions = [], allowedHosts = [] } = info.manifest;

  let code: string;
  try {
    code = await fetchPluginSource(id);
  } catch (err) {
    console.error(`[plugin:${id}] failed to fetch source:`, err);
    return;
  }

  const worker = new PluginWorker();
  const rt: PluginRuntime = {
    worker,
    permissions,
    manifestHosts: allowedHosts,
    pluginName: info.manifest.name,
    apiVersion: info.manifest.apiVersion,
    pendingInvocations: new Map(),
    nextInvocationId: 1,
  };
  runtimes.set(id, rt);

  worker.addEventListener('message', (e) => {
    void handleWorkerMessage(id, e as MessageEvent<WorkerToHost>);
  });
  worker.addEventListener('error', (e) => {
    console.error(`[plugin:${id}] worker error:`, e.message);
    terminateRuntime(id, `plugin worker crashed: ${e.message || 'unknown error'}`);
  });
  worker.addEventListener('messageerror', () => {
    console.error(`[plugin:${id}] worker sent an unreadable message`);
    terminateRuntime(id, 'plugin worker message could not be decoded');
  });

  const init: HostToWorker = {
    kind: 'init',
    pluginId: id,
    code,
    permissions,
    apiVersion: info.manifest.apiVersion,
    appVersion: getPluginAppVersion(),
  };
  worker.postMessage(init);
}

/**
 * Scan the active Forge's plugins, (re)load every enabled + granted +
 * compatible one in an isolated Worker sandbox, and return the full
 * classified list for the Settings UI. Clears previously-registered commands
 * and terminates every prior worker first so it is safe to call on
 * enable/disable/refresh.
 */
export async function loadEnabledPlugins(): Promise<PluginInfo[]> {
  setPluginAppVersion(await getVersion().catch(() => '0.0.0'));

  // Tear down any running workers before reloading.
  for (const id of Array.from(runtimes.keys())) {
    terminateRuntime(id);
  }
  usePluginCommandStore.getState().clear();

  let raw: RawPlugin[];
  try {
    raw = (await safeInvoke<RawPlugin[]>('list_plugins')) ?? [];
  } catch (err) {
    console.error('[plugins] list_plugins failed:', err);
    return [];
  }

  const infos = raw.map(classify);
  const store = usePluginStore.getState();
  for (const info of infos) {
    if (info.status !== 'ok') continue;
    if (store.isEnabledAndGranted(info.manifest.id, info.manifest.version, info.contentHash)) {
      await loadOne(info);
    }
  }
  return infos;
}

/** Terminate a plugin's worker and drop its commands (on disable/uninstall). */
export function unloadPlugin(id: string): void {
  terminateRuntime(id);
  usePluginCommandStore.getState().removeByPlugin(id);
}

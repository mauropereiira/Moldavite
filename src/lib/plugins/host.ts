import { isMobilePlatform } from '@/lib/platform';
/**
 * Main-thread lifecycle manager for sandboxed plugin workers.
 *
 * Backend manifest/code records and every worker `postMessage` are untrusted. This
 * module validates manifests, pins grants to content hashes, routes only declared
 * RPC message kinds through `api.ts`, and terminates timed-out or unloaded workers.
 * Plugin source must never execute on the main thread or receive a direct store,
 * editor, DOM, network, Keychain, filesystem, or Tauri handle.
 */

import { safeInvoke } from '@/lib/ipc';
import { getVersion } from '@tauri-apps/api/app';
import { isNewerVersion } from '@/lib/changelog';
import {
  MAX_COMMAND_ID_LENGTH,
  MAX_COMMAND_LABEL_LENGTH,
  MAX_MANIFEST_COMMANDS,
  validateManifest,
} from './manifest';
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
import {
  PLUGINS_RUNNING,
  toSafeModeStatus,
  usePluginSafeModeStore,
  type SafeModeStatus,
} from '@/stores/pluginSafeModeStore';
import { whenMainThreadSettles } from './settle';
// Inline, so the worker starts from a blob URL and inherits the page CSP. Tauri
// sends that header only with HTML, so a worker loaded from its own URL gets no
// policy and plugin code in it can `import()` from any origin.
import PluginWorker from './pluginWorker.ts?worker&inline';
import { cancelPluginDialog } from './dialogs';

interface RawPlugin {
  id: string;
  manifestRaw: unknown | null;
  readError: string | null;
  contentHash: string | null;
  /** Source read and hashed by the backend in the same snapshot. */
  code: string | null;
}

/** Classify one raw backend record; only validated manifests become loadable. */
function classify(raw: RawPlugin, appVersion: string): PluginInfo {
  const contentHash = raw.contentHash ?? undefined;
  if (
    raw.readError ||
    raw.manifestRaw === null ||
    raw.manifestRaw === undefined ||
    typeof raw.code !== 'string' ||
    !raw.contentHash
  ) {
    return {
      manifest: { id: raw.id, name: raw.id, version: '?', apiVersion: 0 },
      status: 'invalid',
      reason: raw.readError ?? 'missing manifest, source, or content hash',
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
  const needs = v.manifest.minAppVersion;
  if (needs && isNewerVersion(needs, appVersion)) {
    return {
      manifest: v.manifest,
      status: 'incompatible',
      reason: `Needs Moldavite ${needs} or later`,
      contentHash,
    };
  }
  return { manifest: v.manifest, status: 'ok', contentHash };
}

interface PluginRuntime {
  worker: Worker;
  contentHash: string | undefined;
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
  /** Local ids this worker has already registered, so a flood can be bounded. */
  registeredCommandIds: Set<string>;
  /** Keeps a misbehaving worker from filling the console with the same warning. */
  commandDropWarned: boolean;
}

const runtimes = new Map<string, PluginRuntime>();
/** Only the newest snapshot may start or stop workers; an older one still returns its list. */
let applyGeneration = 0;
/** Only the newest launch-time start may report that plugins settled. */
let startupGeneration = 0;
const INVOCATION_TIMEOUT_MS = 30_000;

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

/**
 * The worker-side check in `commands.add` is a developer aid, not a boundary —
 * plugin code can call `postMessage` itself. A non-string label throws inside
 * React when the palette renders it, and an unbounded stream of registrations
 * grows the store without limit, so apply the manifest's own bounds here.
 */
function acceptsCommandRegistration(rt: PluginRuntime, localId: unknown, label: unknown): boolean {
  if (typeof localId !== 'string' || typeof label !== 'string') return false;
  if (localId.length === 0 || localId.length > MAX_COMMAND_ID_LENGTH) return false;
  if (label.length === 0 || label.length > MAX_COMMAND_LABEL_LENGTH) return false;
  return (
    rt.registeredCommandIds.has(localId) || rt.registeredCommandIds.size < MAX_MANIFEST_COMMANDS
  );
}

/** Route one untrusted worker message without exposing host capabilities directly. */
async function handleWorkerMessage(pluginId: string, event: MessageEvent<WorkerToHost>) {
  const rt = runtimes.get(pluginId);
  if (!rt) return;
  const msg = event.data;
  if (!msg || typeof msg !== 'object') return;

  switch (msg.kind) {
    case 'commandRegistered': {
      const { localId, label } = msg as CommandRegisteredMessage;
      if (!rt.permissions.includes('commands') || !acceptsCommandRegistration(rt, localId, label)) {
        if (!rt.commandDropWarned) {
          rt.commandDropWarned = true;
          console.error(
            `[plugin:${pluginId}] ignored an unauthorized, malformed, or excessive command registration`
          );
        }
        return;
      }
      rt.registeredCommandIds.add(localId);
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
      // The worker can post anything; without a numeric id there is nothing to
      // reply to, and a non-array `args` would be index-read as one.
      if (typeof call.requestId !== 'number' || typeof call.method !== 'string') return;
      const args = Array.isArray(call.args) ? call.args : [];
      try {
        const value = await dispatchPluginCall(
          pluginId,
          rt.permissions,
          call.method,
          args,
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
      // Spreading a non-array here would reject this handler's promise with
      // nothing to catch it.
      if (!Array.isArray(log.args)) return;
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

function loadOne(info: PluginInfo, code: string): void {
  const { id, permissions = [], allowedHosts = [] } = info.manifest;

  const worker = new PluginWorker();
  const rt: PluginRuntime = {
    worker,
    contentHash: info.contentHash,
    permissions,
    manifestHosts: allowedHosts,
    pluginName: info.manifest.name,
    apiVersion: info.manifest.apiVersion,
    pendingInvocations: new Map(),
    nextInvocationId: 1,
    registeredCommandIds: new Set(),
    commandDropWarned: false,
  };
  // Overwriting the map entry would orphan a live worker that no unload can reach.
  terminateRuntime(id);
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

interface SnapshotEntry {
  info: PluginInfo;
  code: string | null;
}

async function snapshot(): Promise<SnapshotEntry[]> {
  setPluginAppVersion(await getVersion().catch(() => '0.0.0'));
  let raw: RawPlugin[];
  try {
    raw = (await safeInvoke<RawPlugin[]>('list_plugins')) ?? [];
  } catch (err) {
    console.error('[plugins] list_plugins failed:', err);
    return [];
  }
  const appVersion = getPluginAppVersion();
  return raw.map((record) => ({ info: classify(record, appVersion), code: record.code }));
}

function runnable(entries: SnapshotEntry[]): Map<string, { info: PluginInfo; code: string }> {
  const store = usePluginStore.getState();
  const wanted = new Map<string, { info: PluginInfo; code: string }>();
  if (usePluginSafeModeStore.getState().status.active) return wanted;
  for (const { info, code } of entries) {
    const { id, version } = info.manifest;
    if (
      info.status === 'ok' &&
      typeof code === 'string' &&
      store.isEnabledAndGranted(id, version, info.contentHash)
    ) {
      wanted.set(id, { info, code });
    }
  }
  return wanted;
}

/**
 * Start what should run and stop what should not, leaving every other worker
 * alone: a plugin keeps running while another one is toggled, and one whose
 * code changed on disk is stopped because its grant no longer matches.
 */
function apply(entries: SnapshotEntry[]): void {
  const wanted = runnable(entries);
  for (const [id, rt] of Array.from(runtimes)) {
    if (wanted.get(id)?.info.contentHash !== rt.contentHash) terminateRuntime(id);
  }
  for (const [id, { info, code }] of wanted) {
    if (!runtimes.has(id)) loadOne(info, code);
  }
}

/** The active Forge's plugins, classified for display. Starts and stops nothing. */
export async function listPlugins(): Promise<PluginInfo[]> {
  // Synced Forge folders may contain desktop plugins. Never execute them on iOS.
  if (isMobilePlatform()) return [];
  return (await snapshot()).map(({ info }) => info);
}

/** Bring running workers in line with what is installed, enabled and granted. */
export async function reconcilePlugins(): Promise<PluginInfo[]> {
  if (isMobilePlatform()) return [];
  const generation = ++applyGeneration;
  const entries = await snapshot();
  if (generation === applyGeneration) apply(entries);
  return entries.map(({ info }) => info);
}

async function reportSafeMode(
  command: string,
  args: Record<string, unknown>
): Promise<SafeModeStatus> {
  const status = toSafeModeStatus(await safeInvoke<unknown>(command, args));
  usePluginSafeModeStore.getState().setStatus(status);
  return status;
}

/**
 * Start plugins for a freshly loaded window. Rust records which plugins are
 * starting before any worker exists and forgets it once the window has kept
 * time for a few seconds; if this launch dies or freezes first, the next one
 * starts without plugins.
 */
export async function startPluginsAtLaunch(): Promise<SafeModeStatus> {
  if (isMobilePlatform()) return PLUGINS_RUNNING;
  const launch = ++startupGeneration;
  const generation = ++applyGeneration;
  const entries = await snapshot();
  const starting = Array.from(runnable(entries).keys());
  let status: SafeModeStatus;
  try {
    status = await reportSafeMode('begin_plugin_startup', { pluginIds: starting });
  } catch (err) {
    // Without the marker a crash here goes unnoticed next launch, but the
    // plugins themselves are fine to run.
    console.error('[plugins] could not record the plugin start:', err);
    status = usePluginSafeModeStore.getState().status;
  }
  if (generation === applyGeneration) apply(entries);
  if (!status.active && starting.length > 0) {
    void whenMainThreadSettles().then(() => {
      if (launch !== startupGeneration) return;
      return safeInvoke('finish_plugin_startup').catch((err: unknown) =>
        console.error('[plugins] could not record that plugins started:', err)
      );
    });
  }
  return status;
}

/** Stop every plugin for the rest of this session, or start them again. */
export async function setPluginsPaused(paused: boolean): Promise<SafeModeStatus> {
  if (isMobilePlatform()) return PLUGINS_RUNNING;
  const status = await reportSafeMode('set_plugin_safe_mode', { active: paused });
  if (status.active) {
    ++startupGeneration;
    ++applyGeneration;
    for (const id of Array.from(runtimes.keys())) terminateRuntime(id);
    return status;
  }
  return startPluginsAtLaunch();
}

/** Terminate a plugin's worker and drop its commands (on disable/uninstall). */
export function unloadPlugin(id: string): void {
  terminateRuntime(id);
  usePluginCommandStore.getState().removeByPlugin(id);
}

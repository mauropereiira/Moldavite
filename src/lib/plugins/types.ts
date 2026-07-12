export const PLUGIN_API_VERSION = 2;
export const SUPPORTED_PLUGIN_API_VERSIONS = [1, 2] as const;

export interface PluginManifest {
  id: string;
  name: string;
  version: string;
  author?: string;
  description?: string;
  apiVersion: number;
  minAppVersion?: string;
  permissions?: string[];
  /** Exact HTTPS hostnames the plugin may contact through api.net.fetch. */
  allowedHosts?: string[];
}

export type PluginStatus = 'ok' | 'invalid' | 'incompatible';

export interface PluginInfo {
  manifest: PluginManifest;
  status: PluginStatus;
  reason?: string;
  /** SHA-256 of manifest.json + plugin.js, computed by the backend. Consent
   *  is pinned to this hash, so changed plugin code always re-prompts. */
  contentHash?: string;
}

export interface PluginCommand {
  id: string;
  label: string;
  handler: () => void | Promise<void>;
}

export interface PluginAPI {
  app: { version: string; apiVersion: number };
  commands: { add(cmd: PluginCommand): void };
  editor: {
    // Async since plugins run in a Worker sandbox; every editor/ui method
    // round-trips through postMessage to the host thread.
    getActiveNote(): Promise<{ title: string; content: string } | null>;
    insertText(text: string): Promise<void>;
  };
  ui: { toast(message: string, kind?: 'info' | 'success' | 'error'): Promise<void> };
  notes: {
    list(): Promise<PluginNoteMetadata[]>;
    read(path: string): Promise<string>;
  };
  net: {
    fetch(url: string, options?: PluginFetchOptions): Promise<PluginFetchResponse>;
  };
  secrets: {
    get(key: string): Promise<string | null>;
    set(key: string, value: string): Promise<void>;
    delete(key: string): Promise<void>;
  };
}

export type PluginNoteKind = 'daily' | 'weekly' | 'standalone';

export interface PluginNoteMetadata {
  path: string;
  title: string;
  kind: PluginNoteKind;
  folder: string | null;
}

export interface PluginFetchOptions {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
}

export interface PluginFetchResponse {
  status: number;
  headers: Record<string, string>;
  bodyText: string;
  bodyBase64?: string;
}

export interface LoadedPlugin {
  id: string;
  register: (api: PluginAPI) => void | Promise<void>;
}

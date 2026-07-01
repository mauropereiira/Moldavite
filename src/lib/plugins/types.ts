export const PLUGIN_API_VERSION = 1;

export interface PluginManifest {
  id: string;
  name: string;
  version: string;
  author?: string;
  description?: string;
  apiVersion: number;
  minAppVersion?: string;
  permissions?: string[];
}

export type PluginStatus = 'ok' | 'invalid' | 'incompatible';

export interface PluginInfo {
  manifest: PluginManifest;
  status: PluginStatus;
  reason?: string;
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
    getActiveNote(): { title: string; content: string } | null;
    insertText(text: string): void;
  };
  ui: { toast(message: string, kind?: 'info' | 'success' | 'error'): void };
}

export interface LoadedPlugin {
  id: string;
  register: (api: PluginAPI) => void | Promise<void>;
}

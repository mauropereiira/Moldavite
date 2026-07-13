/**
 * Singleton queue boundary between permission-checked plugin API calls and host UI.
 * Only normalized prompt fields or one exact hostname cross into this module; raw
 * worker messages never do. At most one request is active, results return only to
 * its plugin promise, and unloading a plugin must cancel its pending dialog.
 */

import type { PluginPromptOptions } from './types';

type PluginDialogPayload =
  | {
      kind: 'prompt';
      pluginName: string;
      options: PluginPromptOptions;
    }
  | {
      kind: 'host-access';
      pluginName: string;
      host: string;
    };

export type PluginDialogRequest = PluginDialogPayload & {
  requestId: number;
  pluginId: string;
};

type DialogResult = Record<string, string> | boolean | null;
type Listener = () => void;

let active: PluginDialogRequest | null = null;
let nextId = 1;
let resolveActive: ((value: DialogResult) => void) | null = null;
const listeners = new Set<Listener>();

function emit(): void {
  for (const listener of listeners) listener();
}

function open(request: PluginDialogPayload & { pluginId: string }): Promise<DialogResult> | null {
  // A plugin cannot stack dialogs over another plugin or over its own prompt.
  if (active) return null;
  active = { ...request, requestId: nextId++ };
  emit();
  return new Promise((resolve) => {
    resolveActive = resolve;
  });
}

export function requestPluginPrompt(
  pluginId: string,
  pluginName: string,
  options: PluginPromptOptions
): Promise<Record<string, string> | null> {
  const pending = open({ pluginId, kind: 'prompt', pluginName, options });
  return pending ? (pending as Promise<Record<string, string> | null>) : Promise.resolve(null);
}

export function requestPluginHostAccess(
  pluginId: string,
  pluginName: string,
  host: string
): Promise<boolean> {
  const pending = open({ pluginId, kind: 'host-access', pluginName, host });
  return pending ? (pending as Promise<boolean>) : Promise.resolve(false);
}

export function resolvePluginDialog(value: DialogResult): void {
  const resolve = resolveActive;
  if (!active || !resolve) return;
  active = null;
  resolveActive = null;
  emit();
  resolve(value);
}

/** Cancel a plugin-owned dialog when its worker is unloaded or its Forge changes. */
export function cancelPluginDialog(pluginId: string): void {
  if (active?.pluginId !== pluginId) return;
  resolvePluginDialog(active.kind === 'prompt' ? null : false);
}

export function getPluginDialogSnapshot(): PluginDialogRequest | null {
  return active;
}

export function subscribePluginDialogs(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

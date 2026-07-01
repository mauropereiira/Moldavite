import { PLUGIN_API_VERSION, type PluginAPI } from './types';
import { usePluginCommandStore } from '@/stores/pluginCommandStore';
import { useToastStore } from '@/stores/toastStore';
import { useNoteStore } from '@/stores/noteStore';
import { editorHandle } from '@/stores/editorHandleStore';

// App version is injected by the host to avoid a hard Tauri dependency in tests.
let appVersion = '0.0.0';
export function setPluginAppVersion(v: string) {
  appVersion = v;
}

/**
 * Build the curated PluginAPI handed to a plugin's `register(api)`. Command ids
 * are namespaced by plugin; editor/toast calls dispatch to the app stores.
 *
 * Declared `permissions` are enforced: a plugin that uses `editor`/`ui` without
 * declaring the matching permission gets a thrown error (caught + toasted by
 * the command wrapper), so the manifest declaration is real, not decorative.
 * `commands` is the always-available core capability for v1 command plugins.
 */
export function buildPluginAPI(pluginId: string, permissions: string[] = []): PluginAPI {
  const requirePermission = (perm: string) => {
    if (!permissions.includes(perm)) {
      throw new Error(
        `Plugin "${pluginId}" used the "${perm}" API without declaring it in manifest permissions`
      );
    }
  };
  return {
    app: { version: appVersion, apiVersion: PLUGIN_API_VERSION },
    commands: {
      add(cmd) {
        usePluginCommandStore.getState().addCommand({
          pluginId,
          id: `${pluginId}:${cmd.id}`,
          label: cmd.label,
          handler: cmd.handler,
        });
      },
    },
    editor: {
      getActiveNote() {
        requirePermission('editor');
        const note = useNoteStore.getState().currentNote;
        return note ? { title: note.title, content: note.content } : null;
      },
      insertText(text) {
        requirePermission('editor');
        const ok = editorHandle.insertTextAtCursor(text);
        if (!ok) useToastStore.getState().addToast('error', 'No active editor to insert into');
      },
    },
    ui: {
      toast(message, kind = 'info') {
        requirePermission('ui');
        useToastStore.getState().addToast(kind === 'error' ? 'error' : 'success', message);
      },
    },
  };
}

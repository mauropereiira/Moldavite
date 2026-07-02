# Building Moldavite Plugins

Moldavite plugins let you add **commands** to the app — they show up in the
command palette (⌘/Ctrl + P) and the editor slash menu (type `/`). This is the
v1 plugin API; see [the roadmap](#v2-roadmap) for what's coming.

> **Trust model — read this first.** Plugins run in a **sandboxed Web Worker**
> — no DOM, no Zustand stores, no Tauri IPC, no `fetch`/`XMLHttpRequest`. The
> only channel back into the app is a `postMessage` bridge, and every call it
> can make maps to one method in the curated `PluginAPI` below. Method
> permissions are enforced **on the host side** of the bridge — a plugin can't
> reach a method its manifest didn't declare, even if it tries to bypass the
> API object it was handed. Moldavite shows a permission sheet before enabling
> any plugin, and your consent is **pinned to the plugin's content**: a
> SHA-256 hash of `manifest.json` + `plugin.js` is recorded at grant time, so
> *any* change to the plugin's code re-triggers the permission sheet before
> it runs again.
>
> Still: enabling a plugin means running someone else's code. Only enable
> plugins you trust.

## Quick start

1. Create a folder in your Forge at `.plugins/<plugin-id>/` (your Forge is the
   notes directory, e.g. `~/Documents/Moldavite/Default/`).
2. Add `manifest.json` and `plugin.js` (below).
3. Open **Settings → Plugins**, find your plugin, and toggle it on (accept the
   permission sheet).
4. Run your command from the palette (⌘/Ctrl + P) or slash menu (`/`).

Or click **Settings → Plugins → Install example plugin** to drop a working
example (`moldavite-example`) into your Forge and read its source.

## Package layout

```
<forge>/.plugins/my-plugin/
├── manifest.json     # identity + declared capabilities
├── plugin.js         # ESM; default-exports register(api)
└── README.md         # optional
```

## manifest.json

```json
{
  "id": "my-plugin",
  "name": "My Plugin",
  "version": "1.0.0",
  "author": "You",
  "description": "What it does.",
  "apiVersion": 1,
  "minAppVersion": "1.4.0",
  "permissions": ["commands", "editor", "ui"]
}
```

| Field | Required | Notes |
|-------|----------|-------|
| `id` | yes | Must equal the folder name; `^[a-z0-9][a-z0-9-]*$`. |
| `name` | yes | Display name. |
| `version` | yes | Semver. Consent is content-hash-pinned, so any change to `manifest.json` or `plugin.js` (version bump or not) re-triggers the permission sheet. |
| `apiVersion` | yes | Must be `1`. Other values are shown as *incompatible* and not loaded. |
| `author` | no | Shown in the manager + permission sheet. |
| `description` | no | Shown in the manager + permission sheet. |
| `minAppVersion` | no | Informational for now. |
| `permissions` | no | Declares which API groups you use (`editor`, `ui`). Enforced — see below. |

## plugin.js

An ES module whose **default export** is `register(api)`, called once when the
plugin loads:

```js
export default function register(api) {
  api.commands.add({
    id: 'greet',
    label: 'Insert greeting',
    handler: async () => {
      await api.editor.insertText('Hello from my plugin!');
    },
  });
}
```

All `editor` and `ui` calls are **async** — they cross a `postMessage` bridge
to the main thread. Command handlers can be sync or async; the app awaits
them either way.

## The v1 API

```ts
interface PluginAPI {
  app: { version: string; apiVersion: number };

  // Always available.
  commands: {
    add(cmd: {
      id: string;                    // namespaced to `${pluginId}:${id}` internally
      label: string;                 // shown in palette + slash menu
      handler: () => void | Promise<void>;
    }): void;
  };

  // Requires "editor" in manifest permissions.
  editor: {
    getActiveNote(): Promise<{ title: string; content: string } | null>;  // content is HTML
    insertText(text: string): Promise<void>;                              // at the cursor
  };

  // Requires "ui" in manifest permissions.
  ui: {
    toast(message: string, kind?: 'info' | 'success' | 'error'): Promise<void>;
  };
}
```

**Permissions are enforced.** If you call `api.editor.*` or `api.ui.*` without
declaring the matching permission in your manifest, the call throws (and
Moldavite shows an error toast). `commands` is always available.

**Errors are contained.** If your `register` or a command handler throws,
Moldavite logs it (`[plugin:<id>]` in the console) and shows a toast — it never
crashes the app.

## How commands surface

Every command you register appears in:
- the **command palette** (⌘/Ctrl + P), under a "Plugins" group, and
- the **editor slash menu** (type `/`), with a puzzle-piece icon.

Selecting one runs your `handler`.

## Enabling, versioning, uninstalling

- **Enable/disable** per plugin in Settings → Plugins. Enable state is
  **per-Forge** — a Work Forge and a Personal Forge can run different plugins.
- **Any change to a plugin's files** (`manifest.json` or `plugin.js`)
  re-triggers the permission sheet — consent is pinned to a content hash, so
  code silently swapped on disk never runs on stale consent.
- **Uninstall** deletes the folder from your Forge and forgets the grant.
- Plugins **load on app start** and after a Forge switch. There's no hot-reload
  in v1 — edit `plugin.js`, then reopen the app (or the Plugins tab re-scans).

## The sandbox in detail

When you enable a plugin, Moldavite:

1. Reads `plugin.js` from the plugin's folder (path-traversal-checked; served
   over the dedicated `plugin://` scheme, never `eval`).
2. Computes SHA-256 of `manifest.json` + `plugin.js` and checks it against
   your recorded grant. Mismatched? Re-prompt.
3. Spawns a fresh **module Web Worker** for that plugin.
4. Deletes network globals (`fetch`, `XMLHttpRequest`, `WebSocket`,
   `EventSource`, `importScripts`, `Notification`, `BroadcastChannel`) inside
   the worker before running any plugin code.
5. Loads `plugin.js` into the worker via a Blob URL and calls its default
   `register(api)`.
6. The `api` object handed to `register` is a proxy: every editor/ui method
   posts a message to the main thread. The host validates the plugin's
   declared permissions on receipt and only then calls the real
   implementation, then posts the result back.

**Consequences for plugin authors:**

- `getActiveNote()` and `insertText()` are now **async** — they return
  Promises. `await` them (or ignore the promise for fire-and-forget calls).
- You can't reach `window`, `document`, `localStorage`, or `fetch`. If your
  plugin needs the network, that's a v2 feature (per-host allowlist).
- You can `import` other files from *within* the worker via ES module syntax,
  but only your own inlined code — the worker has no filesystem or `plugin://`
  access.

Disable a plugin (or switch Forges) and its worker is `terminate()`-d
immediately, dropping every command and cancelling every in-flight call.

## v2 roadmap

Planned for future versions (already sketched in `PLUGINS_DESIGN.md`):
network `fetch` with a per-host allowlist, editor/sidebar context-menu items,
right-panel widgets, forge note read/write, plugin-owned frontmatter keys,
`ui.prompt`, per-handler timeouts, and the Web Clipper receiver.
(Worker isolation shipped in v1.5, alongside content-hash-pinned grants.)

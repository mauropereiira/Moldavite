# Building Moldavite Plugins

Moldavite plugins let you add **commands** to the app — they show up in the
command palette (⌘/Ctrl + P) and the editor slash menu (type `/`). This is the
v1 plugin API; see [the roadmap](#v2-roadmap) for what's coming.

> **Trust model — read this first.** Plugins are **permissioned-open**: a plugin
> you enable runs real JavaScript inside Moldavite. The manifest's `permissions`
> gate the *curated* `PluginAPI`, but a plugin is **not fully sandboxed** — it
> runs in the app's webview and can reach the DOM and app internals. **Only
> install and enable plugins you trust.** Moldavite shows a permission sheet
> before enabling any plugin, and your consent is **pinned to the plugin's
> content**: a SHA-256 hash of `manifest.json` + `plugin.js` is recorded at
> grant time, so *any* change to the plugin's code — not just a version bump —
> re-triggers the permission sheet before it runs again. The raw Tauri IPC
> bridge (`window.__TAURI__`) is not exposed to the webview.

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
    handler: () => api.editor.insertText('Hello from my plugin!'),
  });
}
```

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
    getActiveNote(): { title: string; content: string } | null;  // content is HTML
    insertText(text: string): void;                              // at the cursor
  };

  // Requires "ui" in manifest permissions.
  ui: {
    toast(message: string, kind?: 'info' | 'success' | 'error'): void;
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

## Security notes (please read)

- A granted plugin runs in the app's webview; the curated `PluginAPI` is a
  *convenience*, not a security boundary. Treat installing a plugin like
  installing any third-party program.
- The raw IPC bridge is not exposed (`withGlobalTauri` is off), and the page
  CSP restricts where scripts load from and what hosts can be contacted — but
  a plugin still shares the DOM with the app.
- Consent is content-hash-pinned: Moldavite re-prompts before running any
  plugin whose files changed since you granted it.
- Plugins can only be *served* from inside the active Forge's `.plugins/`
  directory (the loader rejects path traversal), and load over a dedicated
  `plugin://` scheme rather than `eval`.
- Do not paste plugin code you don't understand. There is no marketplace review.

## v2 roadmap

Planned for future versions (already sketched in `PLUGINS_DESIGN.md`):
network `fetch` with a per-host allowlist, editor/sidebar context-menu items,
right-panel widgets, forge note read/write, plugin-owned frontmatter keys,
`ui.prompt`, per-handler timeouts, and **Worker/iframe isolation** — running
plugins outside the app realm behind a postMessage RPC bridge, so the curated
API becomes a real security boundary. (Content-hash-pinned grants shipped in
v1.5.) Plus the Web Clipper receiver.

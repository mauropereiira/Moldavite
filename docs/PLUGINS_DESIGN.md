# Plugins — Design Sketch (v0)

Status: **design only** — not implemented. This doc records the shape we're aiming for so future work can converge.

## Goal

Let users add integrations (Zoom, Google Meet, Web Clipper, custom scripts) without baking them into the core app. Inspired by Obsidian's plugin model, scoped to what's safe + maintainable in a small codebase.

## Non-goals

- Sandboxing arbitrary native code. Plugins ship as JS modules with a constrained API.
- A marketplace. v0 is "drop a folder in your Forge".
- Hot-reload. Plugins load on app start; reload after changes.

## Scope of v0

A plugin can:

1. Add **commands** to the QuickSwitcher action list (e.g. "Insert Zoom link", "Clip current tab").
2. Add **menu items** to the editor overflow menu and sidebar note context menu.
3. Read + write the **active note** through a typed API (`getActiveNote`, `replaceContent`, `insertAtCursor`).
4. Call **HTTP fetch** with explicit user permission per host (allowlist stored in plugin's `manifest.json`).
5. Register a **frontmatter key** it owns (e.g. `zoom-meeting-id`) so external tools see it.
6. Render a **right-panel widget** (a small React subtree mounted in a slot).

A plugin **cannot**:
- Read other Forges or files outside the active Forge.
- Spawn processes or load native modules.
- Modify Moldavite source.

## Plugin layout

Plugins live in the active Forge under `.plugins/<plugin-id>/`:

```
<forge>/.plugins/zoom-helper/
├── manifest.json
├── plugin.js            # ESM, default-exports a register fn
└── README.md
```

`manifest.json`:
```json
{
  "id": "zoom-helper",
  "name": "Zoom Helper",
  "version": "0.1.0",
  "author": "...",
  "permissions": {
    "fetch": ["https://api.zoom.us/v2/*"],
    "frontmatter": ["zoom-meeting-id", "zoom-meeting-url"]
  },
  "ui": ["command", "context-menu", "right-panel"]
}
```

`plugin.js`:
```js
export default function register(api) {
  api.commands.add({
    id: 'zoom.insert',
    label: 'Insert Zoom Meeting Link',
    handler: async () => {
      const url = await api.fetch('https://api.zoom.us/v2/meetings');
      api.editor.insertAtCursor(`[[Meeting]](${url})`);
    },
  });
}
```

## API surface (sketch)

```ts
type PluginAPI = {
  app: { version: string; forge: string };
  commands: {
    add(cmd: { id: string; label: string; handler: () => void | Promise<void> }): Disposable;
  };
  contextMenu: {
    addNote(item: { id: string; label: string; handler: (note: Note) => void }): Disposable;
  };
  editor: {
    getActiveNote(): Note | null;
    insertAtCursor(text: string): void;
    replaceContent(content: string): void;
  };
  forge: {
    listNotes(): Promise<NoteFile[]>;
    readNote(path: string): Promise<{ content: string; frontmatter: Record<string, unknown> }>;
    writeNote(path: string, content: string, frontmatter?: Record<string, unknown>): Promise<void>;
  };
  fetch(url: string, init?: RequestInit): Promise<Response>;     // gated by manifest allowlist
  rightPanel: {
    register(slot: { id: string; render: (root: HTMLElement) => () => void }): Disposable;
  };
  ui: {
    toast(msg: string, kind?: 'info' | 'success' | 'error'): void;
    prompt(opts: { title: string; placeholder?: string }): Promise<string | null>;
  };
};
```

## Trust model

- Plugins are JS, not sandboxed at runtime. Trust comes from the user explicitly enabling each plugin (Settings → Plugins).
- First load of a plugin shows a permission sheet listing every entry in `manifest.permissions`; user must allow to enable.
- Fetch calls are intercepted at the API boundary and rejected if the URL doesn't match the manifest allowlist.
- Plugin errors are caught at the call site, logged to a per-plugin console, and surfaced as a toast — they never crash the app.

## Web Clipper companion (separate repo)

A browser extension that POSTs `{ url, title, html, selection }` to a local Tauri-side endpoint exposed only when Moldavite is running. Moldavite's `clipper-receiver` plugin (built-in or first-party) handles the payload, runs DOMPurify + Turndown, and writes a new note in `notes/Clipped/`.

The extension is its own project; the receiver side lives in this repo as a built-in plugin so the extension has a stable target.

## Implementation order (when we get here)

1. **Plugin host** — loader that reads `<forge>/.plugins/`, validates manifests, dynamically imports `plugin.js`.
2. **Permission sheet UI** + persisted decisions.
3. **Minimal API**: commands + ui.toast only.
4. **Editor + forge API**.
5. **Right-panel slot**.
6. **Fetch with allowlist**.
7. **Settings → Plugins** management UI (enable/disable/uninstall).
8. **Built-in clipper-receiver** + companion extension (separate repo).

## Risks

- **Wide attack surface** if plugins are dropped from the internet. Mitigation: explicit per-plugin enable + permission review.
- **API churn** breaks plugins. Mitigation: version the API, expose `api.app.version` so plugins can guard.
- **Performance**: a buggy plugin can stall the UI thread. Mitigation: long-running handlers must return a Promise; the host applies a soft timeout for command handlers (e.g. 5s) and warns.

## Decision log

- Plugins live in the Forge, not in user config — they travel with the notes when a Forge is moved.
- Per-Forge enable state — so a Work Forge can have different plugins than Personal.
- ESM, not CommonJS — modern, fewer surprises.
- React component slot uses a render-into-DOM-node API rather than exposing React directly, so plugins don't need to import the same React copy.

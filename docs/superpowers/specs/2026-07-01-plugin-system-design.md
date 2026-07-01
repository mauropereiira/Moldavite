# Spec 2 — Plugin System v1 (permissioned-open, commands-first)

**Date:** 2026-07-01
**Status:** Approved (design) — ready for implementation plan
**Author:** Claude (brainstorming session with Mauro)
**Builds on:** `docs/PLUGINS_DESIGN.md` (the v0 sketch this implements and narrows)

## Context

Moldavite's "Plugins" tab is currently promo-only — there is no functional plugin system (`src/components/settings/sections/PluginsSection.tsx` is static; only `docs/PLUGINS_DESIGN.md` describes the intended shape). This spec implements a real, **permissioned-open** plugin system whose v1 lets third parties add **commands**, loaded from the active Forge, with an explicit per-plugin trust prompt.

Decisions already made (with the user):
- **Trust model:** permissioned-open — plugins run real JS with a curated API; a manifest declares capabilities and the user must explicitly enable each plugin behind a permission sheet. Not strict-sandboxed (that was rejected as overkill).
- **v1 capabilities:** commands (command palette + editor slash menu). Everything else in the design doc is deferred to v2.
- **Loading:** a custom **`plugin://` Tauri URI scheme** + a narrow CSP allowance (no `eval`/`unsafe-eval`).
- **Install/manage:** folder-drop into `<forge>/.plugins/` + a real Settings management list (enable/disable, permission sheet, uninstall). No generic folder-picker importer in v1.
- **Example plugin:** ship a first-party example that doubles as documentation.

## Goals

1. Load and run third-party command plugins from the active Forge, safely-by-declaration.
2. Surface plugin commands in the command palette (QuickSwitcher) and the editor slash menu.
3. Give plugins a minimal, versioned `PluginAPI` (commands + minimal editor + toast).
4. Explicit per-plugin, per-Forge enable + permission-grant, persisted.
5. A real Settings → Plugins management UI (replacing the promo).
6. A bundled example plugin + a developer authoring guide.
7. Never let a plugin crash the app.

## Non-goals (deferred to v2, all already in `docs/PLUGINS_DESIGN.md`)

`fetch` + host allowlist; editor/sidebar context-menu items; right-panel widget slots; forge note read/write API; plugin-owned frontmatter keys; `ui.prompt`; per-handler soft timeout; the Web Clipper receiver + companion extension; a plugin marketplace/registry; hot-reload; a generic in-app "install from folder" picker.

---

## Architecture

### 1. Loading & isolation — the `plugin://` scheme

- **Rust** registers a custom URI scheme `plugin` (Tauri v2 `register_uri_scheme_protocol` / async variant) in the app builder. A request for `plugin://localhost/<plugin-id>/<relative-path>` resolves to `<active-forge>/.plugins/<plugin-id>/<relative-path>`:
  - The active Forge root is resolved at request time from the existing Forge state (`commands/forges.rs`).
  - **Reject path traversal**: canonicalize the resolved path and confirm it stays within `<active-forge>/.plugins/<plugin-id>/`; 403/404 otherwise.
  - Serve `.js`/`.mjs` with `Content-Type: text/javascript`; other types by extension; deny anything outside the plugin dir.
- **CSP change** (`src-tauri/tauri.conf.json` `app.security.csp`): add the plugin scheme origin to `script-src` only. Exact origin form to confirm in the spike (Tauri custom schemes are typically `plugin://localhost` on macOS via WKWebView; the value added is whatever the spike proves the webview uses, e.g. `script-src 'self' plugin: http://plugin.localhost`). No other directive is loosened; no `unsafe-eval`.
- **Frontend host** (`src/lib/plugins/host.ts`): for each **enabled + permission-granted** plugin, dynamically `import(\`plugin://localhost/${id}/${entry}\`)`, then call the module's default export `register(api)`. Import + register are wrapped so a failure disables that plugin for the session and toasts, without affecting others or the app.

> **Spike (first task):** prove the webview will `import()` an ES module served over the custom scheme with the right MIME, and pin the exact CSP origin string. The entire system depends on this; validate before building the rest.

### 2. Plugin package format

Per the design doc, in the active Forge:
```
<forge>/.plugins/<plugin-id>/
├── manifest.json
├── plugin.js          # ESM; default-exports register(api)
└── README.md          # optional
```

`manifest.json` (v1 fields):
```json
{
  "id": "moldavite-example",
  "name": "Example Plugin",
  "version": "1.0.0",
  "author": "Moldavite",
  "description": "Insert a timestamp and show a word count.",
  "apiVersion": 1,
  "minAppVersion": "1.4.0",
  "permissions": ["commands", "editor", "ui"]
}
```
- `id` must match the folder name and be a safe slug (`^[a-z0-9][a-z0-9-]*$`).
- `apiVersion` gates compatibility (host exposes `PLUGIN_API_VERSION = 1`; mismatch → not loaded, shown as incompatible).
- `permissions` is an informational capability list for v1 (the API surface is fixed and small); it drives the permission sheet copy. Unknown permission strings are shown but non-fatal.
- Validation lives in one place and is unit-tested (see §Testing). Invalid manifest → plugin listed as "invalid" with the reason, never loaded.

### 3. `PluginAPI` (v1)

```ts
// src/lib/plugins/types.ts
export const PLUGIN_API_VERSION = 1;

export interface PluginCommand {
  id: string;                 // namespaced by host as `${pluginId}:${id}`
  label: string;
  handler: () => void | Promise<void>;
}

export interface PluginAPI {
  app: { version: string; apiVersion: number };
  commands: { add(cmd: PluginCommand): void };
  editor: {
    getActiveNote(): { title: string; content: string } | null;
    insertText(text: string): void;   // at the current cursor
  };
  ui: { toast(message: string, kind?: 'info' | 'success' | 'error'): void };
}
```
- The host constructs a fresh `PluginAPI` per plugin, closing over the plugin id (for command namespacing and error attribution).
- `editor.getActiveNote` reads from the existing note store; `editor.insertText` inserts into the active TipTap editor at the cursor; `ui.toast` uses the existing toast store. Exact wiring determined in the plan by reading `noteStore`, the editor instance access, and `toastStore`.

### 4. Command registry & surfacing

- A **command registry** (`src/stores/pluginCommandStore.ts`, or a plain module with subscribe) holds registered plugin commands: `{ pluginId, id (namespaced), label, handler }`.
- `register(api)` adds commands here. On disable/unload, the plugin's commands are removed.
- **Command palette:** the QuickSwitcher action list reads plugin commands from the registry and shows them (grouped/labeled as plugin commands). Exact integration determined by reading `quickSwitcherStore.ts` + `commands.ts` in the plan.
- **Editor slash menu:** the slash command list merges plugin commands so `/`-typing surfaces them. Exact integration by reading `SlashCommandList.tsx` in the plan. If the slash menu turns out to need disproportionate rework, palette-only is the documented fallback (flagged at plan time, not silently dropped).
- Every handler invocation is wrapped in try/catch → error toast + console; a throwing handler never breaks the palette/editor.

### 5. Permissions & enable state

- **`src/stores/pluginStore.ts`** (Zustand + persist), per-Forge namespaced (mirroring existing per-Forge localStorage namespacing): `enabled: Record<pluginId, { enabled: boolean; grantedVersion: string }>`.
- First enable of a plugin (or a version change from `grantedVersion`) shows a **permission sheet** modal: manifest identity (name, version, author, description) + a plain-language capability summary ("Runs code that can read and modify notes in this Forge and add commands") + the declared `permissions`. User must **Enable** to grant; Cancel leaves it disabled.
- Enabled state is per-Forge (a Work Forge can differ from Personal), consistent with the design doc's decision.
- On app start and on Forge switch, the host re-scans and (re)loads enabled+granted plugins for the active Forge; commands from the previous Forge's plugins are cleared.

### 6. Settings → Plugins UI (replace the promo)

Rewrite `PluginsSection.tsx` into a functional panel:
- Calls `list_plugins()` and renders each detected plugin: name, version, author, description, and status (enabled / disabled / invalid / incompatible).
- **Enable toggle** → triggers the permission sheet on first grant, then loads/unloads live.
- **View permissions** (opens the same sheet read-only).
- **Uninstall** → confirmation → `uninstall_plugin(id)` (deletes the folder), then refresh.
- **"Install example plugin"** button → `install_example_plugin()` copies the bundled example into the active Forge's `.plugins/`, then refresh.
- A short "Build your own" blurb linking to `docs/PLUGINS.md` and the example. Keep the existing external-link helper.

### 7. Example plugin

- Source lives in the repo at `examples/plugins/moldavite-example/` (`manifest.json`, `plugin.js`, `README.md`) — readable reference for authors.
- Bundled as a Tauri resource so `install_example_plugin()` can copy it into the active Forge.
- Behavior: registers two commands — "Insert timestamp" (`editor.insertText(new Date ISO)`) and "Word count" (`ui.toast` with the active note's word count from `editor.getActiveNote`).

### 8. Backend commands (Rust, `src-tauri/src/commands/plugins.rs`)

- `list_plugins() -> Vec<PluginInfo>` — scan `<active-forge>/.plugins/*/manifest.json`, parse + validate, return metadata + validity/reason. Never errors on one bad plugin.
- `uninstall_plugin(id: String)` — validate id, delete `<active-forge>/.plugins/<id>` (guard against traversal).
- `install_example_plugin()` — copy the bundled example resource into `<active-forge>/.plugins/moldavite-example/` (idempotent; refuse to overwrite a user-modified copy without confirmation from the UI).
- The `plugin://` scheme handler (registered in `lib.rs` builder setup).
- Register new commands in `lib.rs` `generate_handler!`.

### 9. Error isolation

- Manifest parse errors, import failures, `register()` throws, and handler throws are each caught. Result: a toast, a console line tagged `[plugin:<id>]`, and that plugin marked failed for the session. The app and other plugins continue.

### 10. Documentation

- New `docs/PLUGINS.md` — author guide: package layout, manifest reference, full `PluginAPI` v1 reference, the example walkthrough, how to install (folder-drop + example button), the permission/trust model, versioning (`apiVersion`), and the v2 roadmap (what's coming). 
- Update `docs/PLUGINS_DESIGN.md` header to "v1 implemented — see PLUGINS.md" and keep it as the rationale/decision log.
- `CHANGELOG.md`: a `## [Unreleased]` (or next-version) section describing the plugin system. Update `README.md` "What You Get" with a one-line plugins mention. Update `PROJECT_STATUS.md`.

---

## Data flow (happy path)

1. App start / Forge switch → host calls `list_plugins()`.
2. For each plugin that is enabled + granted (from `pluginStore`, current Forge) and compatible (`apiVersion`) → `import("plugin://localhost/<id>/plugin.js")` → `register(api)`.
3. `register` calls `api.commands.add(...)` → entries land in the command registry (namespaced `id`).
4. User opens the command palette or types `/` → plugin commands appear → selecting one runs `handler()` (wrapped) → handler calls `editor.insertText` / `ui.toast` / reads `getActiveNote`.
5. Disable/uninstall/Forge-switch → the plugin's commands are removed from the registry.

## Security posture

- Only the `plugin://` scheme is added to `script-src`; no `unsafe-eval`; the scheme only serves files inside the active Forge's `.plugins/`, traversal-guarded.
- Plugins are **not** hardened-sandboxed (permissioned-open, by choice): a granted plugin runs with the same powers as app code. The controls are: explicit per-plugin enable, a permission sheet at grant time, per-Forge scoping, and version-change re-prompts. This is documented plainly in `docs/PLUGINS.md` so users understand the trust they extend ("if they break it it's their fault" — and a malicious plugin they enable can touch their notes).
- `apiVersion` lets us evolve the API without silently breaking or mis-running old plugins.

## Testing

- **Unit (Vitest):**
  - Manifest validation: valid, bad id, missing fields, `apiVersion` mismatch, unknown permissions (non-fatal), id≠folder.
  - Command registry: add/remove, namespacing, remove-by-plugin on unload.
  - Permission/enable logic: first-enable requires grant; version change re-prompts; per-Forge isolation.
  - `PluginAPI` construction: command namespacing, handler try/catch, toast/editor calls dispatched to the right stores (with mocked stores).
- **Rust:** unit-test manifest parsing/validation and the path-traversal guard for the scheme + uninstall.
- **Manual / smoke:** install the example plugin → both commands appear in palette and slash menu → run each → timestamp inserted, word-count toast shown; disable → commands vanish; uninstall → removed; toggle Forge → plugin scoped correctly; a deliberately-throwing plugin only toasts.

## Risks & mitigations

- **`plugin://` module import may not work / wrong MIME / CSP origin** → the first task is a spike that proves it end-to-end before anything else is built.
- **Wide attack surface** (a malicious dropped plugin) → explicit enable + permission sheet + plain-language docs; per-Forge scope.
- **API churn breaks plugins** → `apiVersion` gate + `api.app.apiVersion`.
- **Buggy plugin stalls UI** → try/catch everywhere; per-handler timeout deferred to v2 but noted.
- **Forge-switch races** (loading old-Forge plugins) → clear registry + reload on switch, keyed to the active Forge.

## Implementation order (suggested)

1. **Spike:** `plugin://` scheme + CSP + prove `import()` of an ESM module over it (throwaway/minimal, then harden).
2. Types + manifest validation (+ tests).
3. Backend: `list_plugins`, `uninstall_plugin`, `install_example_plugin`, scheme handler.
4. Command registry + `PluginAPI` construction (+ tests).
5. Host loader (scan → import → register → error isolation), wired to app start + Forge switch.
6. Surface commands in the command palette; then the slash menu.
7. `pluginStore` + permission sheet modal.
8. Settings → Plugins UI (list/enable/disable/permissions/uninstall/install-example).
9. Example plugin (repo source + bundled resource).
10. Docs (`PLUGINS.md`, update `PLUGINS_DESIGN.md`, CHANGELOG/README/PROJECT_STATUS).

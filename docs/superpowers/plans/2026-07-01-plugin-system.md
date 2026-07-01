# Plugin System v1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A permissioned-open plugin system whose v1 lets third-party plugins register commands (surfaced in the command palette + editor slash menu), loaded as ESM from the active Forge over a custom `plugin://` scheme, behind a per-plugin permission sheet — plus a bundled example and an author guide.

**Architecture:** Rust registers a `plugin://` URI scheme serving files from `<active-forge>/.plugins/<id>/` (traversal-guarded, `Content-Type: text/javascript`). The frontend host dynamically `import()`s each enabled+granted plugin's `plugin.js` and calls `register(api)` with a curated `PluginAPI` (commands + minimal editor + toast). Commands land in a registry that the QuickSwitcher and slash menu read. Enable/permission state is per-Forge persisted. No `eval`/`unsafe-eval`.

**Tech Stack:** Tauri v2 (`register_uri_scheme_protocol`, `http::Response`, `paths::get_notes_dir`, `BaseDirectory::Resource`), Rust; React 19 + TypeScript + Zustand (+ persist/`namespacedKey`), Vite 7, Vitest 4 + @testing-library/react, TipTap.

## Global Constraints

- **Loader mechanism:** custom `plugin://` scheme only; CSP `script-src` gains exactly `plugin://localhost http://plugin.localhost` (macOS uses `plugin://localhost`; the `http://plugin.localhost` form covers Windows/Android). No other CSP directive is loosened; never add `unsafe-eval`.
- **Scheme handler** returns `http::Response<Vec<u8>>` directly (NOT `Result`); errors = status ≥ 400. Success response MUST set `Content-Type: text/javascript` for `.js`/`.mjs` and `Access-Control-Allow-Origin: *`. Serve only files inside `paths::get_notes_dir().join(".plugins")`, validated with `crate::validation::validate_path_within_base`.
- **Plugin location:** `<active-forge>/.plugins/<id>/` (`paths::get_notes_dir()` is the active Forge root). Per-Forge enable state via `namespacedKey` (`src/lib/forgeStorage.ts`).
- **API version:** `PLUGIN_API_VERSION = 1`. Manifest `apiVersion` must equal it or the plugin is "incompatible" (listed, not loaded). Manifest `id` must match its folder and match `^[a-z0-9][a-z0-9-]*$`.
- **Command id namespacing:** the host rewrites each plugin command id to `${pluginId}:${cmd.id}`.
- **Toast kinds:** the toast store supports only `'success' | 'error'`. The plugin API accepts `'info' | 'success' | 'error'` and maps `'info' → 'success'`.
- **Forge switch is a full `window.location.reload()`** — no live switch listener needed; startup effects re-run against the new Forge.
- **Error isolation:** manifest parse, `import()`, `register()`, and every handler call are wrapped; failure → toast + `console.error('[plugin:<id>]', …)`, that plugin marked failed, app + other plugins unaffected. Never crash the app.
- Commit footer on every commit: `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.
- Tests colocate as `*.test.ts(x)`; Vitest `globals: true` but import `describe/it/expect` explicitly (repo style). Lint `eslint . --ext ts,tsx`; escape apostrophes in JSX text. Rust must pass `cargo clippy --lib --all-targets -- -D warnings` and `cargo test --lib` in `src-tauri`.

---

## File Structure

**Create (frontend):**
- `src/lib/plugins/types.ts` — `PLUGIN_API_VERSION`, `PluginManifest`, `PluginInfo`, `PluginCommand`, `PluginAPI`, `LoadedPlugin`.
- `src/lib/plugins/manifest.ts` + `manifest.test.ts` — pure manifest validation.
- `src/lib/plugins/api.ts` + `api.test.ts` — build a `PluginAPI` for a plugin id (commands + editor + toast), with error isolation.
- `src/lib/plugins/host.ts` — scan → import → register → unload; the orchestrator.
- `src/hooks/usePluginHost.ts` — startup hook that runs the host for the active Forge.
- `src/stores/pluginCommandStore.ts` + `.test.ts` — registry of live plugin commands (+ execute).
- `src/stores/pluginStore.ts` + `.test.ts` — per-Forge enable + permission-grant state.
- `src/stores/editorHandleStore.ts` — a module ref exposing the live TipTap editor for `editor.insertText`.
- `src/components/plugins/PluginPermissionSheet.tsx` — the grant modal.

**Modify (frontend):**
- `src/components/editor/Editor.tsx` — publish the editor instance to `editorHandleStore`; merge plugin slash commands into the slash `items` callback.
- `src/components/editor/extensions/SlashCommandList.tsx` — export a helper to build a `SlashCommandItem` from a plugin command (fallback `Puzzle` icon).
- `src/components/quick-switcher/QuickSwitcher.tsx` — merge plugin commands into the palette list + deps; dynamic dispatch + icon fallback for plugin ids.
- `src/components/quick-switcher/commands.ts` — (only if needed) allow the plugin category label.
- `src/components/settings/sections/PluginsSection.tsx` — replace promo body with the management UI.
- `src/stores/index.ts` — export the new stores.
- `src/hooks/index.ts` — export `usePluginHost`.
- `src/App.tsx` — call `usePluginHost()`.
- `src-tauri/tauri.conf.json` — CSP `script-src` + `bundle.resources`.

**Create (backend):**
- `src-tauri/src/commands/plugins.rs` — `list_plugins`, `uninstall_plugin`, `install_example_plugin` (+ Rust unit tests for validation/traversal).

**Modify (backend):**
- `src-tauri/src/commands/mod.rs` — `pub mod plugins;`
- `src-tauri/src/lib.rs` — register the `plugin://` scheme; add the three commands to `generate_handler!` + `use`.

**Create (example + docs):**
- `src-tauri/example-plugin/moldavite-example/{manifest.json,plugin.js,README.md}` — bundled resource + author reference.
- `docs/PLUGINS.md` — author guide.
- Update `docs/PLUGINS_DESIGN.md`, `CHANGELOG.md`, `README.md`, `docs/PROJECT_STATUS.md`.

---

## Task 1: `plugin://` scheme + CSP + resources (the spike, made real)

**Files:**
- Modify: `src-tauri/src/commands/mod.rs`, `src-tauri/src/lib.rs`, `src-tauri/tauri.conf.json`
- Create: `src-tauri/src/commands/plugins.rs` (scheme helper + a stub `list_plugins` returning `[]` for now; real body in Task 3)

**Interfaces:**
- Produces: a registered `plugin` URI scheme resolving `plugin://localhost/<id>/<file>` → `<forge>/.plugins/<id>/<file>`; `resolve_plugin_file(id, rel) -> Result<PathBuf,()>` (traversal-guarded) reused by the handler.

- [ ] **Step 1: Add the CSP + resources config.** In `src-tauri/tauri.conf.json`, change `script-src 'self'` to `script-src 'self' plugin://localhost http://plugin.localhost` inside the `csp` string, and add to `bundle`: `"resources": ["example-plugin/**"]`.

- [ ] **Step 2: Create `src-tauri/src/commands/plugins.rs`** with the path resolver + a temporary stub command:
```rust
use std::path::PathBuf;
use crate::paths::get_notes_dir;
use crate::validation::validate_path_within_base;

/// Absolute path to the active Forge's `.plugins` dir.
pub(crate) fn plugins_dir() -> PathBuf {
    get_notes_dir().join(".plugins")
}

/// Resolve `<plugins_dir>/<id>/<rel>` and confirm it stays inside `.plugins`.
/// Returns None on any traversal / invalid id / escape.
pub(crate) fn resolve_plugin_file(id: &str, rel: &str) -> Option<PathBuf> {
    if !is_valid_plugin_id(id) {
        return None;
    }
    let base = plugins_dir();
    let candidate = base.join(id).join(rel);
    match validate_path_within_base(&candidate, &base) {
        Ok(p) if p.is_file() => Some(p),
        _ => None,
    }
}

pub(crate) fn is_valid_plugin_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 64
        && id
            .chars()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
        && id.chars().next().map(|c| c != '-').unwrap_or(false)
}

#[tauri::command]
pub(crate) fn list_plugins() -> Result<Vec<serde_json::Value>, String> {
    // Real implementation in Task 3.
    Ok(Vec::new())
}
```
(If `validate_path_within_base` has a different exact signature, adapt — it canonicalizes and rejects escape per the integration report; confirm by reading `src-tauri/src/validation.rs`.)

- [ ] **Step 3: Register the module.** In `src-tauri/src/commands/mod.rs` add `pub mod plugins;`.

- [ ] **Step 4: Register the scheme + command in `lib.rs`.** Add `use crate::commands::plugins::{list_plugins};` near the other command `use`s. In the `tauri::Builder` chain (after the `.plugin(...)` calls, before `.setup`), add:
```rust
        .register_uri_scheme_protocol("plugin", |_ctx, request| {
            use tauri::http::{header, Response, StatusCode};
            // request.uri() = plugin://localhost/<id>/<rel...>
            let full = request.uri().path(); // "/<id>/<rel...>"
            let trimmed = full.trim_start_matches('/');
            let mut parts = trimmed.splitn(2, '/');
            let id = parts.next().unwrap_or("");
            let rel = parts.next().unwrap_or("");
            let not_found = || {
                Response::builder()
                    .status(StatusCode::NOT_FOUND)
                    .header(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*")
                    .body(Vec::new())
                    .unwrap()
            };
            match crate::commands::plugins::resolve_plugin_file(id, rel) {
                Some(path) => match std::fs::read(&path) {
                    Ok(bytes) => {
                        let ct = if path.extension().map(|e| e == "js" || e == "mjs").unwrap_or(false) {
                            "text/javascript"
                        } else if path.extension().map(|e| e == "json").unwrap_or(false) {
                            "application/json"
                        } else {
                            "application/octet-stream"
                        };
                        Response::builder()
                            .header(header::CONTENT_TYPE, ct)
                            .header(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*")
                            .body(bytes)
                            .unwrap()
                    }
                    Err(_) => not_found(),
                },
                None => not_found(),
            }
        })
```
Add `list_plugins` to the `tauri::generate_handler![…]` list.

- [ ] **Step 5: Compile.** Run: `cd src-tauri && cargo build --lib 2>&1 | tail -20`
Expected: builds clean (fix signature mismatches against the real `tauri::http` / `validation` API if any).

- [ ] **Step 6: Commit.**
```bash
git add src-tauri/src/commands/plugins.rs src-tauri/src/commands/mod.rs src-tauri/src/lib.rs src-tauri/tauri.conf.json
git commit -m "feat(plugins): register plugin:// scheme + CSP/resource config

Serve <forge>/.plugins/<id>/<file> over a custom plugin:// URI scheme
(traversal-guarded, text/javascript + CORS), add plugin://localhost to CSP
script-src, and declare the example-plugin bundle resource. list_plugins is
a stub for now.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

- [ ] **Step 7: MANUAL VERIFICATION GATE (needs the running app).** This cannot be verified headlessly. In a dev run (`npm run tauri dev`), with a throwaway `~/Documents/Moldavite/Default/.plugins/probe/plugin.js` containing `export default (api)=>console.log('probe loaded')`, run in devtools: `await import('plugin://localhost/probe/plugin.js')` and confirm it resolves and logs. If the webview rejects it, iterate on MIME/CORS/CSP origin (`http://plugin.localhost` vs `plugin://localhost`) before building the rest. **Record the result before proceeding past Task 6.**

---

## Task 2: Plugin types + manifest validation

**Files:**
- Create: `src/lib/plugins/types.ts`, `src/lib/plugins/manifest.ts`, `src/lib/plugins/manifest.test.ts`

**Interfaces:**
- Produces:
  - `PLUGIN_API_VERSION = 1`
  - `PluginManifest { id; name; version; author?; description?; apiVersion: number; minAppVersion?: string; permissions?: string[] }`
  - `PluginInfo` (manifest + `status: 'ok'|'invalid'|'incompatible'` + `reason?: string`)
  - `PluginCommand`, `PluginAPI`, `LoadedPlugin` (types only, consumed later)
  - `validateManifest(raw: unknown, folderId: string): { ok: true; manifest: PluginManifest } | { ok: false; reason: string }`

- [ ] **Step 1: Write `types.ts`:**
```ts
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
```

- [ ] **Step 2: Write the failing test `manifest.test.ts`:**
```ts
import { describe, it, expect } from 'vitest';
import { validateManifest } from './manifest';

const base = { id: 'demo', name: 'Demo', version: '1.0.0', apiVersion: 1 };

describe('validateManifest', () => {
  it('accepts a valid manifest whose id matches the folder', () => {
    const r = validateManifest(base, 'demo');
    expect(r.ok).toBe(true);
  });
  it('rejects when id does not match the folder', () => {
    const r = validateManifest(base, 'other');
    expect(r).toEqual({ ok: false, reason: expect.stringContaining('folder') });
  });
  it('rejects a bad id slug', () => {
    expect(validateManifest({ ...base, id: 'Bad_Id' }, 'Bad_Id').ok).toBe(false);
  });
  it('rejects missing required fields', () => {
    expect(validateManifest({ id: 'demo' }, 'demo').ok).toBe(false);
  });
  it('flags apiVersion mismatch distinctly', () => {
    const r = validateManifest({ ...base, apiVersion: 2 }, 'demo');
    expect(r).toEqual({ ok: false, reason: expect.stringContaining('apiVersion') });
  });
  it('rejects non-object input', () => {
    expect(validateManifest(null, 'demo').ok).toBe(false);
    expect(validateManifest('x', 'demo').ok).toBe(false);
  });
});
```

- [ ] **Step 3: Run → fails** (`npm test -- src/lib/plugins/manifest.test.ts`). Expected: module not found.

- [ ] **Step 4: Implement `manifest.ts`:**
```ts
import { PLUGIN_API_VERSION, type PluginManifest } from './types';

const ID_RE = /^[a-z0-9][a-z0-9-]*$/;

type Result =
  | { ok: true; manifest: PluginManifest }
  | { ok: false; reason: string };

export function validateManifest(raw: unknown, folderId: string): Result {
  if (typeof raw !== 'object' || raw === null) {
    return { ok: false, reason: 'manifest.json is not an object' };
  }
  const m = raw as Record<string, unknown>;
  const str = (k: string) => (typeof m[k] === 'string' ? (m[k] as string) : undefined);

  const id = str('id');
  const name = str('name');
  const version = str('version');
  const apiVersion = typeof m.apiVersion === 'number' ? m.apiVersion : undefined;

  if (!id || !name || !version || apiVersion === undefined) {
    return { ok: false, reason: 'missing required fields (id, name, version, apiVersion)' };
  }
  if (!ID_RE.test(id)) {
    return { ok: false, reason: `invalid id "${id}" (use lowercase letters, digits, hyphens)` };
  }
  if (id !== folderId) {
    return { ok: false, reason: `id "${id}" does not match folder "${folderId}"` };
  }
  if (apiVersion !== PLUGIN_API_VERSION) {
    return {
      ok: false,
      reason: `apiVersion ${apiVersion} is incompatible (this app supports ${PLUGIN_API_VERSION})`,
    };
  }
  const permissions = Array.isArray(m.permissions)
    ? (m.permissions.filter((p) => typeof p === 'string') as string[])
    : undefined;

  return {
    ok: true,
    manifest: {
      id,
      name,
      version,
      apiVersion,
      author: str('author'),
      description: str('description'),
      minAppVersion: str('minAppVersion'),
      permissions,
    },
  };
}
```

- [ ] **Step 5: Run → passes.** Commit.
```bash
git add src/lib/plugins/types.ts src/lib/plugins/manifest.ts src/lib/plugins/manifest.test.ts
git commit -m "feat(plugins): plugin types + manifest validation

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: Backend commands (list / uninstall / install-example)

**Files:**
- Modify: `src-tauri/src/commands/plugins.rs` (replace the stub), `src-tauri/src/lib.rs` (add the two commands)

**Interfaces:**
- Produces (Tauri commands): `list_plugins() -> Result<Vec<PluginInfoDto>, String>`, `uninstall_plugin(id: String) -> Result<(), String>`, `install_example_plugin() -> Result<(), String>`. `PluginInfoDto` serializes `{ manifest: {...raw fields...}, status, reason }` — the frontend re-validates for the authoritative status, so backend `list_plugins` may return raw manifest JSON + folder id and let the frontend classify. **Chosen: backend returns `{ id (folder), manifestRaw: Value|null, readError: String|null }[]`; the frontend calls `validateManifest`.** This keeps validation logic in one (tested) place.

- [ ] **Step 1: Replace `plugins.rs` command bodies.** Keep `plugins_dir`, `resolve_plugin_file`, `is_valid_plugin_id`. Replace `list_plugins` and add the others:
```rust
use serde::Serialize;
use std::fs;

#[derive(Serialize)]
pub(crate) struct RawPlugin {
    pub id: String,
    #[serde(rename = "manifestRaw")]
    pub manifest_raw: Option<serde_json::Value>,
    #[serde(rename = "readError")]
    pub read_error: Option<String>,
}

#[tauri::command]
pub(crate) fn list_plugins() -> Result<Vec<RawPlugin>, String> {
    let dir = plugins_dir();
    let mut out = Vec::new();
    let entries = match fs::read_dir(&dir) {
        Ok(e) => e,
        Err(_) => return Ok(out), // no .plugins dir yet
    };
    for entry in entries.flatten() {
        if !entry.path().is_dir() {
            continue;
        }
        let id = entry.file_name().to_string_lossy().to_string();
        if !is_valid_plugin_id(&id) {
            continue;
        }
        let manifest_path = entry.path().join("manifest.json");
        match fs::read_to_string(&manifest_path) {
            Ok(text) => match serde_json::from_str::<serde_json::Value>(&text) {
                Ok(v) => out.push(RawPlugin { id, manifest_raw: Some(v), read_error: None }),
                Err(e) => out.push(RawPlugin { id, manifest_raw: None, read_error: Some(format!("invalid manifest.json: {e}")) }),
            },
            Err(e) => out.push(RawPlugin { id, manifest_raw: None, read_error: Some(format!("no manifest.json: {e}")) }),
        }
    }
    out.sort_by(|a, b| a.id.cmp(&b.id));
    Ok(out)
}

#[tauri::command]
pub(crate) fn uninstall_plugin(id: String) -> Result<(), String> {
    if !is_valid_plugin_id(&id) {
        return Err("invalid plugin id".into());
    }
    let base = plugins_dir();
    let target = base.join(&id);
    // Guard: confirm target resolves within base before deleting.
    crate::validation::validate_path_within_base(&target, &base)
        .map_err(|_| "refusing to delete outside the plugins directory".to_string())?;
    if target.is_dir() {
        fs::remove_dir_all(&target).map_err(|e| format!("failed to uninstall: {e}"))?;
    }
    Ok(())
}

#[tauri::command]
pub(crate) fn install_example_plugin(app: tauri::AppHandle) -> Result<(), String> {
    use tauri::Manager;
    let src = app
        .path()
        .resolve("example-plugin/moldavite-example", tauri::path::BaseDirectory::Resource)
        .map_err(|e| format!("cannot locate bundled example: {e}"))?;
    let dest = plugins_dir().join("moldavite-example");
    if dest.exists() {
        return Err("moldavite-example is already installed".into());
    }
    fs::create_dir_all(&dest).map_err(|e| format!("cannot create plugin dir: {e}"))?;
    for name in ["manifest.json", "plugin.js", "README.md"] {
        let from = src.join(name);
        if from.is_file() {
            fs::copy(&from, dest.join(name)).map_err(|e| format!("copy {name} failed: {e}"))?;
        }
    }
    Ok(())
}
```
(Confirm `validate_path_within_base`'s real signature/return; adapt the `.map_err` accordingly.)

- [ ] **Step 2: Add a Rust test** at the bottom of `plugins.rs`:
```rust
#[cfg(test)]
mod tests {
    use super::is_valid_plugin_id;
    #[test]
    fn valid_ids() {
        assert!(is_valid_plugin_id("moldavite-example"));
        assert!(is_valid_plugin_id("abc123"));
    }
    #[test]
    fn invalid_ids() {
        assert!(!is_valid_plugin_id(""));
        assert!(!is_valid_plugin_id("-lead"));
        assert!(!is_valid_plugin_id("Upper"));
        assert!(!is_valid_plugin_id("has space"));
        assert!(!is_valid_plugin_id("../etc"));
    }
}
```

- [ ] **Step 3: Wire commands in `lib.rs`** — extend the `use` to `use crate::commands::plugins::{list_plugins, uninstall_plugin, install_example_plugin};` and add all three to `generate_handler!`.

- [ ] **Step 4: Verify.** Run: `cd src-tauri && cargo test --lib plugins 2>&1 | tail -15 && cargo clippy --lib -- -D warnings 2>&1 | tail -15`
Expected: tests pass, clippy clean.

- [ ] **Step 5: Commit.**
```bash
git add src-tauri/src/commands/plugins.rs src-tauri/src/lib.rs
git commit -m "feat(plugins): list/uninstall/install-example backend commands

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: Command registry store

**Files:** Create `src/stores/pluginCommandStore.ts` + `.test.ts`; modify `src/stores/index.ts`.

**Interfaces:**
- Produces `usePluginCommandStore` with state `commands: { pluginId: string; id: string; label: string; handler: () => void|Promise<void> }[]` and actions `addCommand(entry)`, `removeByPlugin(pluginId)`, `clear()`, `execute(id): Promise<void>` (runs the matching handler wrapped in try/catch → toast on throw).

- [ ] **Step 1: Failing test `pluginCommandStore.test.ts`:**
```ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { usePluginCommandStore } from './pluginCommandStore';

vi.mock('./toastStore', () => ({
  useToastStore: { getState: () => ({ addToast: vi.fn() }) },
}));

describe('pluginCommandStore', () => {
  beforeEach(() => usePluginCommandStore.getState().clear());

  it('adds and lists commands', () => {
    usePluginCommandStore.getState().addCommand({ pluginId: 'p', id: 'p:a', label: 'A', handler: () => {} });
    expect(usePluginCommandStore.getState().commands).toHaveLength(1);
  });
  it('removes all commands for a plugin', () => {
    const s = usePluginCommandStore.getState();
    s.addCommand({ pluginId: 'p', id: 'p:a', label: 'A', handler: () => {} });
    s.addCommand({ pluginId: 'q', id: 'q:b', label: 'B', handler: () => {} });
    s.removeByPlugin('p');
    expect(usePluginCommandStore.getState().commands.map((c) => c.id)).toEqual(['q:b']);
  });
  it('execute runs the matching handler', async () => {
    const spy = vi.fn();
    usePluginCommandStore.getState().addCommand({ pluginId: 'p', id: 'p:a', label: 'A', handler: spy });
    await usePluginCommandStore.getState().execute('p:a');
    expect(spy).toHaveBeenCalledOnce();
  });
  it('execute swallows handler errors', async () => {
    usePluginCommandStore.getState().addCommand({
      pluginId: 'p', id: 'p:boom', label: 'Boom', handler: () => { throw new Error('x'); },
    });
    await expect(usePluginCommandStore.getState().execute('p:boom')).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 2: Run → fails.**

- [ ] **Step 3: Implement `pluginCommandStore.ts`:**
```ts
import { create } from 'zustand';
import { useToastStore } from './toastStore';

export interface PluginCommandEntry {
  pluginId: string;
  id: string; // already namespaced `${pluginId}:${localId}`
  label: string;
  handler: () => void | Promise<void>;
}

interface PluginCommandState {
  commands: PluginCommandEntry[];
  addCommand: (entry: PluginCommandEntry) => void;
  removeByPlugin: (pluginId: string) => void;
  clear: () => void;
  execute: (id: string) => Promise<void>;
}

export const usePluginCommandStore = create<PluginCommandState>((set, get) => ({
  commands: [],
  addCommand: (entry) =>
    set((s) => ({ commands: [...s.commands.filter((c) => c.id !== entry.id), entry] })),
  removeByPlugin: (pluginId) =>
    set((s) => ({ commands: s.commands.filter((c) => c.pluginId !== pluginId) })),
  clear: () => set({ commands: [] }),
  execute: async (id) => {
    const cmd = get().commands.find((c) => c.id === id);
    if (!cmd) return;
    try {
      await cmd.handler();
    } catch (err) {
      console.error(`[plugin:${cmd.pluginId}] command "${id}" failed:`, err);
      useToastStore.getState().addToast('error', `Plugin command failed: ${cmd.label}`);
    }
  },
}));
```

- [ ] **Step 4: Run → passes.** Export from `src/stores/index.ts`: `export { usePluginCommandStore } from './pluginCommandStore';` (+ doc line). Commit.
```bash
git add src/stores/pluginCommandStore.ts src/stores/pluginCommandStore.test.ts src/stores/index.ts
git commit -m "feat(plugins): plugin command registry store

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 5: Editor handle + `PluginAPI` construction

**Files:** Create `src/stores/editorHandleStore.ts`, `src/lib/plugins/api.ts`, `src/lib/plugins/api.test.ts`; modify `src/components/editor/Editor.tsx`, `src/stores/index.ts`.

**Interfaces:**
- Produces:
  - `editorHandleStore`: `setEditor(editor: Editor | null)`, `insertTextAtCursor(text): boolean` (returns false if no live editor).
  - `buildPluginAPI(pluginId: string): PluginAPI` — commands route to `usePluginCommandStore` (namespacing local ids to `${pluginId}:${id}`), `editor` routes to `editorHandleStore` + `useNoteStore`, `ui.toast` maps `info→success` to `useToastStore`.

- [ ] **Step 1: `editorHandleStore.ts`** (plain module ref, not persisted):
```ts
import type { Editor } from '@tiptap/react';

let current: Editor | null = null;

export const editorHandle = {
  setEditor(editor: Editor | null) {
    current = editor;
  },
  getEditor(): Editor | null {
    return current && !current.isDestroyed ? current : null;
  },
  insertTextAtCursor(text: string): boolean {
    const ed = current && !current.isDestroyed ? current : null;
    if (!ed) return false;
    ed.chain().focus().insertContent(text).run();
    return true;
  },
};
```

- [ ] **Step 2: Publish the editor in `Editor.tsx`.** After `const editor = useEditor(...)` (line ~234), add an effect:
```tsx
  useEffect(() => {
    editorHandle.setEditor(editor);
    return () => editorHandle.setEditor(null);
  }, [editor]);
```
and `import { editorHandle } from '@/stores/editorHandleStore';`.

- [ ] **Step 3: Failing test `api.test.ts`:**
```ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { buildPluginAPI } from './api';
import { usePluginCommandStore } from '@/stores/pluginCommandStore';

const addToast = vi.fn();
vi.mock('@/stores/toastStore', () => ({ useToastStore: { getState: () => ({ addToast }) } }));
vi.mock('@/stores/noteStore', () => ({
  useNoteStore: { getState: () => ({ currentNote: { title: 'N', content: '<p>hi there</p>' } }) },
}));
const insertTextAtCursor = vi.fn(() => true);
vi.mock('@/stores/editorHandleStore', () => ({ editorHandle: { insertTextAtCursor: (t: string) => insertTextAtCursor(t) } }));

describe('buildPluginAPI', () => {
  beforeEach(() => { usePluginCommandStore.getState().clear(); addToast.mockClear(); insertTextAtCursor.mockClear(); });

  it('namespaces command ids by plugin', () => {
    const api = buildPluginAPI('demo');
    api.commands.add({ id: 'insert', label: 'Insert', handler: () => {} });
    expect(usePluginCommandStore.getState().commands[0].id).toBe('demo:insert');
  });
  it('exposes version + apiVersion', () => {
    const api = buildPluginAPI('demo');
    expect(api.app.apiVersion).toBe(1);
    expect(typeof api.app.version).toBe('string');
  });
  it('getActiveNote returns title + content', () => {
    expect(buildPluginAPI('demo').editor.getActiveNote()).toEqual({ title: 'N', content: '<p>hi there</p>' });
  });
  it('insertText routes to the editor handle', () => {
    buildPluginAPI('demo').editor.insertText('x');
    expect(insertTextAtCursor).toHaveBeenCalledWith('x');
  });
  it('toast maps info to success', () => {
    buildPluginAPI('demo').ui.toast('hey', 'info');
    expect(addToast).toHaveBeenCalledWith('success', 'hey');
  });
});
```

- [ ] **Step 4: Run → fails.**

- [ ] **Step 5: Implement `api.ts`:**
```ts
import { PLUGIN_API_VERSION, type PluginAPI } from './types';
import { usePluginCommandStore } from '@/stores/pluginCommandStore';
import { useToastStore } from '@/stores/toastStore';
import { useNoteStore } from '@/stores/noteStore';
import { editorHandle } from '@/stores/editorHandleStore';

// App version is read lazily to avoid a hard dependency in tests.
let appVersion = '0.0.0';
export function setPluginAppVersion(v: string) {
  appVersion = v;
}

export function buildPluginAPI(pluginId: string): PluginAPI {
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
        const note = useNoteStore.getState().currentNote;
        return note ? { title: note.title, content: note.content } : null;
      },
      insertText(text) {
        const ok = editorHandle.insertTextAtCursor(text);
        if (!ok) useToastStore.getState().addToast('error', 'No active editor to insert into');
      },
    },
    ui: {
      toast(message, kind = 'info') {
        useToastStore.getState().addToast(kind === 'error' ? 'error' : 'success', message);
      },
    },
  };
}
```
(Confirm `noteStore`'s `currentNote` exposes `.title`; the integration report says title comes from the note object via `getNoteTitle`. If `note.title` isn't a direct field, use the `getNoteTitle(note)` helper here instead — adjust the test's mock accordingly.)

- [ ] **Step 6: Run → passes.** Export `editorHandle`/`setPluginAppVersion` as needed via `src/stores/index.ts` (editorHandleStore) — or import directly. Commit.
```bash
git add src/stores/editorHandleStore.ts src/lib/plugins/api.ts src/lib/plugins/api.test.ts src/components/editor/Editor.tsx src/stores/index.ts
git commit -m "feat(plugins): editor handle + PluginAPI construction

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 6: Host loader + startup wiring

**Files:** Create `src/lib/plugins/host.ts`, `src/hooks/usePluginHost.ts`; modify `src/hooks/index.ts`, `src/App.tsx`.

**Interfaces:**
- Consumes: `list_plugins` (IPC via `safeInvoke`), `validateManifest`, `buildPluginAPI`, `usePluginStore` (Task 7 — enable/grant checks), `usePluginCommandStore`.
- Produces: `loadEnabledPlugins(): Promise<PluginInfo[]>` (scans, imports+registers enabled+granted+compatible plugins, returns the full classified list for the UI), `unloadPlugin(id)`; `usePluginHost()` runs `loadEnabledPlugins` once on mount + sets app version.

> **Dependency note:** Task 6 references `usePluginStore` from Task 7. Implement Task 7 first if executing strictly in order, or stub the enable check as `() => true` here and tighten it in Task 7. **Recommended: reorder — do Task 7 before Task 6.** (This plan lists them in narrative order; the executor may swap 6↔7.)

- [ ] **Step 1: Implement `host.ts`:**
```ts
import { safeInvoke } from '@/lib/ipc';
import { getVersion } from '@tauri-apps/api/app';
import { validateManifest } from './manifest';
import { buildPluginAPI, setPluginAppVersion } from './api';
import type { PluginInfo } from './types';
import { PLUGIN_API_VERSION } from './types';
import { usePluginStore } from '@/stores/pluginStore';
import { usePluginCommandStore } from '@/stores/pluginCommandStore';

interface RawPlugin {
  id: string;
  manifestRaw: unknown | null;
  readError: string | null;
}

function classify(raw: RawPlugin): PluginInfo {
  if (raw.readError || raw.manifestRaw == null) {
    return {
      manifest: { id: raw.id, name: raw.id, version: '?', apiVersion: 0 },
      status: 'invalid',
      reason: raw.readError ?? 'missing manifest',
    };
  }
  const v = validateManifest(raw.manifestRaw, raw.id);
  if (!v.ok) {
    const incompatible = v.reason.includes('apiVersion');
    return {
      manifest: { id: raw.id, name: raw.id, version: '?', apiVersion: 0 },
      status: incompatible ? 'incompatible' : 'invalid',
      reason: v.reason,
    };
  }
  return { manifest: v.manifest, status: 'ok' };
}

async function loadOne(info: PluginInfo): Promise<void> {
  const { id } = info.manifest;
  try {
    const mod = await import(/* @vite-ignore */ `plugin://localhost/${id}/plugin.js`);
    const register = mod?.default;
    if (typeof register !== 'function') throw new Error('plugin.js has no default export function');
    await register(buildPluginAPI(id));
  } catch (err) {
    console.error(`[plugin:${id}] failed to load:`, err);
    // surfaced via toast by the caller if desired; do not rethrow.
  }
}

export async function loadEnabledPlugins(): Promise<PluginInfo[]> {
  setPluginAppVersion(await getVersion().catch(() => '0.0.0'));
  const raw = (await safeInvoke<RawPlugin[]>('list_plugins')) ?? [];
  const infos = raw.map(classify);
  usePluginCommandStore.getState().clear();
  const grants = usePluginStore.getState();
  for (const info of infos) {
    if (info.status !== 'ok') continue;
    if (grants.isEnabledAndGranted(info.manifest.id, info.manifest.version)) {
      await loadOne(info);
    }
  }
  return infos;
}

export function unloadPlugin(id: string): void {
  usePluginCommandStore.getState().removeByPlugin(id);
}

export { PLUGIN_API_VERSION };
```
(Confirm `safeInvoke`'s signature/return from `@/lib/ipc` — the report says every store routes through it. Adjust the null-handling to match.)

- [ ] **Step 2: `usePluginHost.ts`:**
```ts
import { useEffect } from 'react';
import { loadEnabledPlugins } from '@/lib/plugins/host';

/** Load enabled plugins for the active Forge once on mount. */
export function usePluginHost(): void {
  useEffect(() => {
    loadEnabledPlugins().catch((err) => console.error('[plugins] host init failed:', err));
  }, []);
}
```

- [ ] **Step 3: Wire into `App.tsx`** — add `import { usePluginHost } from './hooks';` (or from `./hooks/usePluginHost`) and call `usePluginHost();` next to `useForgeWatcher();`. Export `usePluginHost` from `src/hooks/index.ts`.

- [ ] **Step 4: Verify build/type.** Run: `npx tsc --noEmit && npm run lint 2>&1 | grep -E "error" | head` (0 errors). No dedicated unit test (integration is manual — the load path needs the webview).

- [ ] **Step 5: Commit.**
```bash
git add src/lib/plugins/host.ts src/hooks/usePluginHost.ts src/hooks/index.ts src/App.tsx
git commit -m "feat(plugins): host loader + startup wiring

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 7: `pluginStore` (per-Forge enable + permission grant)

**Files:** Create `src/stores/pluginStore.ts` + `.test.ts`; modify `src/stores/index.ts`.

**Interfaces:**
- Produces `usePluginStore` (persist, `namespacedKey('moldavite-plugins')`), state `grants: Record<string, { enabled: boolean; grantedVersion: string }>`, actions:
  - `isEnabledAndGranted(id: string, version: string): boolean` — true only if enabled AND `grantedVersion === version`.
  - `grant(id: string, version: string): void` — set `{ enabled: true, grantedVersion: version }`.
  - `disable(id: string): void`.
  - `needsGrant(id: string, version: string): boolean` — true if not enabled or version changed (drives the permission sheet).

- [ ] **Step 1: Failing test** covering: default not-granted; `grant` then `isEnabledAndGranted` true; version bump → `needsGrant` true and `isEnabledAndGranted` false; `disable` flips it off. (Write concrete assertions mirroring Task 4's style.)

- [ ] **Step 2: Implement** mirroring `quickSwitcherStore`'s persist config exactly (`name: namespacedKey('moldavite-plugins')`, `createJSONStorage(() => localStorage)`, `partialize` to `{ grants }`):
```ts
import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { namespacedKey } from '@/lib/forgeStorage';

interface Grant { enabled: boolean; grantedVersion: string }
interface PluginState {
  grants: Record<string, Grant>;
  isEnabledAndGranted: (id: string, version: string) => boolean;
  needsGrant: (id: string, version: string) => boolean;
  grant: (id: string, version: string) => void;
  disable: (id: string) => void;
}

export const usePluginStore = create<PluginState>()(
  persist(
    (set, get) => ({
      grants: {},
      isEnabledAndGranted: (id, version) => {
        const g = get().grants[id];
        return !!g && g.enabled && g.grantedVersion === version;
      },
      needsGrant: (id, version) => {
        const g = get().grants[id];
        return !g || !g.enabled || g.grantedVersion !== version;
      },
      grant: (id, version) =>
        set((s) => ({ grants: { ...s.grants, [id]: { enabled: true, grantedVersion: version } } })),
      disable: (id) =>
        set((s) => ({
          grants: { ...s.grants, [id]: { enabled: false, grantedVersion: s.grants[id]?.grantedVersion ?? '' } },
        })),
    }),
    {
      name: namespacedKey('moldavite-plugins'),
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({ grants: s.grants }),
    }
  )
);
```

- [ ] **Step 3: Run → passes.** Export from `src/stores/index.ts`. Commit.

---

## Task 8: Palette + slash-menu integration

**Files:** Modify `src/components/quick-switcher/QuickSwitcher.tsx`, `src/components/editor/extensions/SlashCommandList.tsx`, `src/components/editor/Editor.tsx`.

**Interfaces:**
- Consumes: `usePluginCommandStore`.

- [ ] **Step 1: Palette — merge + dispatch.** In `QuickSwitcher.tsx`:
  - Add `const pluginCommands = usePluginCommandStore((s) => s.commands);`
  - Build palette entries from them: map each to `{ id, title: label, category: 'plugins', keywords: [] } as QuickSwitcherCommand` and concat with `QUICK_SWITCHER_COMMANDS` where the memo calls `filterCommands` (pass the merged list as the 2nd arg to `filterCommands`).
  - Add `pluginCommands` to the memo deps array (currently `[query, notes, recentNoteIds, recentSearches, pinnedNoteIds]`).
  - In `runCommand(id)`, add a fallback before/after the built-in `switch`: if `id` isn't a known built-in, call `usePluginCommandStore.getState().execute(id)` then close the palette. In `commandIcon`, return a `Puzzle` icon for ids containing `:` (plugin-namespaced) not matched by built-ins.
  - Confirm `commands.ts`'s `QuickSwitcherCommandCategory` includes `'plugins'`; if not, add it (Task-local edit to `commands.ts`).

- [ ] **Step 2: Slash — plugin item builder.** In `SlashCommandList.tsx`, export:
```ts
import { Puzzle } from 'lucide-react';
export function pluginSlashItem(entry: { id: string; label: string; handler: () => void | Promise<void> }): SlashCommandItem {
  return {
    title: entry.label,
    description: 'Plugin command',
    icon: Puzzle,
    command: () => { void entry.handler(); },
    keywords: ['plugin'],
  };
}
```

- [ ] **Step 3: Slash — merge in `Editor.tsx`.** In the `SlashCommands.configure({ suggestion: { items: ({ query }) => ... } })` callback (~line 505-603), concat plugin items:
```tsx
items: ({ query }) => {
  const base = filterCommands(query);
  const pluginItems = usePluginCommandStore.getState().commands
    .map(pluginSlashItem)
    .filter((i) => i.title.toLowerCase().includes(query.toLowerCase()));
  return [...base, ...pluginItems];
},
```
Import `pluginSlashItem` and `usePluginCommandStore`.

- [ ] **Step 4: Verify.** `npx tsc --noEmit && npm run lint` (0 errors). Run existing palette test: `npm test -- src/components/quick-switcher/commands.test.ts`.

- [ ] **Step 5: Commit.**
```bash
git add src/components/quick-switcher/QuickSwitcher.tsx src/components/quick-switcher/commands.ts src/components/editor/extensions/SlashCommandList.tsx src/components/editor/Editor.tsx
git commit -m "feat(plugins): surface plugin commands in palette + slash menu

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 9: Permission sheet modal

**Files:** Create `src/components/plugins/PluginPermissionSheet.tsx`.

**Interfaces:**
- Produces `<PluginPermissionSheet manifest permissions onEnable onCancel />` — a modal listing identity + a plain-language capability summary + declared `permissions`, with Enable / Cancel. Styled like existing modals (backdrop `z-[9999]`, `modal-elevated`, uses theme tokens + `useFocusTrap` if available on this branch — else a simple focusable dialog).

- [ ] **Step 1: Implement** the presentational modal (props-driven; no store coupling — the Settings section owns open state). Include the fixed copy: "This plugin runs code that can read and modify notes in this Forge, and add commands. Only enable plugins you trust." List `permissions` as chips; show name/version/author/description.

- [ ] **Step 2: Verify** `npx tsc --noEmit && npm run lint`. (Rendering is exercised via the Settings section in Task 10; a light render test is optional.)

- [ ] **Step 3: Commit.**

---

## Task 10: Settings → Plugins management UI

**Files:** Modify `src/components/settings/sections/PluginsSection.tsx`.

**Interfaces:**
- Consumes: `list_plugins` (IPC), `classify`/`loadEnabledPlugins` result, `usePluginStore`, `uninstall_plugin`, `install_example_plugin`, `PluginPermissionSheet`, `loadEnabledPlugins`/`unloadPlugin`.

- [ ] **Step 1: Rewrite the component body.** On mount + after mutations, call `loadEnabledPlugins()` (which returns the classified `PluginInfo[]` and also (re)loads granted ones) and render:
  - For each `PluginInfo`: name, version, author, description, and a status badge (`ok`/`disabled`/`invalid`/`incompatible` with reason tooltip).
  - Enable toggle: if enabling and `usePluginStore.needsGrant(id, version)` → open `PluginPermissionSheet`; on Enable → `usePluginStore.grant(id, version)` then `loadEnabledPlugins()`. If disabling → `usePluginStore.disable(id)` then `unloadPlugin(id)`.
  - "View permissions" opens the sheet read-only.
  - Uninstall → confirm → `safeInvoke('uninstall_plugin', { id })` → refresh.
  - "Install example plugin" → `safeInvoke('install_example_plugin')` → refresh (toast the "already installed" error).
  - Keep a short "Build your own → docs/PLUGINS.md" blurb using the existing external-link helper.

- [ ] **Step 2: Verify** `npx tsc --noEmit && npm run lint`. Commit.

---

## Task 11: Example plugin (repo source + bundled resource)

**Files:** Create `src-tauri/example-plugin/moldavite-example/{manifest.json,plugin.js,README.md}`.

- [ ] **Step 1: `manifest.json`:**
```json
{
  "id": "moldavite-example",
  "name": "Example Plugin",
  "version": "1.0.0",
  "author": "Moldavite",
  "description": "Insert a timestamp and show the current note's word count.",
  "apiVersion": 1,
  "minAppVersion": "1.4.0",
  "permissions": ["commands", "editor", "ui"]
}
```

- [ ] **Step 2: `plugin.js`:**
```js
export default function register(api) {
  api.commands.add({
    id: 'insert-timestamp',
    label: 'Insert timestamp',
    handler: () => {
      api.editor.insertText(new Date().toISOString());
    },
  });
  api.commands.add({
    id: 'word-count',
    label: 'Word count',
    handler: () => {
      const note = api.editor.getActiveNote();
      if (!note) return api.ui.toast('No active note', 'error');
      const text = note.content.replace(/<[^>]+>/g, ' ');
      const words = text.trim().split(/\s+/).filter(Boolean).length;
      api.ui.toast(`${words} word${words === 1 ? '' : 's'}`, 'info');
    },
  });
}
```

- [ ] **Step 3: `README.md`** — a short author-facing walkthrough (what it does, how the manifest + register map to the API). Commit.
```bash
git add src-tauri/example-plugin
git commit -m "feat(plugins): bundled example plugin (timestamp + word count)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 12: Documentation

**Files:** Create `docs/PLUGINS.md`; modify `docs/PLUGINS_DESIGN.md`, `CHANGELOG.md`, `README.md`, `docs/PROJECT_STATUS.md`.

- [ ] **Step 1: `docs/PLUGINS.md`** — author guide: package layout; manifest reference (every field, id rules, `apiVersion`); the full `PluginAPI` v1 reference (`commands.add`, `editor.getActiveNote`/`insertText`, `ui.toast`); the example walkthrough; how to install (drop into `<forge>/.plugins/` and reload, or "Install example plugin"); the trust/permission model in plain language (permissioned-open: a granted plugin runs with real access to this Forge's notes; enable only trusted plugins); versioning; and the v2 roadmap (fetch/allowlist, context menus, right-panel widgets, forge R/W, frontmatter, prompt).
- [ ] **Step 2:** `docs/PLUGINS_DESIGN.md` header → "Status: v1 implemented — see [PLUGINS.md](PLUGINS.md). This doc is the rationale/decision log."
- [ ] **Step 3:** `CHANGELOG.md` — add a plugin-system entry under a new `## [Unreleased]` heading (version chosen at release time). `README.md` — one line under "What You Get" ("**Plugins** — add your own commands; see docs/PLUGINS.md"). `PROJECT_STATUS.md` — mark plugin system v1 shipped; note v2 roadmap. Commit.

---

## Task 13: Final verification + PR

- [ ] **Step 1:** `npm test` (all pass), `npm run lint` (0 errors), `npm run build`, `npm run check:size`.
- [ ] **Step 2:** `cd src-tauri && cargo clippy --lib --all-targets -- -D warnings && cargo test --lib` (clean).
- [ ] **Step 3: MANUAL smoke (needs the app, `npm run tauri dev`):** Install example plugin → "Insert timestamp" + "Word count" appear in the command palette AND the `/` slash menu → run each (timestamp inserted at cursor; word-count toast) → disable → commands vanish → uninstall → gone → the permission sheet appears on first enable and re-appears after a version bump → a deliberately-throwing plugin only toasts. Confirm the Task 1 `plugin://` import gate passed.
- [ ] **Step 4:** Push branch, open PR (`gh pr create`), summarize; note the manual-verification items and that it stops before any release. Do not tag.

---

## Self-Review

**Spec coverage:** loader/scheme+CSP → Task 1; types/manifest → Task 2; backend commands → Task 3; registry → Task 4; editor handle + API → Task 5; host + startup → Task 6; enable/permission persistence → Task 7; palette+slash surfacing → Task 8; permission sheet → Task 9; Settings UI → Task 10; example → Task 11; docs → Task 12; verification → Task 13. ✓

**Placeholder scan:** No TBD. Two explicit "confirm the real signature" notes (`validate_path_within_base`, `safeInvoke`, `noteStore.currentNote.title`) are verification instructions with a stated fallback, not gaps — the executor reads the one file and adapts. The Task 6↔7 ordering dependency is called out with a resolution (do 7 first). ✓

**Type consistency:** `PluginAPI`/`PluginCommand`/`PluginInfo`/`PluginManifest`/`PLUGIN_API_VERSION` defined in Task 2, consumed unchanged in 4/5/6/10. `usePluginCommandStore` API (add/removeByPlugin/clear/execute) consistent across 4/5/6/8. `usePluginStore` (isEnabledAndGranted/needsGrant/grant/disable) consistent across 6/7/10. Namespaced id format `${pluginId}:${id}` consistent (Task 5 builds it; Task 8 dispatches on `:`). ✓

**Runtime-verification caveat (flagged):** Tasks 1 (import mechanism) and 13 (end-to-end smoke) require the running webview and cannot be verified headlessly; everything else is unit-testable or compile-checkable. Build+verify the Task 1 gate before investing in Tasks 8–11.

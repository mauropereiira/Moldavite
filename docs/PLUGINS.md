# Building Moldavite Plugins

Moldavite Plugin API v2 lets plugins add commands, work with the active editor,
read unlocked Forge notes, call explicitly approved HTTPS hosts, store credentials
in macOS Keychain, and show notifications.

> **Trust model.** Each plugin runs in its own sandboxed Web Worker with no DOM,
> Zustand, Tauri IPC, or network globals (`fetch`, `XMLHttpRequest`, `WebSocket`,
> and related APIs are removed). Its only app channel is the curated
> `postMessage` API below. Moldavite enforces permissions on the host side, not
> only in the worker proxy. Before a plugin runs, the user sees its permissions
> and exact network hosts. Consent is pinned to SHA-256 of the raw
> `manifest.json` + `plugin.js`; changing either file, including `allowedHosts`,
> requires consent again.
>
> Plugins still run third-party code. Only enable plugins you trust.

## Quick start

Create this layout in the active Forge:

```text
<forge>/.plugins/my-plugin/
├── manifest.json
├── plugin.js
└── README.md          # optional
```

Then open **Settings → Plugins**, enable it, review the permission sheet, and
run its commands through the command palette (⌘/Ctrl+P) or editor slash menu.
The bundled example can also be installed from that Settings page.

## Manifest v2

```json
{
  "id": "wordpress-publisher",
  "name": "WordPress Publisher",
  "version": "1.0.0",
  "author": "You",
  "description": "Publishes a Forge note to WordPress.",
  "apiVersion": 2,
  "minAppVersion": "1.6.0",
  "permissions": ["notes.read", "net.fetch", "secrets", "ui"],
  "allowedHosts": ["public-api.wordpress.com"]
}
```

| Field | Required | Meaning |
|---|---:|---|
| `id` | yes | Folder-matching plugin id: lowercase ASCII letters, digits, and hyphens; max 64 characters. |
| `name` | yes | Display name. |
| `version` | yes | Plugin version. Consent is content-hash-pinned even without a version change. |
| `apiVersion` | yes | Use `2` for this API. API v1 remains supported unchanged. |
| `author`, `description`, `minAppVersion` | no | Display/informational metadata. |
| `permissions` | no | Declared API groups. `commands` is always available. |
| `allowedHosts` | with `net.fetch` | Non-empty array of exact, lowercase DNS hostnames. No scheme, port, path, or wildcard. |

`net.fetch` without `allowedHosts` is invalid. Matching is exact:
`api.example.com` does not grant `example.com`, `www.api.example.com`, or a
non-default port. List each subdomain separately. `allowedHosts` is displayed
verbatim on the permission sheet.

## Entry point

`plugin.js` is an ES module with a default `register(api)` export:

```js
export default function register(api) {
  api.commands.add({
    id: 'publish',
    label: 'Publish current note',
    handler: async () => {
      const notes = await api.notes.list();
      const markdown = await api.notes.read(notes[0].path);
      await api.ui.toast(`Loaded ${markdown.length} characters`, 'success');
    },
  });
}
```

All methods except `commands.add` are asynchronous host RPC calls.

## API v2 reference

```ts
interface PluginAPI {
  app: { version: string; apiVersion: 2 };

  // Always available.
  commands: {
    add(command: {
      id: string;
      label: string;
      handler: () => void | Promise<void>;
    }): void;
  };

  // Requires "editor". Content is editor HTML.
  editor: {
    getActiveNote(): Promise<{ title: string; content: string } | null>;
    insertText(text: string): Promise<void>;
  };

  // Requires "ui".
  ui: {
    toast(message: string, kind?: 'info' | 'success' | 'error'): Promise<void>;
  };

  // Requires "notes.read". Content is Markdown, not editor HTML.
  notes: {
    list(): Promise<Array<{
      path: string;                     // Forge-relative, e.g. notes/Work/plan.md
      title: string;                    // filename without .md
      kind: 'daily' | 'weekly' | 'standalone';
      folder: string | null;            // standalone folder relative to notes/
    }>>;
    read(path: string): Promise<string>;
  };

  // Requires "net.fetch" and an allowedHosts entry matching every request.
  net: {
    fetch(url: string, options?: {
      method?: string;
      headers?: Record<string, string>;
      body?: string;
    }): Promise<{
      status: number;
      headers: Record<string, string>;
      bodyText: string;
      bodyBase64?: string;              // included for non-text responses
    }>;
  };

  // Requires "secrets".
  secrets: {
    get(key: string): Promise<string | null>;
    set(key: string, value: string): Promise<void>;
    delete(key: string): Promise<void>;
  };
}
```

### Notes

`notes.list()` returns metadata for daily, weekly, and standalone notes,
including locked placeholders. `notes.read(path)` only accepts an exact path
returned by the current Forge listing and rejects locked notes. It reuses the
same validated note IPC used by Moldavite itself; Plugin API v2 adds no new
filesystem-reading command.

### Network

The worker never receives a network global. `api.net.fetch` asks the Moldavite
host to make the request after checking the permission and allowlist. Only
absolute HTTPS URLs without embedded credentials are accepted. Request bodies
are strings.

Redirects use `redirect: "manual"`. Each `Location` is resolved and validated
before the next request, with at most five redirects. A missing/hidden
`Location` is rejected; this safely rejects WebKit `opaqueredirect` responses
rather than following an unverifiable target. `Authorization` and `Cookie`
headers are removed when a redirect crosses origins. The whole request chain
has a 30-second timeout and the streamed response is capped at 10 MiB.

Response headers are deliberately limited to `content-type`, `content-length`,
`etag`, `last-modified`, `link`, `retry-after`, `x-wp-total`, and
`x-wp-totalpages`. `set-cookie` is never exposed. Text/JSON/XML bodies are
returned in `bodyText`; non-text bodies additionally include base64.

```js
const token = await api.secrets.get('wordpress-token');
const response = await api.net.fetch(
  'https://public-api.wordpress.com/rest/v1.1/sites/example.wordpress.com/posts/new',
  {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ title: 'From Moldavite', content: '# Hello' }),
  }
);
if (response.status >= 400) throw new Error(response.bodyText);
```

### Secrets

Secrets are stored in macOS Keychain using service `Moldavite`. The account is
always constructed by the host as `plugin:<plugin-id>:<key>`; a worker cannot
choose or impersonate another plugin id. Keys are 1–128 characters using
letters, digits, `.`, `_`, and `-`. `get` returns `null` when absent and
`delete` is idempotent. Secret values are never listed or included in Forge,
settings, plugin, or backup exports.

## Permissions and consent

| Permission | Grants |
|---|---|
| `editor` | Read active-note HTML and insert text at the cursor. |
| `ui` | Show notifications. |
| `notes.read` | List note metadata and read unlocked Markdown. |
| `net.fetch` | Ask the host to call only the exact `allowedHosts`. |
| `secrets` | Read/write/delete this plugin's namespaced Keychain entries. |

The worker proxy rejects undeclared calls early, and the host independently
checks every RPC message. The host check is the security boundary. Unknown RPC
method names are rejected. Disabling a plugin or switching Forges terminates
its worker, drops registered commands, and rejects pending command invocations.

Consent covers the raw manifest bytes as well as plugin code. Therefore adding,
removing, or editing an `allowedHosts` entry changes the existing SHA-256 hash
and re-opens the permission sheet before the plugin can run.

## API v1 compatibility

Existing manifests with `"apiVersion": 1` remain valid and receive the original
commands/editor/ui surface with `api.app.apiVersion === 1`. They do not need a
manifest or source migration. Use API v2 to request notes, networking, or
secrets. Plugin enable state is per Forge; uninstalling removes the plugin
folder and forgets its consent grant.

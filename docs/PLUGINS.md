# Building Moldavite Plugins

Moldavite Plugin API v2 lets plugins add commands, work with the active editor,
read unlocked Forge notes, call explicitly approved HTTPS hosts, collect values
through trusted app-rendered forms, store credentials in macOS Keychain, and
show notifications.

> **Trust model.** Each plugin runs in its own sandboxed Web Worker with no DOM,
> Zustand, Tauri IPC, or network globals (`fetch`, `XMLHttpRequest`, `WebSocket`,
> and related APIs are removed). Its only app channel is the curated
> `postMessage` API below. Moldavite enforces permissions on the host side, not
> only in the worker proxy. Before a plugin runs, the user sees its permissions
> and manifest-declared network hosts. A plugin may also ask for an additional
> exact host at runtime; Moldavite shows a separate consent dialog and lists the
> grant with a revoke button in Settings. Consent is pinned to SHA-256 of the raw
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
  "permissions": ["editor", "ui", "notes.read", "net.fetch", "secrets"],
  "allowedHosts": ["public-api.wordpress.com"]
}
```

| Field                                    |         Required | Meaning                                                                                     |
| ---------------------------------------- | ---------------: | ------------------------------------------------------------------------------------------- |
| `id`                                     |              yes | Folder-matching plugin id: lowercase ASCII letters, digits, and hyphens; max 64 characters. |
| `name`                                   |              yes | Display name.                                                                               |
| `version`                                |              yes | Plugin version. Consent is content-hash-pinned even without a version change.               |
| `apiVersion`                             |              yes | Use `2` for this API. API v1 remains supported unchanged.                                   |
| `author`, `description`, `minAppVersion` |               no | Display/informational metadata.                                                             |
| `permissions`                            |               no | Declared API groups. `commands` is always available.                                        |
| `allowedHosts`                           | with `net.fetch` | Non-empty array of exact, lowercase DNS hostnames. No scheme, port, path, or wildcard.      |

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
    add(command: { id: string; label: string; handler: () => void | Promise<void> }): void;
  };

  // Requires "editor". Content is editor HTML.
  editor: {
    getActiveNote(): Promise<{ path: string; title: string; content: string } | null>;
    insertText(text: string): Promise<void>;
  };

  // toast requires "ui"; prompt is always available and user-mediated.
  ui: {
    toast(message: string, kind?: 'info' | 'success' | 'error'): Promise<void>;
    // Always available: the trusted header identifies the requesting plugin.
    prompt(options: {
      title: string;
      message?: string;
      fields: Array<{
        name: string;
        label: string;
        type: 'text' | 'password' | 'url';
        placeholder?: string;
        required?: boolean;
      }>;
      confirmLabel?: string;
    }): Promise<Record<string, string> | null>;
  };

  // Requires "notes.read". Content is Markdown, not editor HTML.
  notes: {
    list(): Promise<
      Array<{
        path: string; // Forge-relative, e.g. notes/Work/plan.md
        title: string; // filename without .md
        kind: 'daily' | 'weekly' | 'standalone';
        folder: string | null; // standalone folder relative to notes/
      }>
    >;
    read(path: string): Promise<string>;
  };

  // Requires "net.fetch" and an allowedHosts entry matching every request.
  net: {
    requestHostAccess(host: string): Promise<boolean>;
    fetch(
      url: string,
      options?: {
        method?: string;
        headers?: Record<string, string>;
        body?: string;
      }
    ): Promise<{
      status: number;
      headers: Record<string, string>;
      bodyText: string;
      bodyBase64?: string; // included for non-text responses
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

`editor.getActiveNote()` returns the live editor HTML plus its Forge-relative
`path`. Use the path, rather than the display title, as a stable key for
per-note plugin state.

### Host-rendered prompts

`ui.prompt()` needs no manifest permission because it only asks Moldavite to
render a user-mediated form. Moldavite validates the options, permits at most
one plugin prompt/consent dialog at a time, and always puts **Request from
plugin — Plugin Name** in trusted dialog chrome above the plugin-supplied title.
Cancel and Escape return `null`; submit returns a string map keyed by field
name. Field names must be unique identifiers and a form may contain 1–12
fields.

```js
const values = await api.ui.prompt({
  title: 'Configure publishing',
  fields: [
    { name: 'site', label: 'Site URL', type: 'url', required: true },
    { name: 'password', label: 'Application Password', type: 'password', required: true },
  ],
  confirmLabel: 'Save',
});
if (!values) return; // user cancelled
```

### Network

The worker never receives a network global. `api.net.fetch` asks the Moldavite
host to make the request after checking the permission and effective allowlist.
That allowlist is the union of manifest `allowedHosts` and hosts the user has
approved through `api.net.requestHostAccess(host)`. Only absolute HTTPS URLs
without embedded credentials are accepted. Request bodies are strings.

`requestHostAccess` uses the exact same hostname validator as the manifest: no
IPs, single-label names, localhost labels, schemes, ports, paths, or wildcards.
Moldavite names the requesting plugin and host in its consent dialog. Approval
is stored in the current Forge's app-side plugin grant record, not the manifest,
so it does not alter the manifest/code consent hash. A denial returns `false`
without throwing. Existing manifest or user approval returns `true` without
prompting. Users can remove one dynamic host from **Settings → Plugins → View
permissions**; the next request and every redirect immediately use the reduced
union.

```js
const site = new URL('https://notes.example.com');
if (!(await api.net.requestHostAccess(site.hostname))) return;
const response = await api.net.fetch(`${site.origin}/wp-json/wp/v2/users/me`);
```

**Security model:** every host is explicitly consented to; IP literals,
single-label hosts, and localhost names are rejected. HTTPS means DNS rebinding
to an internal service still fails TLS certificate validation. Cross-origin
redirects carry only `Accept`, `Accept-Language`, and, when the request body is
preserved, `Content-Type`.

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

| Permission   | Grants                                                                      |
| ------------ | --------------------------------------------------------------------------- |
| `editor`     | Read active-note HTML and insert text at the cursor.                        |
| `ui`         | Show notifications. `ui.prompt` is always available and adds no permission. |
| `notes.read` | List note metadata and read unlocked Markdown.                              |
| `net.fetch`  | Ask the host to call exact manifest or user-approved hosts.                 |
| `secrets`    | Read/write/delete this plugin's namespaced Keychain entries.                |

The worker proxy rejects undeclared calls early, and the host independently
checks every RPC message. The host check is the security boundary. Unknown RPC
method names are rejected. Disabling a plugin or switching Forges terminates
its worker, drops registered commands, and rejects pending command invocations.

Consent covers the raw manifest bytes as well as plugin code. Therefore adding,
removing, or editing an `allowedHosts` entry changes the existing SHA-256 hash
and re-opens the permission sheet before the plugin can run.

Runtime host grants are intentionally separate app-side consent. They survive a
plugin version/hash re-grant, remain visible and individually revocable, and are
forgotten when the plugin is uninstalled.

## Publish to WordPress

Moldavite bundles a first-party **Publish to WordPress** Plugin API v2 reference.
Install it from **Settings → Plugins**, enable it, then run **Configure WordPress
publishing**. The plugin uses a trusted `ui.prompt` form for the site URL,
username, and Application Password; requests access to the derived site host;
verifies `/wp-json/wp/v2/users/me`; and only then stores its JSON configuration
through `api.secrets`.

With a note open, **Publish note to WordPress…** sends the editor HTML to
`/wp-json/wp/v2/posts` as a draft. A Keychain-backed path→post-id map means a
second publish of the same Forge-relative note path uses `PUT` to update the
existing post. The success toast includes the WordPress edit URL. The
dependency-free source and README are bundled under
`src-tauri/example-plugin/moldavite-wordpress/` as an authoring example.

Self-hosted WordPress and WordPress.com Jetpack/Atomic sites work when they
expose the standard REST API and Application Passwords. **WordPress.com Simple
sites are not supported**: they require OAuth with a registered client ID, and
the plugin deliberately does not embed or fake one.

## API v1 compatibility

Existing manifests with `"apiVersion": 1` remain valid and receive the original
commands/editor/ui surface with `api.app.apiVersion === 1`. They do not need a
manifest or source migration. Use API v2 to request notes, networking, or
secrets. Plugin enable state is per Forge; uninstalling removes the plugin
folder and forgets its consent grant.

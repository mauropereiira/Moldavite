# Building Moldavite Plugins

Moldavite Plugin API v2 lets plugins register commands, inspect and edit the
active editor, read unlocked Forge notes, collect values through trusted
app-rendered forms, call explicitly approved HTTPS hosts, store credentials in
macOS Keychain, and show notifications.

> **Trust model.** Each plugin is an ES module running in its own sandboxed Web
> Worker with no DOM, Zustand, raw Tauri IPC, or direct network globals
> (`fetch`, `XMLHttpRequest`, `WebSocket`, `EventSource`, and related APIs are
> removed). Its only app channel is the curated `postMessage` RPC below. The
> worker proxy rejects undeclared calls early, and Moldavite independently
> enforces permissions and arguments on the host side. The host check is the
> security boundary.
>
> Before a plugin runs, the user sees its requested permissions and every
> manifest-declared network host. Runtime host requests use a separate trusted
> consent dialog and remain visible with an individual revoke control.
> Consent is pinned to SHA-256 of the raw `manifest.json` + `plugin.js`; any
> edit, including an `allowedHosts` change, prompts again.
>
> A granted plugin may still read unlocked notes or send selected data to an
> approved service. Only enable plugins you trust, and request the narrowest
> permissions your plugin needs.

## Quick start

Create this layout in the active Forge:

```text
<Forge>/.plugins/my-plugin/
├── manifest.json
├── plugin.js
└── README.md          # optional, recommended for distribution
```

1. Make the folder name match the manifest `id`.
2. Add a v2 manifest and a default `register(api)` export.
3. Open or reopen **Settings → Plugins**.
4. Enable the plugin and review the permission sheet.
5. Run its commands through the command palette (⌘/Ctrl+P) or editor slash
   menu.

There is no required package manager or build step. A dependency-free
`plugin.js` works as written. If you bundle dependencies, distribute the final
self-contained ES module because Moldavite loads only this one entry file.

## Manifest v2

```json
{
  "id": "my-publisher",
  "name": "My Publisher",
  "version": "1.0.0",
  "author": "Your Name",
  "description": "Publishes the active note to an approved service.",
  "apiVersion": 2,
  "minAppVersion": "1.6.0",
  "permissions": ["editor", "ui", "notes.read", "net.fetch", "secrets"],
  "allowedHosts": ["api.example.com"],
  "commands": [
    { "id": "configure-publisher", "label": "Configure publisher" },
    { "id": "publish-note", "label": "Publish active note…" }
  ],
  "instructions": [
    "Enable the plugin and approve its permissions.",
    "Press `Cmd+P` and run **Configure publisher** first.",
    "Open a note, then run **Publish active note…**."
  ]
}
```

| Field | Required | Meaning |
| --- | ---: | --- |
| `id` | yes | Must match the folder name. Lowercase ASCII letters, digits, and hyphens; begins with a letter or digit; maximum 64 characters. |
| `name` | yes | User-facing name shown in Settings and trusted prompt chrome. |
| `version` | yes | User-facing plugin version. Consent is content-hash-pinned even without a version change. |
| `apiVersion` | yes | Use `2` for this API. Versions 1 and 2 are supported. |
| `author` | no | Display metadata. |
| `description` | no | Display metadata. Explain what the plugin does and where data may go. |
| `minAppVersion` | no | Informational metadata in v1.6; it is not currently semver-enforced. Do not use it as a runtime guard. |
| `permissions` | no | Supported capability strings from the permission table below. Commands are always available. |
| `allowedHosts` | with `net.fetch` | Non-empty, unique array of exact lowercase public DNS hostnames. No scheme, port, path, IP, single-label name, localhost label, or wildcard. |
| `commands` | no | Up to 50 `{ "id", "label" }` entries shown before the plugin is enabled. Each id must match the id registered through `api.commands.add`; ids are limited to 128 characters and labels to 200. Duplicate ids are invalid. |
| `instructions` | no | Ordered setup/use steps shown in the post-install **About this plugin** dialog. Up to 20 strings, 500 characters each. Inline `**bold**` and `` `code` `` are rendered; other text remains literal. |

Unknown top-level manifest fields and incorrectly typed values invalidate the
manifest. Use only the supported permission strings documented below.

Host matching is exact. `api.example.com` does not grant `example.com`,
`www.api.example.com`, or a non-default port. List every required subdomain
separately. `allowedHosts` is shown verbatim on the permission sheet.

API v2 requires at least one manifest `allowedHosts` entry whenever
`net.fetch` is declared, even if the plugin also requests user-supplied site
hosts at runtime. Runtime grants extend the manifest list; they do not replace
this validation requirement.

Every successful in-app install opens a themed **About this plugin**
dialog sourced from this validated metadata. The same dialog is always
available from the ⓘ button on the installed plugin card. If `instructions` is
omitted, Moldavite generates a short enable-and-open-the-palette flow from the
description and command list. Legacy manifests without declarative `commands`
remain compatible; once enabled, their runtime-registered commands are used as
a display fallback.

## Entry point and command lifecycle

`plugin.js` is an ES module with a default `register(api)` export. Register
commands during startup; handlers may be synchronous or asynchronous.

```js
export default function register(api) {
  api.commands.add({
    id: 'inspect-active-note',
    label: 'Inspect active note',
    handler: async () => {
      const note = await api.editor.getActiveNote();
      if (!note) return;
      await api.ui.toast(`Open: ${note.path}`, 'success');
    },
  });
}
```

Moldavite namespaces command ids as `<plugin-id>:<local-id>` in the host. Keep
local ids stable and unique within the plugin. Every method except
`commands.add` is an asynchronous host RPC. A command invocation that never
settles is rejected by the host after 30 seconds.

## Complete API v2 surface

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

  // Requires "editor". Content is live editor HTML.
  editor: {
    getActiveNote(): Promise<{
      path: string;
      title: string;
      content: string;
    } | null>;
    insertText(text: string): Promise<void>;
  };

  ui: {
    // Requires "ui".
    toast(
      message: string,
      kind?: 'info' | 'success' | 'error'
    ): Promise<void>;

    // API v2, always available and user-mediated.
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
        path: string;
        title: string;
        kind: 'daily' | 'weekly' | 'standalone';
        folder: string | null;
      }>
    >;
    read(path: string): Promise<string>;
  };

  // Requires "net.fetch".
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
      bodyBase64?: string;
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

### App metadata and commands

#### `api.app.version: string`

The running Moldavite app version.

#### `api.app.apiVersion: 2`

The API version selected by this manifest.

#### `api.commands.add(command): void`

Always available. Adds a namespaced command to the command palette and editor
slash menu.

```js
if (api.app.apiVersion !== 2) throw new Error('Plugin API v2 required');

api.commands.add({
  id: 'hello',
  label: 'Say hello',
  handler: () => api.ui.toast(`Hello from Moldavite ${api.app.version}`),
});
```

`commands.add` expects string `id` and `label` fields plus a function
`handler`. Registering the same local id again replaces that handler within
the worker, so use unique ids.

### Editor

Requires the `editor` permission.

#### `editor.getActiveNote(): Promise<ActiveNote | null>`

Returns the active note's Forge-relative `path`, display `title`, and live
editor HTML in `content`, or `null` when no note is open.

#### `editor.insertText(text: string): Promise<void>`

Inserts text at the active editor cursor. If there is no active editor,
Moldavite displays an error notification.

```js
const active = await api.editor.getActiveNote();
if (active) {
  console.log(active.path, active.content); // content is editor HTML
  await api.editor.insertText('\nPublished from Moldavite.');
}
```

Use `path`, not the display title, as the key for per-note plugin state. API v2
has no general note-write method or panel extension point; `insertText` is an
explicit active-editor action under the `editor` permission.

### User interface

#### `ui.toast(message, kind?): Promise<void>`

Requires the `ui` permission. `kind` accepts `info`, `success`, or `error` and
defaults to `info` in the worker proxy.

```js
await api.ui.toast('Ready to publish', 'success');
```

#### `ui.prompt(options): Promise<Record<string, string> | null>`

Available to API v2 without a manifest permission because every prompt is a
user-mediated, Moldavite-rendered form. Submit returns a string map keyed by
field name. Cancel or Escape returns `null`.

```js
const values = await api.ui.prompt({
  title: 'Configure publishing',
  message: 'Credentials are verified before saving.',
  fields: [
    {
      name: 'site',
      label: 'Site URL',
      type: 'url',
      required: true,
    },
    {
      name: 'password',
      label: 'Application Password',
      type: 'password',
      required: true,
    },
  ],
  confirmLabel: 'Verify and save',
});
if (!values) return;
```

Moldavite permits one plugin prompt or runtime-host consent dialog at a time
and always places **Request from plugin — Plugin Name** in trusted chrome above
plugin-supplied content.

Prompt validation:

| Value | Limit/rule |
| --- | --- |
| `title` | Non-empty, up to 200 characters |
| `message` | Optional, up to 2,000 characters |
| `fields` | 1–12 fields |
| field `name` | Unique identifier beginning with a letter; letters, digits, `_`, and `-`; up to 64 characters |
| field `label` | Non-empty, up to 160 characters |
| field `type` | `text`, `password`, or `url` |
| field `placeholder` | Optional, up to 300 characters |
| field `required` | Optional boolean |
| `confirmLabel` | Optional non-empty string up to 80 characters |

### Notes

Requires the `notes.read` permission.

#### `notes.list(): Promise<PluginNoteMetadata[]>`

Returns metadata for daily, weekly, and standalone notes. Locked placeholders
are included so listings stay complete.

#### `notes.read(path: string): Promise<string>`

Reads the parsed Markdown body for an exact path in the current Forge listing.
Unknown paths and locked notes reject. YAML frontmatter is not included in the
returned body.

```js
const notes = await api.notes.list();
const standalone = notes.find((note) => note.kind === 'standalone');
if (standalone) {
  const markdownBody = await api.notes.read(standalone.path);
  await api.ui.toast(`Read ${markdownBody.length} characters`);
}
```

Paths are Forge-relative, for example `daily/2026-07-13.md`,
`weekly/2026-W29.md`, or `notes/Projects/roadmap.md`. The `folder` value is
relative to `notes/` for standalone notes and `null` otherwise. The plugin
receives no arbitrary filesystem-read capability; `notes.read` reuses the same
validated note command as Moldavite itself.

### Network and runtime host consent

Requires the `net.fetch` permission and a non-empty manifest `allowedHosts`
array.

#### `net.requestHostAccess(host: string): Promise<boolean>`

Returns `true` when an exact host is already approved by the manifest or a
runtime grant. Otherwise it opens a Moldavite-rendered consent dialog naming
the plugin and host. Denial returns `false` without throwing. Invalid hostname
forms reject.

#### `net.fetch(url, options?): Promise<PluginFetchResponse>`

Asks Moldavite to make a request after checking the effective exact-host
allowlist. Only absolute HTTPS URLs without embedded credentials are accepted.
Request headers must be a string map, and bodies are strings.

```js
const site = new URL('https://notes.example.com');
const approved = await api.net.requestHostAccess(site.hostname);
if (!approved) return;

const response = await api.net.fetch(`${site.origin}/api/drafts`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ title: 'From Moldavite' }),
});
if (response.status >= 400) throw new Error(response.bodyText);
```

`requestHostAccess` uses the manifest validator: no schemes, ports, paths,
wildcards, IP literals, single-label names, or labels named `localhost`.
Approval is stored in Moldavite's app-side, per-Forge plugin grant record—not
in plugin files—so it does not change the manifest/code consent hash.

The effective fetch allowlist is the union of manifest `allowedHosts` and
user-approved runtime hosts. Users can revoke one runtime host under
**Settings → Plugins → View permissions**. The next request and every redirect
hop immediately use the reduced union.

#### Fetch and redirect security model

- Request methods contain letters only. `CONNECT`, `TRACE`, and `TRACK` are
  blocked.
- Redirect handling is manual. Each visible `Location` is resolved and
  validated before the next request, with at most five redirects.
- Missing or WebKit-hidden redirect targets are rejected rather than followed
  without validation.
- Cross-origin redirects keep only `Accept`, `Accept-Language`, and—when a
  request body remains—`Content-Type`. Authorization and cookies are not
  forwarded.
- The entire chain has a 30-second timeout. The streamed response is capped at
  10 MiB, including when no trustworthy `Content-Length` is present.
- HTTPS certificate validation means DNS rebinding to an internal service
  still has to satisfy the requested public hostname's TLS identity.

Response headers are restricted to `content-type`, `content-length`, `etag`,
`last-modified`, `link`, `retry-after`, `x-wp-total`, and
`x-wp-totalpages`. `set-cookie` is never exposed. Text, JSON, XML, JavaScript,
and form bodies are decoded into `bodyText`; non-text responses also include
`bodyBase64`.

### Keychain secrets

Requires the `secrets` permission.

#### `secrets.get(key): Promise<string | null>`

Returns the stored string or `null` when no entry exists.

#### `secrets.set(key, value): Promise<void>`

Stores a string in this plugin's macOS Keychain namespace.

#### `secrets.delete(key): Promise<void>`

Deletes an entry when present and otherwise succeeds.

```js
await api.secrets.set('api-token', token);
const saved = await api.secrets.get('api-token');
if (saved) {
  // Use it through api.net.fetch, then remove it when it is no longer needed.
  await api.secrets.delete('api-token');
}
```

Moldavite uses Keychain service `Moldavite` and constructs the account as
`plugin:<plugin-id>:<key>`. The host supplies and validates the plugin id, so a
worker cannot choose or impersonate another plugin's namespace.

Keys are 1–128 characters, begin with a letter or digit, and then use letters,
digits, `.`, `_`, or `-`. Secret values are never listed or included in Forge,
settings, plugin, ZIP, or encrypted-backup exports.

## Permissions and consent

| Permission | Grants |
| --- | --- |
| none | `app`, `commands.add`, and API v2 `ui.prompt` |
| `editor` | Read active-note path/title/HTML and insert text at the cursor |
| `ui` | Show toast notifications |
| `notes.read` | List note metadata and read unlocked Markdown bodies |
| `net.fetch` | Request runtime hosts and ask Moldavite to call exact approved HTTPS hosts |
| `secrets` | Read, write, and delete this plugin's namespaced Keychain entries |

Consent covers the raw manifest bytes, a separator, and the `plugin.js` bytes.
Adding, removing, or editing a permission or `allowedHosts` entry therefore
changes the SHA-256 content hash and reopens the permission sheet even if
`version` did not change.

Runtime host consent is deliberately separate. Runtime grants:

- survive a plugin version/hash re-grant;
- remain visible and individually revocable;
- do not modify plugin files or the content hash; and
- are forgotten with the plugin consent record when the plugin is uninstalled.

Disabling a plugin, uninstalling it, switching Forges, a worker crash, or an
unreadable worker message terminates the worker, removes its commands, and
rejects pending command invocations. Malformed manifests are shown as invalid
rather than executed.

## Worked reference: Publish to WordPress

Moldavite bundles a dependency-free first-party **Publish to WordPress** API v2
plugin under `src-tauri/example-plugin/moldavite-wordpress/`. Install it from
**Settings → Plugins**, enable it, and inspect its manifest, source, and README
as an end-to-end reference.

Its flow demonstrates the whole v2 surface:

1. **Configure WordPress publishing** opens a trusted `ui.prompt` for an HTTPS
   site URL, username, and Application Password.
2. It derives the site hostname, calls `net.requestHostAccess`, and verifies
   `/wp-json/wp/v2/users/me?context=edit` before saving configuration through
   `secrets.set`.
3. **Publish note to WordPress…** calls `editor.getActiveNote` and sends the
   live editor HTML to `/wp-json/wp/v2/posts` as a draft.
4. A Keychain-backed Forge-path-to-post-id map makes later publishes of the
   same path use `PUT` to update the existing post. The success notification
   includes the edit URL.

Self-hosted WordPress and WordPress.com Jetpack/Atomic sites work when they
expose the standard REST API and Application Passwords. **WordPress.com Simple
sites are not supported**: they require OAuth with a separately registered
client ID, and the reference plugin intentionally does not embed or fake one.

## Distributing your plugin

- Distribute one folder whose name equals the manifest id and which contains
  `manifest.json`, the final self-contained `plugin.js`, and a README.
- To list it publicly, fork
  [moldavite-plugins](https://github.com/mauropereiira/moldavite-plugins), add
  the folder under `plugins/<id>/`, add its metadata and the exact SHA-256 of
  both distributed files to the root `registry.json`, and open a pull request.
  Registry review is the distribution gate; keep the submitted source and
  hashes synchronized in the same PR.
- Document every external service, exact manifest host, runtime-host reason,
  credential key, destructive action, and publishing action. Keep permissions
  minimal.
- Users select **Settings → Plugins → Browse community plugins** to fetch the
  directory explicitly; Moldavite never checks it at startup. The app constructs
  file URLs only inside the pinned registry repository, and Rust verifies the
  registry hashes before the shared staged/atomic installer writes either file.
  Manual folder copies under `<Forge>/.plugins/` remain supported.
- To update, submit the new files, hashes, metadata, and incremented `version`
  together. Installed users see an Update action and must confirm replacement.
  Any byte change invalidates the content-hash grant and requires fresh consent.
- Successful community and bundled installs open **About this plugin** with the
  manifest instructions. Installation never enables a plugin; enable state and
  consent remain per Forge.
- Uninstalling in Settings deletes the plugin folder and forgets its
  consent/runtime-host grant. It does **not** automatically delete macOS
  Keychain secrets because plugin keys are intentionally not enumerable.
  Provide a reset command that calls `secrets.delete` for every known key when
  users need credential cleanup before uninstalling.
- Test cancellation, missing notes, locked-note rejection, denied and revoked
  hosts, non-2xx responses, timeouts, malformed JSON, and a plugin disable
  during an in-flight command.

## API v1 compatibility

Existing manifests with `"apiVersion": 1` remain valid and receive the
original `app`, `commands`, `editor`, and `ui.toast` surface, with
`api.app.apiVersion === 1`. They do not need a manifest or source migration.
Use API v2 for trusted prompts, Forge note reads, networking, or Keychain
secrets.

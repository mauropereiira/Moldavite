# Moldavite Clipper

Save the page you are reading as a Markdown note in Moldavite. Text only: links
survive, images and styling do not.

## Install

**Chrome, Edge, Brave**

1. Download and unzip `moldavite-clipper-chrome.zip` from the
   [latest release](https://github.com/mauropereiira/Moldavite/releases/latest).
2. Open `chrome://extensions` and turn on **Developer mode**.
3. Click **Load unpacked** and choose the unzipped folder.

Chrome only allows extensions from outside its store in Developer mode. That is
Chrome's rule for anything unlisted, not a warning about this extension.

**Firefox**

1. Download `moldavite-clipper.xpi` from the same release.
2. Open it in Firefox and confirm.

Firefox installs only signed add-ons, so this file is signed by Mozilla. It is
not listed in their store — the download stays here.

Then open Moldavite → Settings → Plugins and press **Connect browser**. Nothing
can reach your notes until you do.

## Permissions

Three, and no host permissions at all, so the extension has no standing access
to any site:

- `activeTab` — read the page in the tab you are on, and only after you have
  opened the popup on that tab.
- `scripting` — run the small reader script that hands the popup that page's
  HTML.
- `nativeMessaging` — talk to the Moldavite binary.

## How it works

The extension has no filesystem access and makes no network requests — its
`connect-src 'none'` content security policy is what enforces the second. It
talks to the Moldavite binary over the browser's native-messaging channel, which
the browser starts on demand — Moldavite does not have to be running. The bridge
answers exactly two requests:

- `forges` — the names of your Forges, so the dropdown can offer them
- `clip` — write this Markdown to `notes/Clippings/` in the named Forge

Four things leave the browser when you press **Clip this page**, and nothing at
any other time: the page title, the page URL, the Markdown converted from it,
and the Forge you picked.

It cannot read a note. Which extension may connect is pinned by ID in the host
manifest that **Connect browser** writes.

## Limitations

- Whole pages only. A selection is not clipped on its own.
- Text only: images, video, embeds, forms and styling are dropped, and a link
  that is not `http(s)` is unwrapped to plain text.
- Pages no extension may read — `chrome://`, `about:`, the Chrome Web Store, the
  built-in PDF viewer — cannot be clipped.
- Above 5 MB of Markdown the clip is refused rather than truncated.

## Publishing

`npm run build` produces three directories. They differ only in manifest keys.

- `dist/chrome` keeps `key`, which pins the extension id the desktop app allows.
  This is the one to load unpacked.
- `dist/chrome-store` drops `key`, because the Web Store re-signs with its own
  and Chrome refuses a package whose key implies a different id. This is the one
  to upload.
- `dist/firefox` drops `key` and keeps the Gecko id.

The store assigns an id that will not match the unpacked one, and the app only
opens the bridge to ids it knows, so the new id has to be added to
`CHROME_EXTENSION_IDS` in `src-tauri/src/commands/browser_bridge.rs` and shipped
in an app release. Full checklist, listing copy and permission justifications:
`docs/CHROME_STORE.md`.

## Development

```bash
npm install
npm test          # conversion and popup, in jsdom — no browser needed
npm run build     # dist/chrome and dist/firefox
```

`key.pem` is gitignored and lives in 1Password. Chrome derives the extension ID
from it, the host manifest pins that ID, and generating a new key unpairs every
existing install.

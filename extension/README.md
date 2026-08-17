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

## How it works

The extension has no network access and no filesystem access. It talks to the
Moldavite binary over the browser's native-messaging channel, which the browser
starts on demand — Moldavite does not have to be running. The bridge answers
exactly two requests:

- `forges` — the names of your Forges, so the dropdown can offer them
- `clip` — write this Markdown to `notes/Clippings/` in the named Forge

It cannot read a note. Which extension may connect is pinned by ID in the host
manifest that **Connect browser** writes.

## Development

```bash
npm install
npm test          # conversion and popup, in jsdom — no browser needed
npm run build     # dist/chrome and dist/firefox
```

`key.pem` is gitignored and lives in 1Password. Chrome derives the extension ID
from it, the host manifest pins that ID, and generating a new key unpairs every
existing install.

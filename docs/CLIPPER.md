# The Moldavite browser clipper

Save the page you are reading as a Markdown note. Text only: headings, lists,
quotes, code and tables survive, links are kept and made absolute, images and
styling are dropped.

Notes land in `notes/Clippings/` inside the Forge you pick, with the source URL
and the date in frontmatter:

<!-- Not a ```markdown fence: Prettier reformats embedded YAML and would rewrite
     these quotes to single, which is not what the clipper writes. -->

```text
---
source: "https://example.com/tls"
clipped: 2026-08-17
---

# How Cloudflare handles TLS
```

Clipping the same page twice never overwrites the first note — the second
becomes `… (2).md`.

## Installing

The extension is distributed from this repository, not from the browser stores.
Both browsers ask for something unusual as a result, and neither is a defect in
Moldavite.

**Chrome, Edge & Brave**

1. Download and unzip `moldavite-clipper-chrome.zip` from the
   [latest release](https://github.com/mauropereiira/Moldavite/releases/latest).
2. Open `chrome://extensions` and turn on **Developer mode**.
3. Click **Load unpacked** and choose the unzipped folder.

Chrome only allows extensions from outside its store in Developer mode. That is
Chrome's rule for anything unlisted.

**Firefox**

1. Download `moldavite-clipper.xpi` from the same release.
2. Open it in Firefox and confirm.

Firefox installs only signed add-ons, so the file is signed by Mozilla. It is not
listed in their store — the download stays here.

**Then pair it.** Open Settings → Plugins → Browser clipper and press **Connect
browser**. Nothing can reach your notes until you do.

## How it works

The extension has no filesystem access and makes no network requests. It talks to
the Moldavite binary through the browser's native-messaging channel: the browser
starts the binary on demand, so **Moldavite does not have to be running** to
clip.

Two operations exist, and both are write-side:

```jsonc
// → { "op": "forges" }
// ← { "ok": true, "forges": ["Default", "Work"], "active": "Default" }
// → { "op": "clip", "forge": "Default", "title": "…", "url": "https://…",
//     "markdown": "…" }
// ← { "ok": true, "path": "notes/Clippings/How Cloudflare handles TLS.md" }
```

There is no way to read a note through this channel — not the contents, not the
list. `forges` returns Forge names only, which any process on your machine could
already read off the filesystem, and the popup cannot offer a destination it
cannot name.

**Connect browser** writes a native-messaging host manifest naming the exact
extension ID allowed to connect. The browser enforces that pin.

| Browser | macOS / Linux                                                                                                         | Windows                                                          |
| ------- | --------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| Chrome  | `~/Library/Application Support/Google/Chrome/NativeMessagingHosts/` · `~/.config/google-chrome/NativeMessagingHosts/` | `HKCU\Software\Google\Chrome\NativeMessagingHosts`               |
| Edge    | `~/Library/Application Support/Microsoft Edge/NativeMessagingHosts/`                                                  | `HKCU\Software\Microsoft\Edge\NativeMessagingHosts`              |
| Brave   | `~/Library/Application Support/BraveSoftware/Brave-Browser/NativeMessagingHosts/`                                     | `HKCU\Software\BraveSoftware\Brave-Browser\NativeMessagingHosts` |
| Firefox | `~/Library/Application Support/Mozilla/NativeMessagingHosts/` · `~/.mozilla/native-messaging-hosts/`                  | `HKCU\Software\Mozilla\NativeMessagingHosts`                     |

**Disconnect** removes them.

## When something goes wrong

**"Moldavite isn't connected yet."** The host manifest is missing for that
browser. Open Settings → Plugins and press **Connect browser**, then reload the
extension. If you installed the extension after pairing, pair again — the
manifest is only written for browsers that were present at the time.

**It worked, then stopped after an update or a move.** The manifest holds an
absolute path to the Moldavite binary. Launching the app rewrites a stale path
for browsers you have already paired, so opening Moldavite once is usually the
whole fix.

**The clip is full of navigation, or missing most of the article.** The extension
uses Mozilla's Readability, the engine behind Firefox Reader View, and falls back
to the whole page body when it finds no article. App-shell pages and dashboards
are the cases where the fallback shows.

**"This page is too large to clip."** Above 5 MB of Markdown the clip is refused
rather than truncated.

## Building it yourself

```bash
cd extension
npm install
npm test        # conversion and popup, in jsdom — no browser needed
npm run build   # dist/chrome and dist/firefox
```

Chrome derives the extension ID from `extension/key.pem`, which is gitignored.
The host manifest pins the ID derived from it, so building with a different key
produces an extension the paired manifest will refuse.

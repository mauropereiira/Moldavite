# Publishing the clipper to the Chrome Web Store

Everything the listing asks for, and the one step that is easy to get wrong.

## Build the package

```sh
cd extension
npm ci
npm test
npm run build
(cd dist/chrome-store && zip -r ../../moldavite-clipper-chrome-store.zip .)
```

Upload `moldavite-clipper-chrome-store.zip`, **not** `moldavite-clipper-chrome.zip`.

The two differ by one manifest key. The unpacked build keeps `key`, which pins
the extension id that the desktop app allows in its native-messaging host
manifest. The store build drops it, because the store signs the package with its
own key and Chrome refuses to install one whose `key` implies a different id
than it was signed under. Uploading the unpacked build produces a rejected item.

A release also attaches both zips, so you can take the store one from there.

## The id step, which breaks clipping if skipped

The store assigns its own extension id, and it will not match the unpacked one.
The desktop app only opens the native-messaging bridge to ids it knows, so until
its list includes the store id, **the store build installs cleanly and then fails
to clip with no useful error.**

After the item is created, the dashboard shows its id. Add it to
`CHROME_EXTENSION_IDS` in `src-tauri/src/commands/browser_bridge.rs`:

```rust
pub(crate) const CHROME_EXTENSION_IDS: &[&str] = &[
    "dgidmimgcpmanonfbijebppdmfhnhhem", // unpacked, from extension/key.pem
    "ngdbcbhchiifacekdkjpjbjmegkeodig", // Chrome Web Store
];
```

Both ids are in place as of the first upload, so this step is done unless the
item is ever recreated, which assigns a new one.

Both stay listed, so a contributor running unpacked and a user on the store
build both work. The manifest test asserts every listed id reaches
`allowed_origins`, so a forgotten entry fails CI rather than shipping.

Ship an app release containing that change **before**, or at the same time as,
publishing the store item. A user who installs from the store while the app
still pins only the unpacked id gets a clipper that cannot reach Moldavite.

## Listing copy

**Name.** Moldavite Clipper

**Summary**, 132 characters maximum:

> Save the page you are reading as a Markdown note in your local Moldavite Forge.

**Description:**

> Moldavite Clipper saves the page you are reading into Moldavite as a clean
> Markdown note.
>
> Press the toolbar button, pick a Forge, and the article is converted to
> Markdown and written to notes/Clippings in that Forge, with its title and
> source URL kept in the note's frontmatter.
>
> The clipper talks to the Moldavite desktop app directly on your own machine,
> over the browser's native messaging channel. It makes no network requests of
> its own, and it is blocked from doing so by its own content security policy.
> Nothing is sent to a server, and there is no account to create.
>
> It needs Moldavite for desktop, and you connect the two once from
> Settings, then Plugins, then Connect browser. Until you do, the clipper
> cannot reach your notes at all.
>
> Requires the Moldavite desktop app: https://mauropereiira.github.io/Moldavite/

**Category.** Productivity. **Language.** English.

## Permission justifications

The review asks for one per permission. These are accurate; do not inflate them.

- **activeTab.** Read the page in the tab the user is on, and only after they
  open the clipper's popup on that tab. This is what gets converted to Markdown.
- **scripting.** Inject a single reader script into that tab to hand the popup
  the page's HTML. It runs on the active tab on an explicit click, never
  automatically and never in the background.
- **nativeMessaging.** Send the converted note to the Moldavite desktop app on
  the same machine. This is the only way the extension delivers a clip; it has
  no server.
- **No host permissions are requested.** The extension has no standing access to
  any site.

**Remote code.** No. Everything executed is in the package. The content security
policy is `script-src 'self'; object-src 'self'; connect-src 'none'`.

## Data usage disclosure

The form makes you tick categories and certify three things. The accurate
answers:

- **Does it collect user data?** The honest answer for this form is yes, because
  "website content" is being handled, even though none of it reaches a server.
  Tick **Website content**, and nothing else. Do not tick personally identifiable
  information, health, financial, authentication, personal communications,
  location, or web history.
- **What is handled.** When the user presses Clip, four things leave the browser
  and go to the Moldavite app on the same computer: the page title, the page
  URL, the Markdown converted from the page, and the name of the Forge the user
  picked. Nothing leaves at any other time.
- **Not being sold to third parties.** Certify. There is no third party.
- **Not being used or transferred for purposes unrelated to the single
  purpose.** Certify. The single purpose is saving a page as a note.
- **Not being used to determine creditworthiness or for lending.** Certify.

**Privacy policy URL.** `https://mauropereiira.github.io/Moldavite/privacy.html`

## Screenshots

Still to capture; the store needs at least one at 1280x800 or 640x400. Worth
having:

1. The popup open on an article, Forge dropdown visible.
2. The saved note open in Moldavite beside the original page.
3. Settings, then Plugins, showing Connect browser, since that step is the one
   people miss.

## Before submitting

- [ ] `npm test` passes in `extension/`.
- [ ] Load `dist/chrome-store` unpacked once and confirm the popup opens, the
      Forge list fills, and a clip lands. It will only clip if this machine's
      app already allows the unpacked id, so test with `dist/chrome` for the
      clip path and use the store build to confirm it loads and renders.
- [ ] Version in `extension/manifest.json` is higher than the published one.
      The store rejects a re-upload at the same version.
- [x] The store id is in `CHROME_EXTENSION_IDS`.
- [ ] An app release carrying that id is out, or goes out with the listing.
      Until then a store install cannot reach Moldavite.

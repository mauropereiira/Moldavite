# Moldavite on iOS

Status: in development on the `mobile/ios-spike` branch. The app builds,
installs and runs on the iPhone simulator from this repository through
Tauri 2's iOS target. Nothing has shipped; TestFlight and the App Store
come after the items under "Not done yet".

The React app and the Rust core are the same ones the desktop app uses.
The phone gets its own layout on top of them, and the parts of the desktop
app that cannot exist on a phone are compiled out.

## Building and running

Prerequisites on a Mac: Xcode with the iOS simulator runtime, the Rust
targets `aarch64-apple-ios` and `aarch64-apple-ios-sim`, CocoaPods
(`brew install cocoapods`; `tauri ios init` also installs `xcodegen` and
`libimobiledevice` through Homebrew), and Node 20 or 22.

```bash
rustup target add aarch64-apple-ios aarch64-apple-ios-sim
npx tauri ios dev "iPhone 17"       # build, install and launch with hot reload
cargo check --target aarch64-apple-ios-sim --lib   # fast compile check, from src-tauri
```

The first `tauri ios dev` takes about ten minutes (a full Rust compile for
the simulator, then Xcode); rebuilds are quick. The dev server must bind to
the address Tauri hands it, which `vite.config.ts` does through
`TAURI_DEV_HOST`.

The Xcode project lives in `src-tauri/gen/apple` and is tracked, except for
its build products (`Externals/`, `assets/`, `build/`, `Pods/`,
`xcuserdata/`). It is generated from `gen/apple/project.yml` by xcodegen:
after editing `project.yml`, run `xcodegen generate` inside `gen/apple`
before the next build. Do not run `tauri ios init` again; it would
overwrite `project.yml` and drop the widget target and the URL scheme.

The development team is set in `tauri.conf.json` under `bundle.iOS`. The
simulator needs no Apple Developer account; a device, TestFlight and the
iCloud container do.

## What is compiled out on iOS

Gated in `Cargo.toml` target sections and behind `cfg(desktop)`:

- `tauri-plugin-updater`, `tauri-plugin-process`, `tauri-plugin-window-state`
  and `tauri-plugin-single-instance` (the App Store owns updates; a phone
  has no window geometry or second instance).
- `fastembed` and the ONNX runtime. `build.rs` emits a `semantic_runtime`
  cfg for the targets that carry it (everything except Intel macOS, iOS and
  Android), and `semantic.rs` gates on that cfg. Keyword search stays.
- The browser clipper bridge (`commands/browser_bridge.rs`), the clipper
  manifest refresh, and the Forge file watcher. `notify` has no FSEvents on
  iOS and polls, which reported the app's own writes as external edits;
  the iCloud work brings a proper watcher.
- The Swift EventKit bridge is linked only when the build target is macOS
  (`build.rs` checks `CARGO_CFG_TARGET_OS`; the `cfg` attribute alone tests
  the host).

Capabilities are split: `capabilities/default.json` is desktop-only through
`platforms`, and `capabilities/mobile.json` carries the same permissions
without the plugins that do not exist on mobile. Mobile omits JavaScript shell
permissions. Its public privacy/support links use `open_support_page`, an
enum-restricted command that calls the shell plugin's native Rust opener. The
JavaScript shell opener takes a desktop code path and fails on iOS. Both public
links live in Settings → About.

Mobile Agenda always shows the month calendar for daily/weekly note navigation.
The external-event panel, its legend entry and its Features settings are
desktop-only. A saved desktop preference cannot hide the mobile note calendar.

Settings hides on the phone: the Forges folder picker and Open Forge in
Finder (General), the icon rail toggle, Index and Agenda modes, writing
column width and the asteroid cursor (Layout), and the AI & Agents and
Import, Plugins and Calendar connection sections entirely. About omits the
desktop updater, and the editor omits WordPress publishing and PDF export.

## Plugins on iOS

Third-party plugins are excluded from the first iOS release. The desktop system
loads executable JavaScript from Forge folders; that distribution model needs
a separate mobile design under [App Review guideline 2.5.2](https://developer.apple.com/app-store/review/guidelines/#software-requirements).
The mobile host refuses to load plugins even if a synced Forge carries desktop
consent. Plugin installation links are ignored and plugin IPC commands are
desktop-only.

## Forge location on iOS

iOS moves the app's data container on every reinstall and update, so an
absolute path persisted last week names a directory that no longer exists.
`paths.rs` therefore derives the Forges root from the current container's
`Documents/Moldavite` on iOS and ignores the persisted `forges_root`;
`set_forges_root` refuses on iOS. The keyword index directory is keyed by
the Forge path hash, so a reinstall starts a fresh index; it rebuilds by
itself.

## Onboarding

iOS uses a three-step Welcome, local Forge and touch-navigation tour. It uses
the app-container Forge without offering a directory picker or desktop AI
features. Replaying onboarding covers the rail and open pages so it cannot
get trapped underneath Index.

## Phone and iPad layout

- `src/lib/platform.ts` decides phone versus desktop from the user agent
  (iPadOS reports itself as a Mac, so touch points decide that case).
  `main.tsx` stamps the answer on `<html data-platform>`, and `index.css`
  defines a Tailwind `mobile:` variant on it.
- `src/mobile.css` holds every phone style, scoped to
  `html[data-platform='mobile']`, with `--safe-top`, `--safe-bottom` and
  `--touch-target` tokens. `index.html` sets `viewport-fit=cover`.
- The icon rail is the navigation. Index, Search, Agenda, Graph, Timeline
  and Settings are full-screen pages, closed with their × or by tapping
  their rail button again. Home (the M) is the welcome screen.
  `Layout.tsx` keeps phone Index and Agenda in overlay
  mode. On iPad windows at least 700px wide, a 280px Index sits beside the editor;
  narrower windows return to page navigation without closing the current note.
- Settings (`SettingsModal.tsx`) is a two-level page on the phone: the
  section list, then one section with a back control. The section lives in
  `settingsStore.settingsSection` so the rail's Settings button can walk
  back: a section returns to the list, the list closes Settings.
- The editor footer has Menu on the left and Actions on the right. The note
  runs the full width of the paper with 16px gutters; the note header sits
  on the rail's rhythm. An empty note offers one View templates button; the
  template picker opens as a page beside the rail.
- `useVisualViewportHeight` keeps `--app-height` equal to the visual
  viewport so the software keyboard never covers the editor, and scrolls
  the page back to the top when WKWebView drags it under the status bar to
  make room for the caret. After the shell shrinks, it also reveals a focused
  dialog field inside its scroll container. Long dialog titles wrap, and their
  actions remain reachable above the keyboard.
- Focus traps focus the page container on a phone rather than the first
  button, so no close control wears a focus ring after a tap. The global
  `!important` hover fill in `index.css` sticks after a tap on a touch
  screen; `mobile.css` neutralises it for text controls under
  `(hover: none)`.
- Dialog scrims start at the rail's edge (the rail paints above them). A
  page keeps the transform from its entry animation, so a fixed scrim inside
  a page is positioned against the page and gets `left: 0` instead.
- Segmented controls with four or more options become a one-per-row list.
- `tauri-plugin-mobile-ui` follows the system's preferred body-text scale while
  retaining Cream's fonts. Large text stacks segmented controls and Index footer
  links, and lets labels wrap. Settings navigation grows up to 200%; body text
  follows the full accessibility range. Expanded sidebar sections have no fixed
  height ceiling that could hide larger text or long lists.
- The same native plugin applies Light, Dark or System to the iOS window, keeping
  the status bar, keyboard and native dialogs consistent with the app appearance.

## Mobile editing

The formatting row appears when editing a note and stays available until Done,
including with a hardware or floating keyboard. It sits at the bottom of the
visual-viewport shell above the software keyboard, with Bold, Italic, heading,
lists, tasks, wiki links, tags, links, images, undo and redo. The controls scroll
horizontally; Done remains visible. The desktop selection popup and footer stay
out of the editing row. Keeping the row present across focus changes is
necessary on WebKit: hiding it immediately on editor blur removes the tapped
button before its click can run.

Tauri disables the native input accessory view. Text fields elsewhere get a
Done row, with room reserved in the shell while the keyboard is open. Mobile
CSS loads before the first mobile render and is not requested on desktop.

Verified on the iPhone 17 simulator: native word selection, applying Bold via
the formatting row, the resulting `**works**` on disk, and Done restoring the
footer. Software-keyboard placement was visually checked. Physical-device
selection/autocorrect and the remaining formatting/image workflows still need
verification.

## Deep links and the widget

`moldavite://today` is a new route in `deep_link.rs`; the frontend handler
in `usePluginDeepLinks` closes every page and opens today's daily note. The
`moldavite` scheme is registered for iOS through `CFBundleURLTypes` in
`gen/apple/project.yml` (the deep-link plugin registers schemes itself on
desktop only).

The home screen widget is a WidgetKit extension in `src-tauri/ios/Widget`
(target `MoldaviteWidget`, bundle `app.moldavite.widget`, iOS 17 or later),
declared in `project.yml` and embedded by the app target. Small and medium
families show the monogram (drawn as a SwiftUI path from `monogram.svg`),
the day and month, and the weekday; the timeline refreshes at midnight; the
whole widget links to `moldavite://today`. Widgets cannot take typed input,
so the tap is the interaction.

## Working with the simulator

- `xcrun simctl io booted screenshot out.png` for a picture;
  `xcrun simctl openurl booted moldavite://today` to test the deep link.
- `idb` (`brew install facebook/fb/idb-companion`, `pipx install fb-idb`)
  taps and types on the simulator without Accessibility permission:
  `idb ui tap <x> <y>` in points, `idb ui text "..."`. On the iPhone 17 a
  screenshot pixel is a third of a point.
- The simulator connects the Mac keyboard by default, which hides the
  software keyboard but still shows its accessory bar. Turn it off with
  `defaults write com.apple.iphonesimulator ConnectHardwareKeyboard -bool false`
  and restart the Simulator app.
- Do not `pkill -f vite` to stop the dev server: the pattern also matches
  `moldavite` and kills the desktop app. Use the port or the
  `tauri ios dev` pattern.

The release verification checklist is [MOBILE_QA.md](MOBILE_QA.md).
The account setup, signing, privacy/encryption answers, TestFlight and upload
handoff are in [IOS_APP_STORE.md](IOS_APP_STORE.md). The guide marks remaining
release work explicitly; it is not a claim that this branch is ready to upload.

## Native document exports

Settings ZIP, encrypted backup and JSON exports, individual Markdown/plaintext
notes, and selected-note ZIP archives use `tauri-plugin-document-export`
on iOS. Rust creates a complete file in a private cache directory, then the
[native document picker](https://developer.apple.com/documentation/uikit/uidocumentpickerviewcontroller/init(forexporting:ascopy:))
copies it to the user's selected location. A Rust guard removes the staging
directory after success, cancellation or failure. No arbitrary file path is
accepted from JavaScript by this plugin. Desktop still selects a destination
before writing. Mobile note exports flush pending autosave first; Markdown keeps
frontmatter, and selection ZIPs keep full relative paths so same-named notes in
different folders stay distinct. The backend rejects locked or invalid sources.
Use a note’s Options → Select note, then tap additional notes to select them;
the selection bar opens the ZIP export dialog. Mobile PDF export is excluded.

Do not use `dialog.save()` followed by a Rust write on iOS. With the currently
locked dialog plugin, this exports an empty placeholder and returns a cache
copy, leaving the Files destination empty.

## iCloud bridge in development

`src-tauri/.taurignore` excludes Swift `.build` products and generated `.tauri`
plugin API packages from the native dev
watcher. Keep source files watched; without this exclusion, Swift compilation
can trigger repeated app rebuilds. See [Tauri's development watcher](https://v2.tauri.app/develop/).

`src-tauri/plugins/tauri-plugin-icloud` is an iOS-only native Tauri plugin.
It resolves `iCloud.app.moldavite` off the main thread, requests placeholder
downloads, reports download/upload/conflict state and sends an initial metadata
snapshot followed by `NSMetadataQuery` changes over a Rust-owned channel. An
account change stops the query and invalidates access through the old container.
The generated entitlements and Info.plist declare the public Moldavite Documents
container, with nested folders visible in Files once provisioned.

Settings and Manage Forges now expose a separate **Synced Forge (iCloud Drive)**
on Apple devices. Connecting waits for an account-bound initial metadata snapshot
before changing the active Forge. Local Forge selection and storage stay intact;
a failed connection leaves the current selection unchanged. An unavailable active
cloud root returns an error, never a local fallback. Mac discovery opens the app's
public `~/Library/Mobile Documents/iCloud~app~moldavite/Documents` container.

Metadata names are merged with local note and folder listings, including pending
notes, locked notes and empty remote directories. Completed downloads trigger
existing open-buffer reconciliation; own writes are suppressed using the existing
content fingerprint. Session checks reject stale-account callbacks and prevent
metadata-only names from being overwritten as new files.

**Sync is still in development.** Coordinated access for remaining content
operations, cross-Forge moves, OS-managed conflict versions and account-backed
round-trip/offline verification remain. Existing downloaded contents are intended
to remain usable offline with the normal conflict-copy policy on save; that
account-backed behavior has not yet been proven.

The Foundation-only core has filesystem regression tests runnable without an
iCloud account:

```sh
swift test --package-path src-tauri/plugins/tauri-plugin-icloud/ios/Core
```

They cover placeholder vs empty-file handling, unknown download state, account
invalidation and path/symlink containment. They do not prove iCloud delivery.
The native `coordination::read/write` boundary holds [Apple file coordination](https://developer.apple.com/documentation/technologyoverviews/shared-data)
while a synchronous Rust callback checks and changes a file. Callers must run on
a worker thread, validate the returned path and download readiness inside the
callback, and keep conflict detection, preservation and atomic replacement in
one write accessor. The normal note reader and complete hash/conflict/save path
use the cloud-aware accessors: local files stay direct, while ubiquitous files
receive coordination and download checks. Pending or unknown contents return an
error and request a download; failed existing-note reads cannot become an empty
save base. The account-bound session also guards metadata-only remote names. Remaining
mutations and OS-managed conflict versions still need integration.

Note lock/unlock, rename/move, direct deletion and folder creation/move/rename/
deletion now use a single native transaction for all participating paths. This
keeps readiness checks, destination checks and the filesystem change inside one
coordination accessor. Folder moves/deletes also check pending metadata descendants.
Normal saves reserve the locked counterpart so an undownloaded lock cannot become
a new plaintext note. Locked notes, and folders containing them, must be unlocked
before moving or renaming because encryption authenticates the original path.
Trash/restore, imports, conflict-copy destinations and other content operations
are not yet covered by this transaction integration.

The read/write IPC handlers run, including their replies, on Tauri's blocking
pool on Apple targets. Do not replace this with `command(async)`: concurrent
startup replies can occupy all Tokio workers waiting for WebKit's main thread,
while the iOS dev asset proxy on main waits for the same runtime. The simulator
exposed that deadlock during this integration.

On macOS, `cargo test --lib file_coordination` exercises the same Swift/Rust
boundary: competing writes wait, a replacement preserves the prior content,
and errors or panics release access. These local tests do not prove cloud conflict
resolution. The public
container keys follow [Apple's Info.plist reference](https://developer.apple.com/library/archive/documentation/General/Reference/InfoPlistKeyReference/Articles/CocoaKeys.html).

## Not done yet

- Finish synced-Forge mutation coordination, cross-Forge moves and account-backed
  verification. Selection and metadata listing are connected; a local, unsynced
  Forge on the phone stays the default.
- Note content in the widget (needs an App Group), a Lock Screen widget.
- A run on a real iPhone: selection handles and autocorrect in the editor.
- iPad layout, then Android through Tauri's Android target.

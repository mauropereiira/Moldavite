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
without the plugins that do not exist on mobile.

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

## Phone layout

- `src/lib/platform.ts` decides phone versus desktop from the user agent
  (iPadOS reports itself as a Mac, so touch points decide that case).
  `main.tsx` stamps the answer on `<html data-platform>`, and `index.css`
  defines a Tailwind `mobile:` variant on it.
- `src/mobile.css` holds every phone style, scoped to
  `html[data-platform='mobile']`, with `--safe-top`, `--safe-bottom` and
  `--touch-target` tokens. `index.html` sets `viewport-fit=cover`.
- The icon rail is the navigation. Index, Search, Agenda, Graph, Timeline
  and Settings are full-screen pages, closed with their × or by tapping
  their rail button again. Home (the M) is the welcome screen. `App.tsx`
  forces Index and Agenda into overlay mode on a phone.
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
  make room for the caret.
- Focus traps focus the page container on a phone rather than the first
  button, so no close control wears a focus ring after a tap. The global
  `!important` hover fill in `index.css` sticks after a tap on a touch
  screen; `mobile.css` neutralises it for text controls under
  `(hover: none)`.
- Dialog scrims start at the rail's edge (the rail paints above them). A
  page keeps the transform from its entry animation, so a fixed scrim inside
  a page is positioned against the page and gets `left: 0` instead.
- Segmented controls with four or more options become a one-per-row list.

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

## Not done yet

- The synced Forge: the app's iCloud Drive container as a Forge, read on
  the Mac like any other folder, with `NSMetadataQuery` for change and
  download notifications. A local, unsynced Forge on the phone stays the
  default.
- A formatting bar above the keyboard, and hiding the keyboard's accessory
  bar.
- Note content in the widget (needs an App Group), a Lock Screen widget.
- A run on a real iPhone: selection handles and autocorrect in the editor.
- iPad layout, then Android through Tauri's Android target.

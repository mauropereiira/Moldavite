# iOS release verification

This is a working checklist, not a release approval. The iOS app remains in
development. Verification below was performed on 2026-09-05 using an iPhone 17
simulator running iOS 26.5. No physical-device or iCloud-account test has been
completed.

## Verified so far

- The three-step mobile onboarding uses the local app-container Forge and
  finishes without invoking a folder picker or advertising desktop AI features.
  Replaying it stays above an open Index page. The desktop flow retains its
  original steps. Regression tests cover both flows.
- Home, Index, two-level Settings, Appearance, About and a daily note were
  inspected on the simulator. This is not yet an exhaustive screen audit.
- Index title/search and the Settings heading now start beneath the system
  clock on the iPhone 17. Index was inspected in light and dark mode after the
  44pt rail and shared phone page inset change. Other device sizes and rotation
  still need verification; iOS owns the clock's position.
- The editor formatting row was inspected in Cream light and dark themes.
  Software-keyboard placement was inspected with the native accessory removed.
- Native word selection followed by tapping Bold retained the selected word and
  wrote `**works**` to the simulator's daily Markdown file. Done restored the
  ordinary editor footer. Automated tests exercise actual TipTap selection,
  formatting and task commands, plus persistence of the touch target across blur.
- The desktop selection toolbar and the floating Menu no longer overlap the
  mobile formatting row.
- Plugin loading refuses to read or execute a mobile Forge's plugin files even
  if desktop consent exists. Plugin command handlers and backend execution
  modules are desktop-only. A regression test covers the consent case.
- The widget's version and build number now match the containing app in the
  generated plist. The native build previously warned about that mismatch.
- The iOS iCloud bridge compiles and links into the simulator app; local Forge
  navigation still works. Four Foundation tests cover placeholder/empty-file
  distinction, unknown download state, path containment and account invalidation.
  No account-backed container, metadata notification or download has been proved.
- Mobile Agenda was inspected without the desktop event panel or Events legend.
  Its regression test also covers a saved desktop preference hiding the calendar
  and verifies that mobile does not request calendar permissions.
- Settings → About → Privacy policy opens the published page in Safari through
  the native opener. The earlier JavaScript shell call failed on iOS. The
  published policy still describes the desktop app and must be updated before
  the iOS release.
- Settings → About → Support opens the public GitHub issues page in Safari.
- Three macOS tests exercise the native file-coordination boundary from Rust:
  whole-accessor serialization, content preservation before replacement and
  releasing access after errors/panics. Forge content I/O does not use it yet.

## Required before shipping

| Area | Remaining proof |
| --- | --- |
| Navigation and dialogs | Every page and dialog, light and dark, portrait and landscape, keyboard open and closed, 44pt targets, no hover-only actions |
| Editor | Long-note caret scrolling, autocorrect and selection on a physical iPhone, image photo picker, wiki links, tags, tasks, locking, undo/redo and formatting beyond Bold |
| Lifecycle | Autosave before background/suspension, relaunch, interrupted Forge switches, no loss of pending edits |
| Data portability | Verify exports and encrypted backups contain real bytes at the selected destination; Tauri's iOS save dialog initially exports an empty placeholder before Rust writes the data |
| iPad | Two-column Index/editor layout, rotation and split view, hardware shortcuts, floating keyboard |
| iCloud implementation | Native bridge and container declarations exist; optional synced Forge selection, coordinated Rust content access, metadata reconciliation, desktop discovery and cross-Forge moves remain |
| Sync proof | iPhone/iPad/Mac round-trip, offline edits, simultaneous edit conflict copies, interrupted and pending downloads, account unavailability |
| Brand and distribution | Icon and launch screen inspection, status-bar/heading alignment, widget behavior, privacy declaration, encryption export answers, signed archive and TestFlight, complete App Store setup and upload instructions |
| Desktop compatibility | Final frontend and Rust gates; platform-specific runtime checks where available |

## Final command gates

Run these against the final release candidate; earlier green runs do not cover
subsequent changes.

```sh
npx tsc --noEmit
npm run lint -- --max-warnings 16
npm test
npm run build && node scripts/check-bundle-size.mjs
npm run check:tokens
cd src-tauri
cargo fmt --check
cargo clippy --lib --all-targets -- -D warnings
cargo test --lib
cargo check --target aarch64-apple-ios-sim --lib
```

Use Node 20 or 22. The frontend tests, typecheck, lint, token check, production
build and bundle limits have passed during the initial revision. The desktop
Rust lint and 439 Rust tests have passed. The simulator compile succeeds with
12 unused-code warnings in mobile-excluded functionality.

## Simulator automation notes

After shutting down and booting a simulator, an existing `idb_companion` can
accept taps without delivering them to the new simulator process. Reconnect it;
if the same companion is stale, stop that exact companion PID and reconnect.
Do not kill app processes using a broad name pattern.

`idb ui text` uses hardware-keyboard input and can leave the software keyboard
hidden. Check the screenshot rather than assuming the keyboard is visible.
The formatting row remains usable in that state. Native builds reinstall and
relaunch the app; wait for deployment to settle before interpreting an ignored
tap or deep link as an app bug.

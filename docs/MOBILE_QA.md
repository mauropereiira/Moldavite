# iOS release verification

This is a working checklist, not a release approval. The iOS app remains in
development. Verification below was performed on 2026-09-05–06 using an iPhone 17
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
- A tapped link in a note opens the intended page in Safari through the native
  mobile command. Web and mail schemes are checked again in Rust; unsupported
  schemes are rejected. The desktop opener remains covered by editor tests.
- The desktop release-notes popup and its About entry are absent on mobile.
- Swift `.build` products are excluded from Tauri's dev watcher. The previous
  rebuild loop stopped after restarting the dev session with `.taurignore`.
- Three macOS tests exercise the native file-coordination boundary from Rust:
  whole-accessor serialization, content preservation before replacement and
  releasing access after errors/panics. The note reader and complete conflict/save path now use the cloud-aware boundary; the remaining content operations still need integration.
- Settings ZIP export was reproduced as a zero-byte file in On My iPhone.
  The replacement builds the complete payload before the native document picker
  copies it. The destination ZIP now contains all three simulator notes with
  their original text; the settings JSON destination parses correctly. Save and
  Cancel both release and remove staging files. Rust tests restore the staged
  encrypted backup and cover cleanup after failed generation. The encrypted
  picker/import round-trip still needs runtime verification.

- Individual Markdown and plaintext notes save through the native Files picker.
  The destination Markdown retained custom frontmatter and its complete body;
  the text file contained the stripped text. A two-note selection ZIP retained
  `notes/QA export nested/Proof.md` and `notes/Untitled (2).md` and both bodies.
  Selection starts in Options and additional notes toggle with an ordinary tap.
  The long Options menu now stays below the status bar; modal action buttons
  have a 44pt minimum. Regression tests cover pending-edit refusal, nested paths,
  metadata, locked sources and desktop selection behavior.

- Manage Forges shows local device storage and hides the desktop root picker on
  iOS. Its dialog fits beside the rail, with 44pt buttons; the editor footer
  controls now have the same minimum. Dark portrait layout inspected.

- Rust tests drive a synthetic `.icloud` placeholder through the actual note
  reader/save functions: neither an empty read nor an overwrite is allowed.
  After local bytes replace the marker, reads and conflict copies preserve the
  downloaded body and frontmatter. Invalid UTF-8/read failures also refuse saves.
  Daily and weekly navigation tests keep the current editor and show the error.
  On the simulator, a synthetic pending daily note showed the download error
  without leaving Home. Replacing its marker with local contents made the note
  readable; typing appended text that was verified on disk. The owned fixture
  was removed afterward. Startup remained responsive after the IPC dispatch fix.
  The footer Actions button measured 60×44pt through accessibility inspection.
  These fixtures do not prove account-backed iCloud delivery.

## Required before shipping

| Area | Remaining proof |
| --- | --- |
| Navigation and dialogs | Every page and dialog, light and dark, portrait and landscape, keyboard open and closed, 44pt targets, no hover-only actions |
| Editor | Long-note caret scrolling, autocorrect and selection on a physical iPhone, image photo picker, wiki links, tags, tasks, locking, undo/redo and formatting beyond Bold |
| Lifecycle | Autosave before background/suspension, relaunch, interrupted Forge switches, no loss of pending edits |
| Data portability | Encrypted export/import, plain import, other Files providers and interruption tests remain. Settings ZIP/JSON, individual Markdown/plaintext and selected-note ZIP destinations are verified in On My iPhone |
| iPad | Two-column Index/editor layout, rotation and split view, hardware shortcuts, floating keyboard |
| iCloud implementation | Native bridge, Apple Forge selection, metadata listings and Mac discovery are connected; coordinated access for remaining mutations, cross-Forge moves and account-backed proof remain |
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

### Synced Forge selection, 6 September 2026

- iPhone 17 simulator: the separate iCloud control appears in General Settings
  and Manage Forges. Native accessibility frames measure 52 x 44pt in Settings
  and 52 x 45pt in the dialog. Light Settings and dark Manage Forges were checked.
- With no usable iCloud account, connecting displays the native unavailable error
  inline, keeps the switch off and retains the local Default Forge. Its three
  existing test notes remain present; persisted `active_synced_forge` stays false.
- Regression coverage includes separate storage IDs for a same-named local Forge,
  unsaved-edit refusal, unavailable-account errors inside dialogs, stale native
  callbacks, remote-only notes/locks and empty nested folder metadata.
- No account-backed delivery, offline round-trip, cloud collision or physical
  device test is implied by these checks. Remaining sync work is listed above.

### Locking and coordinated mutations, 6 September 2026

- iPhone 17 simulator: locking removes the plaintext file, temporary unlock
  displays the original text, and permanent unlock restores the exact original
  bytes. The separate existing notes remain unchanged.
- Rust/Swift regression tests cover multi-path reservation, concurrent access,
  absent destinations, pending locks and destinations, error/panic cleanup, and
  pending folder descendants. Locked-note and containing-folder move attempts
  retain their original ciphertext and path. Context-menu tests exclude locked,
  daily and weekly notes from Move to Folder.
- These checks exercise local coordination and synthetic placeholders. They do
  not prove account-backed iCloud delivery or cover trash/restore transactions.

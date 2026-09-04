# Moldavite — Project Status

**Last Updated:** September 4, 2026
**Status:** Shipping on macOS, and on Windows and Linux in beta, with in-app auto-update since v1.3.1

> Keep this file honest: update it whenever a feature ships, changes, or a
> real bug is found (see "Documentation Maintenance" in CLAUDE.md).

## What's Shipped and Working

### Notes & Editing

- A note is renamed from its own title in the editor: Enter commits, Escape abandons, an empty name is refused, and a failed rename restores the previous name so the page never shows a name the file does not have. Daily and weekly notes stay read-only because they are named by date. The context-menu and more-options rename paths still work and now agree with this field rather than owning it.

- Daily notes (auto-created per day, auto-deleted when emptied — media-only content counts as content), weekly notes, standalone notes with folders
- TipTap rich-text editor: headings, lists, task lists, images (resizable), highlights, alignment, code, links; recognizable raw Markdown pastes as formatted content; slash commands; tabs with pinning
- Wiki-links `[[Note]]` / `[[Display|target]]` with existence styling, backlinks panel, backlinks sidebar section, and a deterministic force-directed graph whose linked components cluster while orphans stay peripheral
- Standalone note rename UI in the sidebar and editor; open state follows the new path and inbound wiki-links are rewritten vault-wide (v1.6). Unicode-safe NFC slugs are shared by frontend + backend (v1.5)
- `#tags` with sidebar aggregation and global tag rename
- Sidebar ordering: A–Z, Z–A, or Manual — drag a note onto another to place it, and drag a folder onto a sibling to reorder folders. The arrangement is stored per Forge as an ordered id list, so an unplaced note joins the end of its list rather than displacing anything. Daily notes are excluded by design
- Templates (defaults + custom JSON) with `{{date}}`/`{{time}}`/`{{day_of_week}}`; default daily/weekly templates
- Quick switcher / command palette (⌘P on macOS, Ctrl+P on Windows and Linux), backend full-text search with snippets, timeline view; opening any note yields transient Timeline/Graph views so navigation cannot remain hidden behind them
- Local semantic search (v1.6; requires Apple Silicon on macOS, while Intel Macs get keyword search): opt-in per-Forge embeddings index with a curated three-model picker (all-MiniLM-L6-v2 is the default; BGE small English v1.5 and Multilingual E5 small are available). Consent names the active model and download size; model changes trigger a full re-index with live progress. Fully offline afterwards; locked notes are never indexed. Sidebar Keyword/Semantic search mode chip, "Related" notes section under the editor, Settings → AI & Agents toggle + rebuild-index button

### Navigation & Welcome

- Pinned notes sit in a bar across the whole app, above the icon rail and index. Four stay on the bar and the rest collapse behind a count; drag or `alt`+arrow reorders them. Pins are the same list the Quick Switcher shows, so a note cannot be pinned in one surface and not the other. Opening a pinned note focuses the tab it is already in rather than opening a second copy.

- The icon-rail monogram is Home: pending edits flush before it closes the active Index / Agenda / Search / Graph / Timeline surface and clears the active note, while every open tab remains available to resume
- The welcome night sky offers a persisted, default-on asteroid cursor with weighted pointer lag, a three-dot trail, interactive-control feedback, and a single click impact ring. Settings → Layout can disable it; reduced-motion and coarse-pointer media preferences prevent it from mounting or hiding the native cursor

### Storage & Data Safety

- Real Markdown on disk with YAML frontmatter (color + extensible keys); legacy HTML-bodied files still readable
- **Atomic writes everywhere** (temp + fsync + rename), with bounded retries when Windows temporarily blocks a replace. Owner-only `0600` permissions are applied before the file becomes visible **on Unix**; on Windows the file inherits its directory's ACLs and no explicit owner-only guarantee is made
- Portable note and folder name validation blocks Windows device names, illegal characters, trailing dots, and drive-relative paths before they can discard or hide data
- Folder-relative note addressing (fixed folder-note round-trip data bug) — v1.5
- **External-edit conflict safety** (v1.6): saves send the content hash from the last read; if the disk copy diverged (sync tool, other editor), the disk version is preserved as a `<name> (conflict YYYY-MM-DD HHMM).md` copy before the save, with a warning toast + list refresh
- Forge file watcher: external changes refresh the note list live (self-writes suppressed); the Forge switcher refreshes while open so externally created Forges appear without a relaunch
- Trash with 7-day retention, restore, previews; multiple Forges (vaults) with per-Forge state
- Note locking (AES-256-GCM + Argon2id, 64 MiB for new locks with older formats still readable, rate-limited unlock, auto-lock); encrypted vault backups; settings JSON export/import
- Import/export: Markdown, PDF, plaintext, bulk export, encrypted archive
- Obsidian vault importer (v1.7): Settings → Import performs a read-only analysis, then copies supported daily notes, standalone notes with sanitized folder structure, converted wiki-link aliases, verbatim YAML frontmatter, and referenced attachments into a new Forge. Name collisions are suffixed deterministically; hidden items, `.trash`, Canvas files, symlinks, unreferenced attachments, and unresolved embeds are skipped or warned in the final report.
- Agent-ready Forge (v1.6): Settings → AI & Agents writes `AGENTS.md` + `.gitignore` to the Forge root via a hard-whitelisted backend command (exactly those two filenames), with confirm-overwrite and existence indicator
- Built-in MCP stdio server (v1.6): the single app binary switches to headless MCP mode with the exact `--mcp` flag, defaults to the active Forge (`--forge <name>` override), exposes four read tools plus three explicitly gated write tools, validates all client paths, refuses locked notes, and uses atomic writes + semantic-index change hooks. Reads return a content hash that write tools can use to preserve a changed disk version as a conflict copy

### Platform

- Windows is a beta release target. Every PR runs clippy and the Rust library test suite on `windows-latest`; no Windows runtime journey has been exercised manually, so Windows coverage is CI-backed and the platform stays beta until it is not
- Linux is a beta release target: an AppImage (any distribution, carries the updater) and a deb (Debian and Ubuntu, no in-app updater), built by the release workflow and proven by a `build-linux` job on every PR that asserts the exact artifact names the release verification requires. The crate has compiled and tested on `ubuntu-latest` since CI existed. No Linux runtime journey has been exercised by hand. Both bundles need glibc 2.38 or newer (Ubuntu 24.04, Debian 13, Fedora 39 or later) because the ONNX Runtime binary fastembed ships is built against it; the deb declares `libc6 (>= 2.38)` so apt refuses cleanly on older systems, and the AppImage needs `libfuse2` where the distribution does not ship it
- Calendar in right panel + timeline, read-only, from two sources: Apple (EventKit, permission-gated, macOS only) and Google (Calendar API v3 over PKCE loopback OAuth, all platforms, refresh token in the OS credential store). Per-source failures are reported without blanking the other source; Google needs `MOLDAVITE_GOOGLE_CLIENT_ID`/`_SECRET` at build time or it reports unavailable
- macOS builds are signed and notarized. Windows installers are unsigned and may trigger SmartScreen because they are not Authenticode-signed. Linux bundles are unsigned as well; Linux has no equivalent warning. Updater artifacts are signed for every platform, including Windows, and clients verify them before installation. Checks run about 15 seconds after launch, every 24 hours while open, and on focus after 24 hours without a successful check, and can be switched off in Settings → About (manual checks still work); automatic network/404 failures stay silent and retry, while pending versions add accent dots to Settings and About plus the existing install action. Manual checks retain explicit errors, and completed upgrades show the CHANGELOG-backed "What's New" popup (see docs/RELEASING.md)
- Themes/presets, platform-specific keyboard shortcut labels and overlay (⌘? on macOS, Ctrl+? on Windows and Linux), settings modal with focus trap
- Window size and position are restored between launches

### Browser clipper

- Chrome/Edge/Brave and Firefox extension in `extension/`, distributed from the repository rather than the stores: Chrome requires Developer mode and Load unpacked, Firefox requires an AMO-signed unlisted XPI. Readability extracts the article, Turndown converts it, images and styling are dropped and links are absolutised
- Reaches the app over native messaging, so the browser starts the binary on demand and clipping works with Moldavite closed. Two write-side operations (`forges`, `clip`) and no note read of any kind; the host manifest pins the exact extension ID and is written only by an explicit Connect in Settings → Plugins, then rewritten on launch if the binary has moved

### Plugins (v2 — v1 shipped 1.4.0, sandbox hardened 1.5.0, v2 shipped 1.6.0)

- API v2: commands/editor/toasts plus trusted host-rendered prompt forms, permissioned unlocked-note metadata + Markdown reads, host-performed HTTPS behind manifest and individually revocable user-approved exact hosts, and per-plugin OS credential-store secrets; API v1 remains compatible
- Per-Forge enable state; permission sheet shows human-readable capabilities, manifest hosts, and runtime hosts with per-host revoke; manifest consent remains pinned to SHA-256 of raw manifest + code while runtime host consent is stored app-side
- Every successful in-app install opens a themed manifest-sourced setup guide; an ⓘ action on each installed card reopens its description, commands, instructions, and permissions at any time
- Explicit-use community browser: Settings fetches the public GitHub registry only after **Browse community plugins** is clicked, rejects malformed entries, constructs downloads only under the pinned raw-repository base, and sends both files to Rust for SHA-256 verification plus staged/atomic install. The website directory filters by name/description/author/permission with a static fallback and offers `moldavite://plugin/<id>` install links; strict queued routing handles cold and running app delivery, opens/highlights the registry entry, and requires a permission-visible confirmation. Installed versions are labeled; replacement requires update confirmation; plugins stay disabled until the existing consent flow is completed
- Plugin source is read, hashed and returned in one backend call, so the bytes that run are the bytes the user consented to; the `plugin://` scheme no longer serves executable source, which also closes cross-plugin imports. Path traversal and symlinked plugin directories are rejected; `withGlobalTauri` off
- `ui.prompt` requires the `ui` permission and command registration requires `commands` — both put something in front of the user under Moldavite's own chrome, and a plugin that declared nothing could previously ask for a vault password in a host-styled dialog
- Per-plugin sandboxed Web Worker has no DOM, network globals, or Tauri IPC; curated postMessage RPC permissions are enforced host-side
- Author guide: docs/PLUGINS.md
- Bundled first-party Publish to WordPress reference plugin: Application Password verification, draft create/update keyed by Forge-relative note path, self-hosted and WordPress.com Jetpack/Atomic support. WordPress.com Simple sites cannot use Application Passwords and are covered instead by the built-in publisher below, which is why the plugin's limitation is no longer the product's.
- Built-in WordPress.com publishing (not a plugin): editor-footer button, authorization-code OAuth over the `moldavite://oauth/wordpress` custom scheme with a state check and a 10-minute window, token in the OS credential store, account-wide `global` scope because no narrower WordPress.com scope spans sites, site list filtered to `publish_posts`, and draft create/update keyed per `siteId:notePath`. The button is absent, not disabled, in a build without credentials.

## Test & Quality Status

- Frontend: vitest covers stores, libraries, hooks, update scheduling/error modes, graph layout, transient-view navigation, Obsidian import, deep-link routing, external-write reconciliation, calendar store migration, and plugin RPC/manifest/registry/UI
- Backend: cargo tests cover the stress suite, Obsidian conversion/path safety, conflict copies, semantic indexing, MCP, plugin install/hash/secret validation, strict deep-link routing, Windows path and persistence behavior, and calendar source dispatch / PKCE / Google response mapping
- Linux, Windows and macOS CI run clippy with warnings denied and the Rust library test suite on every PR, and Windows and Linux also run a full installer build; `npm audit` (production dependencies) and `cargo audit` run on every PR too
- Bundle budget enforced via `npm run check:size`
- ESLint: 0 errors, 16 pre-existing warnings (set-state-in-effect patterns in modals; tracked below)

## Known Issues / Debt

- **Search scales linearly** — live WalkDir scan per query; fine to ~1k notes. Planned: persistent incremental index (would also speed backlinks + previews).
- **Plugin API has no note writes or panels yet** — v2 adds note reads, trusted prompt forms, dynamically approved exact-host HTTPS, and OS credential-store secrets while keeping the Worker boundary narrow.
- All note metadata held in memory (no pagination); startup daily-note scan capped at 8 concurrent reads but still O(vault age).
- ESLint set-state-in-effect warnings in ImageModal/LinkModal/SlashCommandList et al. — cosmetic, no user impact observed.
- No automatic scheduled backups (manual + encrypted export exist).
- No multi-window support.
- **`Editor.tsx`'s tests mock `useKeyboardShortcuts` wholesale** — which is how ⌘N stayed wired to an empty function unnoticed until a user reported it. The mock now records the options it is handed so the wiring itself can be asserted, but most of the component is still only reachable through mocks.
- **Self-write suppression is a 500ms timing window** ([#39](https://github.com/mauropereiira/Moldavite/issues/39)) — a slow disk can make the app read its own save as an external change.
- **Two stress tests assert a wall-clock budget** ([#44](https://github.com/mauropereiira/Moldavite/issues/44)) — they can flake under CI load.
- **Google Calendar is not brand-verified yet** — consent shows the unverified-app interstitial and there is a 100-user cap until Google completes review.

## Roadmap (in priority order)

1. **Google brand verification** — needs the now-live `privacy.html`, a homepage, and a Search Console-verified authorized domain. Removes the unverified-app warning and the 100-user cap.
2. **Plugin UI/write extensions** — build on the shipped Worker/RPC boundary and v2 read/network/secrets surface with conflict-safe note writes and narrow panel slots.
3. **Persistent search index** — incremental, on-disk; unlocks instant search, better snippets, cheaper backlinks.
4. **Automatic local backups** — scheduled snapshots of the Forge with retention (fits the local-first/no-cloud identity).
5. ~~**Conflict-safe MCP writes**~~ — Done: reads can return a content hash and writes preserve a changed disk version as a conflict copy.
6. ~~**Note rename UI**~~ — Done (v1.6): sidebar/editor rename keeps tabs, recents, colors, selection, and backlinks synchronized while the backend safely rewrites inbound links.
7. ~~External-edit conflict handling beyond the file-watcher refresh.~~ Done (v1.6): conflict copies preserve both versions on divergent saves.

## Explicit Non-Goals

Staying a _note app_: no canvas/whiteboard, no hosting or publishing service of our own, no database views in core. The plugin system is the extension point for the long tail.

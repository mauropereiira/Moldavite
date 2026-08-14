# Moldavite — Project Status

**Last Updated:** August 14, 2026
**Status:** Shipping on macOS and Windows, with in-app auto-update since v1.3.1

> Keep this file honest: update it whenever a feature ships, changes, or a
> real bug is found (see "Documentation Maintenance" in CLAUDE.md).

## What's Shipped and Working

### Notes & Editing
- Daily notes (auto-created per day, auto-deleted when emptied — media-only content counts as content), weekly notes, standalone notes with folders
- TipTap rich-text editor: headings, lists, task lists, images (resizable), highlights, alignment, code, links; recognizable raw Markdown pastes as formatted content; slash commands; tabs with pinning
- Wiki-links `[[Note]]` / `[[Display|target]]` with existence styling, backlinks panel, backlinks sidebar section, and a deterministic force-directed graph whose linked components cluster while orphans stay peripheral
- Standalone note rename UI in the sidebar and editor; open state follows the new path and inbound wiki-links are rewritten vault-wide (v1.6). Unicode-safe NFC slugs are shared by frontend + backend (v1.5)
- `#tags` with sidebar aggregation and global tag rename
- Templates (defaults + custom JSON) with `{{date}}`/`{{time}}`/`{{day_of_week}}`; default daily/weekly templates
- Quick switcher / command palette (⌘P on macOS, Ctrl+P on Windows), backend full-text search with snippets, timeline view; opening any note yields transient Timeline/Graph views so navigation cannot remain hidden behind them
- Local semantic search (v1.6; requires Apple Silicon on macOS, while Intel Macs get keyword search): opt-in per-Forge embeddings index with a curated three-model picker (all-MiniLM-L6-v2 is the default; BGE small English v1.5 and Multilingual E5 small are available). Consent names the active model and download size; model changes trigger a full re-index with live progress. Fully offline afterwards; locked notes are never indexed. Sidebar Keyword/Semantic search mode chip, "Related" notes section under the editor, Settings → AI & Agents toggle + rebuild-index button

### Storage & Data Safety
- Real Markdown on disk with YAML frontmatter (color + extensible keys); legacy HTML-bodied files still readable
- **Atomic writes everywhere** (temp + fsync + rename; 0600 before visibility), with bounded retries when Windows temporarily blocks a replace
- Portable note and folder name validation blocks Windows device names, illegal characters, trailing dots, and drive-relative paths before they can discard or hide data
- Folder-relative note addressing (fixed folder-note round-trip data bug) — v1.5
- **External-edit conflict safety** (v1.6): saves send the content hash from the last read; if the disk copy diverged (sync tool, other editor), the disk version is preserved as a `<name> (conflict YYYY-MM-DD HHMM).md` copy before the save, with a warning toast + list refresh
- Forge file watcher: external changes refresh the note list live (self-writes suppressed); the Forge switcher refreshes while open so externally created Forges appear without a relaunch
- Trash with 7-day retention, restore, previews; multiple Forges (vaults) with per-Forge state
- Note locking (AES-256-GCM + Argon2, rate-limited unlock, auto-lock); encrypted vault backups; settings JSON export/import
- Import/export: Markdown, PDF, plaintext, bulk export, encrypted archive
- Obsidian vault importer (v1.7): Settings → Import performs a read-only analysis, then copies supported daily notes, standalone notes with sanitized folder structure, converted wiki-link aliases, verbatim YAML frontmatter, and referenced attachments into a new Forge. Name collisions are suffixed deterministically; hidden items, `.trash`, Canvas files, symlinks, unreferenced attachments, and unresolved embeds are skipped or warned in the final report.
- Agent-ready Forge (v1.6): Settings → AI & Agents writes `AGENTS.md` + `.gitignore` to the Forge root via a hard-whitelisted backend command (exactly those two filenames), with confirm-overwrite and existence indicator
- Built-in MCP stdio server (v1.6): the single app binary switches to headless MCP mode with the exact `--mcp` flag, defaults to the active Forge (`--forge <name>` override), exposes four read tools plus three explicitly gated write tools, validates all client paths, refuses locked notes, and uses atomic writes + semantic-index change hooks. Reads return a content hash that write tools can use to preserve a changed disk version as a conflict copy

### Platform
- Windows is a supported release target. Every PR runs clippy and the Rust library test suite on `windows-latest`; no Windows runtime journey has been exercised manually, so Windows coverage is CI-backed
- Calendar in right panel + timeline, read-only, from two sources: Apple (EventKit, permission-gated, macOS only) and Google (Calendar API v3 over PKCE loopback OAuth, all platforms, refresh token in the OS credential store). Per-source failures are reported without blanking the other source; Google needs `MOLDAVITE_GOOGLE_CLIENT_ID`/`_SECRET` at build time or it reports unavailable
- macOS builds are signed and notarized. Windows installers are unsigned and may trigger SmartScreen because they are not Authenticode-signed. Updater artifacts are signed for every platform, including Windows, and clients verify them before installation. Checks run about 15 seconds after launch, every 24 hours while open, and on focus after 24 hours without a successful check; automatic network/404 failures stay silent and retry, while pending versions add accent dots to Settings and About plus the existing install action. Manual checks retain explicit errors, and completed upgrades show the CHANGELOG-backed "What's New" popup (see docs/RELEASING.md)
- Themes/presets, platform-specific keyboard shortcut labels and overlay (⌘? on macOS, Ctrl+? on Windows), settings modal with focus trap

### Plugins (v2 — v1 shipped 1.4.0, sandbox hardened 1.5.0, v2 shipped 1.6.0)
- API v2: commands/editor/toasts plus trusted host-rendered prompt forms, permissioned unlocked-note metadata + Markdown reads, host-performed HTTPS behind manifest and individually revocable user-approved exact hosts, and per-plugin OS credential-store secrets; API v1 remains compatible
- Per-Forge enable state; permission sheet shows human-readable capabilities, manifest hosts, and runtime hosts with per-host revoke; manifest consent remains pinned to SHA-256 of raw manifest + code while runtime host consent is stored app-side
- Every successful in-app install opens a themed manifest-sourced setup guide; an ⓘ action on each installed card reopens its description, commands, instructions, and permissions at any time
- Explicit-use community browser: Settings fetches the public GitHub registry only after **Browse community plugins** is clicked, rejects malformed entries, constructs downloads only under the pinned raw-repository base, and sends both files to Rust for SHA-256 verification plus staged/atomic install. The website directory filters by name/description/author/permission with a static fallback and offers `moldavite://plugin/<id>` install links; strict queued routing handles cold and running app delivery, opens/highlights the registry entry, and requires a permission-visible confirmation. Installed versions are labeled; replacement requires update confirmation; plugins stay disabled until the existing consent flow is completed
- `plugin://` scheme loader with path-traversal rejection; `withGlobalTauri` off; shell:open scoped to https
- Per-plugin sandboxed Web Worker has no DOM, network globals, or Tauri IPC; curated postMessage RPC permissions are enforced host-side
- Author guide: docs/PLUGINS.md
- Bundled first-party Publish to WordPress reference plugin: Application Password verification, draft create/update keyed by Forge-relative note path, self-hosted and WordPress.com Jetpack/Atomic support; WordPress.com Simple OAuth is an explicit limitation

## Test & Quality Status
- Frontend: vitest covers stores, libraries, hooks, update scheduling/error modes, graph layout, transient-view navigation, Obsidian import, deep-link routing, external-write reconciliation, calendar store migration, and plugin RPC/manifest/registry/UI
- Backend: cargo tests cover the stress suite, Obsidian conversion/path safety, conflict copies, semantic indexing, MCP, plugin install/hash/secret validation, strict deep-link routing, Windows path and persistence behavior, and calendar source dispatch / PKCE / Google response mapping
- Windows CI runs clippy with warnings denied and the Rust library test suite on every PR
- Bundle budget enforced via `npm run check:size`
- ESLint: 0 errors, 16 pre-existing warnings (set-state-in-effect patterns in modals; tracked below)

## Known Issues / Debt
- **Search scales linearly** — live WalkDir scan per query; fine to ~1k notes. Planned: persistent incremental index (would also speed backlinks + previews).
- **Plugin API has no note writes or panels yet** — v2 adds note reads, trusted prompt forms, dynamically approved exact-host HTTPS, and OS credential-store secrets while keeping the Worker boundary narrow.
- All note metadata held in memory (no pagination); startup daily-note scan capped at 8 concurrent reads but still O(vault age).
- ESLint set-state-in-effect warnings in ImageModal/LinkModal/SlashCommandList et al. — cosmetic, no user impact observed.
- No automatic scheduled backups (manual + encrypted export exist).
- No multi-window support.
- **`Editor.tsx` has no test harness** ([#38](https://github.com/mauropereiira/Moldavite/issues/38)) — the only significant component without one.
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
Staying a *note app*: no canvas/whiteboard, no publish service, no database views in core. The plugin system is the extension point for the long tail.

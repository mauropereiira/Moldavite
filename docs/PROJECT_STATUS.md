# Moldavite — Project Status

**Last Updated:** July 13, 2026 (v1.5.1 + unreleased)
**Status:** Shipping — signed/notarized releases with in-app auto-update since v1.3.1

> Keep this file honest: update it whenever a feature ships, changes, or a
> real bug is found (see "Documentation Maintenance" in CLAUDE.md).

## What's Shipped and Working

### Notes & Editing
- Daily notes (auto-created per day, auto-deleted when emptied — media-only content counts as content), weekly notes, standalone notes with folders
- TipTap rich-text editor: headings, lists, task lists, images (resizable), highlights, alignment, code, links; slash commands; tabs with pinning
- Wiki-links `[[Note]]` / `[[Display|target]]` with existence styling, backlinks panel, backlinks sidebar section, and a deterministic force-directed graph whose linked components cluster while orphans stay peripheral
- Standalone note rename UI in the sidebar and editor; open state follows the new path and inbound wiki-links are rewritten vault-wide (unreleased). Unicode-safe NFC slugs are shared by frontend + backend (v1.5)
- `#tags` with sidebar aggregation and global tag rename
- Templates (defaults + custom JSON) with `{{date}}`/`{{time}}`/`{{day_of_week}}`; default daily/weekly templates
- Quick switcher / command palette (⌘P), backend full-text search with snippets, timeline view; opening any note yields transient Timeline/Graph views so navigation cannot remain hidden behind them
- Local semantic search (unreleased): opt-in per-Forge embeddings index with a curated three-model picker (all-MiniLM-L6-v2 is the default; BGE small English v1.5 and Multilingual E5 small are available). Consent names the active model and download size; model changes trigger a full re-index with live progress. Fully offline afterwards; locked notes are never indexed. Sidebar Keyword/Semantic search mode chip, "Related" notes section under the editor, Settings → AI & Agents toggle + rebuild-index button

### Storage & Data Safety
- Real Markdown on disk with YAML frontmatter (color + extensible keys); legacy HTML-bodied files still readable
- **Atomic writes everywhere** (temp + fsync + rename; 0600 before visibility) — v1.5
- Folder-relative note addressing (fixed folder-note round-trip data bug) — v1.5
- **External-edit conflict safety** (unreleased): saves send the content hash from the last read; if the disk copy diverged (sync tool, other editor), the disk version is preserved as a `<name> (conflict YYYY-MM-DD HHMM).md` copy before the save, with a warning toast + list refresh
- Forge file watcher: external changes refresh the note list live (self-writes suppressed)
- Trash with 7-day retention, restore, previews; multiple Forges (vaults) with per-Forge state
- Note locking (AES-256-GCM + Argon2, rate-limited unlock, auto-lock); encrypted vault backups; settings JSON export/import
- Import/export: Markdown, PDF, plaintext, bulk export, encrypted archive
- Agent-ready Forge (unreleased): Settings → AI & Agents writes `AGENTS.md` + `.gitignore` to the Forge root via a hard-whitelisted backend command (exactly those two filenames), with confirm-overwrite and existence indicator
- Built-in MCP stdio server (unreleased): the single app binary switches to headless MCP mode with the exact `--mcp` flag, defaults to the active Forge (`--forge <name>` override), exposes four read tools plus three explicitly gated write tools, validates all client paths, refuses locked notes, and uses atomic writes + semantic-index change hooks

### Platform
- Apple Calendar (EventKit, read-only, permission-gated) in right panel + timeline
- Signed + notarized releases, minisign-verified auto-updates, "What's New" popup from CHANGELOG (see docs/RELEASING.md)
- Themes/presets, keyboard shortcut overlay (⌘?), settings modal with focus trap

### Plugins (v2 — v1 shipped 1.4.0, sandbox hardened 1.5.0, v2 unreleased)
- API v2: commands/editor/toasts plus trusted host-rendered prompt forms, permissioned unlocked-note metadata + Markdown reads, host-performed HTTPS behind manifest and individually revocable user-approved exact hosts, and per-plugin macOS Keychain secrets; API v1 remains compatible
- Per-Forge enable state; permission sheet shows human-readable capabilities, manifest hosts, and runtime hosts with per-host revoke; manifest consent remains pinned to SHA-256 of raw manifest + code while runtime host consent is stored app-side
- Every successful in-app install opens a themed manifest-sourced setup guide; an ⓘ action on each installed card reopens its description, commands, instructions, and permissions at any time
- Explicit-use community browser: Settings fetches the public GitHub registry only after **Browse community plugins** is clicked, rejects malformed entries, constructs downloads only under the pinned raw-repository base, and sends both files to Rust for SHA-256 verification plus staged/atomic install. The website directory filters by name/description/author/permission with a static fallback and offers `moldavite://plugin/<id>` install links; strict queued routing handles cold and running app delivery, opens/highlights the registry entry, and requires a permission-visible confirmation. Installed versions are labeled; replacement requires update confirmation; plugins stay disabled until the existing consent flow is completed
- `plugin://` scheme loader with path-traversal rejection; `withGlobalTauri` off; shell:open scoped to https
- Per-plugin sandboxed Web Worker has no DOM, network globals, or Tauri IPC; curated postMessage RPC permissions are enforced host-side
- Author guide: docs/PLUGINS.md
- Bundled first-party Publish to WordPress reference plugin: Application Password verification, draft create/update keyed by Forge-relative note path, self-hosted and WordPress.com Jetpack/Atomic support; WordPress.com Simple OAuth is an explicit limitation

## Test & Quality Status
- Frontend: vitest — 241 tests across 38 files (stores, lib, hooks, graph layout, transient-view navigation, deep-link routing, plugin RPC/manifest/registry/UI)
- Backend: cargo test — 178 tests incl. stress suite, conflict-copy, semantic-index, MCP, plugin install/hash/secret validation, and strict deep-link routing suites
- Bundle budget enforced via `npm run check:size` (within budget as of v1.5.0)
- ESLint: 0 errors, ~22 pre-existing warnings (set-state-in-effect patterns in modals; tracked below)

## Known Issues / Debt
- **Search scales linearly** — live WalkDir scan per query; fine to ~1k notes. Planned: persistent incremental index (would also speed backlinks + previews).
- **Plugin API has no note writes or panels yet** — v2 adds note reads, trusted prompt forms, dynamically approved exact-host HTTPS, and Keychain secrets while keeping the Worker boundary narrow.
- All note metadata held in memory (no pagination); startup daily-note scan capped at 8 concurrent reads but still O(vault age).
- ESLint set-state-in-effect warnings in ImageModal/LinkModal/SlashCommandList et al. — cosmetic, no user impact observed.
- No automatic scheduled backups (manual + encrypted export exist).
- No multi-window support.

## Roadmap (in priority order)
1. **Plugin UI/write extensions** — build on the shipped Worker/RPC boundary and v2 read/network/secrets surface with conflict-safe note writes and narrow panel slots.
2. **Persistent search index** — incremental, on-disk; unlocks instant search, better snippets, cheaper backlinks.
3. **Automatic local backups** — scheduled snapshots of the Forge with retention (fits the local-first/no-cloud identity).
4. ~~**Note rename UI**~~ — Done (unreleased): sidebar/editor rename keeps tabs, recents, colors, selection, and backlinks synchronized while the backend safely rewrites inbound links.
5. ~~External-edit conflict handling beyond the file-watcher refresh.~~ Done (unreleased): conflict copies preserve both versions on divergent saves.

## Explicit Non-Goals
Staying a *note app*: no canvas/whiteboard, no publish service, no database views in core. The plugin system is the extension point for the long tail.

# Moldavite — Project Status

**Last Updated:** July 12, 2026 (v1.5.1 + unreleased)
**Status:** Shipping — signed/notarized releases with in-app auto-update since v1.3.1

> Keep this file honest: update it whenever a feature ships, changes, or a
> real bug is found (see "Documentation Maintenance" in CLAUDE.md).

## What's Shipped and Working

### Notes & Editing
- Daily notes (auto-created per day, auto-deleted when emptied — media-only content counts as content), weekly notes, standalone notes with folders
- TipTap rich-text editor: headings, lists, task lists, images (resizable), highlights, alignment, code, links; slash commands; tabs with pinning
- Wiki-links `[[Note]]` / `[[Display|target]]` with existence styling, backlinks panel, backlinks sidebar section, graph view (intentionally minimal)
- Rename rewrites inbound wiki-links vault-wide (v1.5); unicode-safe NFC slugs shared by frontend + backend (v1.5)
- `#tags` with sidebar aggregation and global tag rename
- Templates (defaults + custom JSON) with `{{date}}`/`{{time}}`/`{{day_of_week}}`; default daily/weekly templates
- Quick switcher / command palette (⌘P), backend full-text search with snippets, timeline view
- Local semantic search (unreleased): opt-in per-Forge embeddings index (all-MiniLM-L6-v2; one-time ~97 MB HuggingFace download after explicit consent, fully offline afterwards, locked notes never indexed). Sidebar Keyword/Semantic search mode chip, "Related" notes section under the editor, Settings → AI & Agents toggle with live download/index progress + rebuild-index button

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

### Platform
- Apple Calendar (EventKit, read-only, permission-gated) in right panel + timeline
- Signed + notarized releases, minisign-verified auto-updates, "What's New" popup from CHANGELOG (see docs/RELEASING.md)
- Themes/presets, keyboard shortcut overlay (⌘?), settings modal with focus trap

### Plugins (v1 — shipped 1.4.0, hardened 1.5.0)
- Commands-only API (`api.commands.add`, `api.editor.getActiveNote/insertText`, `api.ui.toast`)
- Per-Forge enable state; permission sheet; consent pinned to SHA-256 content hash (any code change re-prompts)
- `plugin://` scheme loader with path-traversal rejection; `withGlobalTauri` off; shell:open scoped to https
- Author guide: docs/PLUGINS.md

## Test & Quality Status
- Frontend: vitest — 124 tests across 22 files (stores, lib, hooks)
- Backend: cargo test — 134 tests incl. stress suite (1k-note search, concurrent atomic writes, link-rewrite corpus), conflict-copy and semantic-index suites
- Bundle budget enforced via `npm run check:size` (within budget as of v1.5.0)
- ESLint: 0 errors, ~22 pre-existing warnings (set-state-in-effect patterns in modals; tracked below)

## Known Issues / Debt
- **Search scales linearly** — live WalkDir scan per query; fine to ~1k notes. Planned: persistent incremental index (would also speed backlinks + previews).
- **Plugin API surface is still v1 (commands-only)** — the Worker sandbox + postMessage RPC shipped in v1.5.0; next is growing the API (note read/write, fetch allowlist, panels).
- All note metadata held in memory (no pagination); startup daily-note scan capped at 8 concurrent reads but still O(vault age).
- ESLint set-state-in-effect warnings in ImageModal/LinkModal/SlashCommandList et al. — cosmetic, no user impact observed.
- No automatic scheduled backups (manual + encrypted export exist).
- No multi-window support.

## Roadmap (in priority order)
1. **Plugin sandbox v2** — Worker isolation + RPC so permissions become a real boundary; then grow the API surface (note read/write, fetch allowlist, panels).
2. **Persistent search index** — incremental, on-disk; unlocks instant search, better snippets, cheaper backlinks.
3. **Automatic local backups** — scheduled snapshots of the Forge with retention (fits the local-first/no-cloud identity).
4. **Note rename UI** — backend now rewrites links safely; expose rename in the sidebar/editor.
5. ~~External-edit conflict handling beyond the file-watcher refresh.~~ Done (unreleased): conflict copies preserve both versions on divergent saves.

## Explicit Non-Goals
Staying a *note app*: no canvas/whiteboard, no publish service, no database views in core. The plugin system is the extension point for the long tail.

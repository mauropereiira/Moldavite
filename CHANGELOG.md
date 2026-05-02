# Changelog

All notable changes to Moldavite are documented here.

## [1.3.1] - 2026-05-02

### Fixed
- **Pinned tabs survive sidebar navigation** — clicking another note in the sidebar while a pinned tab is active now opens the new note in a fresh tab instead of replacing the pinned one.

### Added
- **Settings → Plugins tab** — informational surface promoting community-built integrations. Status banner ("design phase"), starter ideas (Zoom / Meet / Web Clipper / custom exports), and CTAs linking to `docs/PLUGINS_DESIGN.md` + the issues tracker. No loader yet — sets expectations and invites contributions.

## [1.3.0] - 2026-05-02

### Added
- **Multiple Forges** — sibling vault directories you can switch between (Obsidian-style). New sidebar dropdown above the search bar lists all Forges; "Manage Forges…" lets you create/rename/delete. Each Forge has its own pinned/recent state (localStorage namespaced per-Forge). Existing single-Forge users auto-migrate on first launch — content wraps into a `Default/` Forge in place. New IPC: `list_forges`, `create_forge`, `set_active_forge`, `rename_forge`, `delete_forge`, `set_forges_root`, `get_forges_root_path`. QuickSwitcher gains a "Switch Forge…" action.
- **Settings tab navigation** — the modal now has a left tab list instead of a long vertical scroll. Up/Down/Home/End keyboard nav, full ARIA tablist semantics.
- **Plugins design doc** — `docs/PLUGINS_DESIGN.md` records the intended shape for an Obsidian-style plugin system (no implementation yet — design only).

### Fixed
- **Right sidebar resizing** — calendar grid now shrinks gracefully instead of clipping when the sidebar narrows; timeline + month-switch buttons remain visible at minimum width.
- **Theme preset / dark base mode mismatch** — picking a light-only preset (Sepia) while in dark mode no longer leaves the editor with a black background and Sepia chrome. The applied preset auto-falls back to default when the picked preset doesn't cover the active base mode; the user's preference stays stored.
- **Settings → Templates** — section was rendering see-through under non-default presets due to hardcoded Tailwind grays. Now uses theme tokens (`var(--bg-*)`, `var(--text-*)`).

### Changed
- File watcher restarts cleanly on Forge switch (drops old watcher, spawns a new one rooted at the new active Forge, clears the self-write ignore-list).

## [1.2.0] - 2026-05-01

### Added
- **Forge** — Moldavite's note storage is now first-class for external tools.
  - YAML frontmatter on every note (currently `color`; schema is extensible — unknown keys round-trip cleanly).
  - One-shot, idempotent migration moves the legacy `.note-metadata.json` sidecar into per-file frontmatter.
  - Live file watcher (`notify` v6 + 300 ms debounce) emits a `forge:changed` event so external edits show up live; self-write echoes are suppressed.
  - New `rescan_forge` command (Settings → General button) re-runs the directory scan and rebuilds the in-memory backlinks index.
  - New `open_forge_in_finder` command and Settings button.
  - Public docs at `docs/FORGE.md` describing directory layout, frontmatter schema, wiki-link syntax, locked-file caveat.
- **Theme presets** — Solarized, Dracula, Nord, Sepia, Gruvbox alongside the default Moldavite palette. `<html>` carries a `data-theme` attribute beside the existing `dark` class so Tailwind `dark:` selectors keep working. Settings → Appearance picker shows preset cards with swatches.
- **QuickSwitcher upgrades** — action commands (Open Settings, Toggle Timeline, Toggle Theme, Open Graph, etc.), recent searches (last 5, persisted), pinned notes (hover star), section headers, refreshed keyboard footer.
- **First-run onboarding modal** — 3 steps (Welcome → pick your Forge → quick tour). Re-trigger from Settings → About.
- **PDF export options** — page size (Letter / A4 / Legal) and margins (Narrow / Normal / Wide), persisted last-used choice.
- **Plaintext export** — markdown-stripped `.txt` output from editor overflow menu and sidebar context menu.
- **Bulk export** — Export… button on the bulk-action bar; select Markdown / Plaintext / PDF + a destination folder, one file per note.
- **Empty-state polish** — `NoBacklinks`, `EmptyTrash`, `EmptyGraph` variants; consistent empty UI across the sidebar, graph view, and trash popover.

### Changed
- App-level a11y pass on Graph view, BulkActionBar, SidebarFooter, and Settings sections (dialog roles, focus management, `aria-label`s, `aria-hidden` on decorative icons, `role="switch"` on toggles).
- Bundle raw budget raised to 460 KB to accommodate v1.2 features (gzip cap unchanged at 120 KB; gzipped size ≈ 111 KB).

### Removed
- Sidecar `.note-metadata.json` is replaced by frontmatter; the file is renamed to `.note-metadata.json.migrated` after migration so it can be inspected/reverted manually if needed.

## [1.1.0] - 2026-04-23

### Added
- **Full-text search** across notes with ranked content matches and snippets
  (new `search_notes_content` Tauri command, powered by `walkdir` + regex).
  Locked notes and trashed notes are excluded from results.
- **Sidebar redesign**: dedicated sections for Search, Notes (standalone),
  Folders, Daily, and Tags, with a footer containing [Today / New] and
  [Settings / Trash] actions.
- **Trash popover** with read-only preview of deleted notes (Tiptap editor in
  `editable: false` mode, markdown rendered through `markdown-it` + DOMPurify).
  Restore sends a note back to the live list; permanent delete is one click.
- **Folder tree with drag-and-drop**: move notes between folders and reorganise
  the hierarchy from the sidebar.
- **Timeline view**: chronological feed of all notes bucketed by Today /
  Yesterday / This Week / This Month / Earlier, with macOS EventKit
  integration surfacing calendar events alongside notes.
- **Backlinks panel** below the editor showing every note that links to the
  current one.
- **PDF export** from the editor overflow menu (hardened via the existing
  `write_binary_file` command).
- **Shortcut help modal** (`⌘/Ctrl + ?`) listing every keyboard shortcut,
  driven by a new central `shortcuts.ts` registry.
- **Custom template editor** under Settings → Templates.
- **Settings JSON export / import**: back up and restore your preferences,
  theme, folders and pinned tabs as a JSON file (new `export_settings_json` /
  `import_settings_json` Tauri commands, scoped to the `moldavite-*`
  `localStorage` keys — notes are not included).
- **NoteFile.modified_at** is now exposed to the frontend so non-daily notes
  can be bucketed by actual filesystem mtime in the timeline view.

### Fixed
- Empty-note template suggestion buttons no longer overlap the Settings / Trash
  popovers (z-index regression).

### Changed
- Added `walkdir = "2.5"` to the Rust dependency set for recursive content
  search.
- Added 7 new Rust unit tests covering the content-search command (case
  handling, ranking, trash/locked exclusion, `max_results`, folder path
  reporting).

## [1.0.3] - 2026-04-22

### Security
- **Path traversal hardening**: replaced weak `..` string checks with a strict
  `is_safe_filename` validator across every filesystem-touching Tauri command.
- **Symlink redirect protection**: `validate_path_within_base` now rejects any
  symlink component along the destination parent chain, preventing pre-placed
  symlinks from redirecting writes outside the notes directory.
- **Password zeroization**: unlock / lock / export / import paths now wrap
  plaintext passwords in `Zeroizing` so they are scrubbed from memory after use.
- **XSS sink removal**: eliminated `dangerouslySetInnerHTML` in search previews,
  hardened PDF export (DOMPurify + remote-image strip), and restricted Tiptap
  link protocols to `http`/`https`/`mailto` with `rel="noopener noreferrer nofollow"`.
- **Tighter CSP**: dropped wildcard `img-src https:`, removed third-party host
  allowances, added `form-action 'none'`.
- **Self-hosted fonts**: replaced Google Fonts CDN with `@fontsource/*` packages
  — no more third-party font requests at runtime.
- **PDF export hardening**: `write_binary_file` now canonicalizes, enforces the
  `.pdf` extension, and rejects dotfile directories.
- **Notes directory scope**: `set_notes_directory` canonicalizes before the
  forbidden-prefix check and restricts the destination to the current user's home.
- Added 11 Rust unit tests covering `is_safe_filename` and
  `validate_path_within_base` (including symlink redirect rejection).

### Changed
- Removed ~1000 lines of dead scaffolding (`src-tauri/src/commands/*`) that was
  never wired into the Tauri handler.
- Bumped Vite build target to `es2022` / `chrome110` / `safari15` for newer jspdf.
- Added CI workflow running ESLint + Vite build + `cargo clippy -D warnings`
  + `cargo test` on every PR.

### Fixed
- `useAutoLock` no longer violates React's purity rule — the last-activity
  timestamp is initialized inside the mount effect instead of during render.
- Corrected `mauropereiira/Moldavite` repository URL in `Cargo.toml` and
  `package.json` (was `mauropereira/moldavite`).

## [1.0.0] - 2025-01-21

### Changed
- **Rebranded to Moldavite** - Complete visual identity refresh
  - New name: Moldavite (from Notomattic)
  - New color palette inspired by Moldavite crystal
  - New icon and logo
  - Updated typography: DM Sans, Instrument Serif, Space Mono
  - Dark mode with cosmic space black theme
- **Open Source Release** - Now available at github.com/mauropereira/moldavite
- Data folder moved to `~/Documents/Moldavite/`

## [0.6.0] - 2025-01-20

### Added
- **PDF Export**: Right-click any note to export as PDF with styled formatting
- **Tag Management**: Right-click tags in sidebar to rename them across all notes
- **Template Picker Customization**: Pin up to 6 templates for quick access in "Start with a template"
- **Sort Options**: Toggle A-Z/Z-A sorting for notes in sidebar

### Fixed
- Search results now persist after selecting a note (no longer clears search)

## [0.5.0] - 2025-01-04

### Added
- **Open Source**: Now available under MIT license
- **Security Hardening**:
  - HTML sanitization to prevent XSS attacks
  - Brute-force protection with rate limiting for locked notes
  - Password strength requirements (8+ chars, uppercase, lowercase, number)
  - Secure memory handling with zeroization for sensitive data
  - Encrypted backup exports with password protection
  - Session auto-lock timeout (configurable 1-60 minutes)
- **Contributing Guidelines**: Added CONTRIBUTING.md for contributors
- **Code Documentation**: Added JSDoc comments throughout codebase

### Changed
- **Codebase Restructure**: Improved module organization for maintainability
  - Backend split into focused command modules
  - Added utility modules for shared functionality
  - Standardized barrel exports across frontend
- **Settings UI**: Cleaned up About section

### Fixed
- Repository URL typo in Cargo.toml

## [0.4.0] - 2025-01-04

### Added
- **Weekly Notes**: Click week numbers in the calendar to create/open weekly notes
  - Week numbers displayed on left side of calendar (ISO week numbering)
  - Weekly notes stored in `weekly/` directory with `YYYY-Www.md` format
  - Virtual until content added, auto-deleted if emptied
- **Editor Tabs**: Multiple notes can be open in tabs
  - Pin tabs (up to 5)
  - Drag to reorder tabs
- **Folder System**: Organize notes into folders
  - Create, rename, delete folders
  - Drag notes into folders
  - Move to folder modal
- **Trash System**: 7-day recovery for deleted notes
  - Restore notes from trash
  - Permanent delete option
  - Auto-cleanup after 7 days
- **Selection Toolbar**: Quick formatting toolbar appears on text selection
- **Editor Error Boundary**: Prevents app crashes from editor errors

### Fixed
- Editor Cmd+A crash bug resolved
- Selection state no longer persists across notes
- Line spacing preserved when switching notes

## [0.3.9] - 2025-12-19

### Fixed
- Template application now visually updates the editor immediately
- Added editor to useCallback dependencies for proper reactivity

## [0.3.2] - 2025-12-13

### Fixed
- Use Tauri shell plugin to open GitHub releases URL
- Replace auto-update with manual GitHub releases link (auto-updates were problematic)
- Show dynamic app version in sidebar
- Add GitHub to CSP for auto-updates

## [0.3.1] - 2025-12-11

### Added
- UI polish with boxy aesthetic and per-note colors
- Directory change feature - store notes wherever you want
- Export/import functionality for notes
- Auto-updates support (later replaced with manual updates)
- Note locking feature
- Privacy improvements

### Fixed
- Template modal fixes
- Calendar permissions handling
- Wiki link copy behavior - now copies partial wiki link to trigger autocomplete on paste
- Use single bracket for wiki link copy

## [0.1.1] - 2025-12-06

### Added
- Windows support (experimental)
- Automated multi-platform builds
- Apple code signing and notarization for macOS

### Fixed
- Cross-platform build errors
- Calendar features now macOS-only for compatibility

## [0.1.0] - 2025-12-05

### Added
- Initial release
- WYSIWYG rich text editor with TipTap
- Daily notes with automatic creation
- Wiki-style linking with `[[Note Name]]` syntax
- Native macOS calendar integration
- Dark mode with system preference sync
- Local-first storage - all notes stored privately on your device

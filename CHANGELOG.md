# Changelog

All notable changes to Moldavite are documented here.

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

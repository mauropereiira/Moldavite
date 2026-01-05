# Changelog

All notable changes to Notomattic are documented here.

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

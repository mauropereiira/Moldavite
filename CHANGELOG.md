# Changelog

All notable changes to Notomattic are documented here.

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

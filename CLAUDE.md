# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Development Commands

```bash
# Development
npm run tauri dev        # Run Tauri app with hot reload

# Building
npm run build            # Build frontend only (tsc + vite)
npm run tauri build      # Build production app (DMG + .app on macOS)

# Code Quality
npm run lint             # ESLint check for .ts/.tsx files
npm run lint:fix         # Auto-fix ESLint violations
npm run format           # Format with Prettier
npm run format:check     # Check Prettier formatting
```

**Prerequisites:** Node.js 18+, Rust 1.70+, Xcode Command Line Tools (macOS)

## Architecture

### 3-Layer Architecture

```
React/TypeScript (Frontend)
    ↓ Tauri IPC (invoke commands)
Rust Backend (src-tauri/src/lib.rs)
    ↓ Swift Bridge (src-tauri/src-swift/)
macOS Native APIs (EventKit for Calendar)
```

### Component Layout

The app uses a 3-column layout:
- **Sidebar** (left): Note list with daily and standalone notes
- **Editor** (center): TipTap rich text editor with toolbar
- **RightPanel** (right): Calendar view + Timeline with Apple Calendar events

### File Storage

Notes stored in `~/Documents/Notomattic/`:
```
daily/              # Daily notes (YYYY-MM-DD.md)
notes/              # Standalone notes
templates/          # Custom templates (JSON)
```

**Known Issue:** Files are stored as HTML with .md extension. Should be actual Markdown.

## Code Organization

```
src/
├── components/         # React components by feature
│   ├── calendar/      # Calendar and Timeline
│   ├── editor/        # TipTap editor + toolbar + extensions
│   ├── layout/        # Main layout and RightPanel
│   ├── sidebar/       # Note list sidebar
│   ├── templates/     # Template picker and editor
│   ├── settings/      # Settings modal
│   └── ui/            # Reusable UI components
├── hooks/             # useNotes, useAutoSave, useSearch, useTemplates
├── stores/            # Zustand stores (noteStore, themeStore, settingsStore, etc.)
├── lib/               # fileSystem.ts (Tauri wrappers), calendar.ts, templates.ts
└── types/             # TypeScript definitions

src-tauri/
├── src/lib.rs         # Main Tauri commands (~1400 lines - ALL backend logic)
├── src/calendar.rs    # EventKit Swift bridge
└── src-swift/         # Swift code for macOS Calendar integration
```

## Key Patterns

### Frontend-Backend Communication

```typescript
// Frontend (src/lib/fileSystem.ts)
import { invoke } from '@tauri-apps/api/core';
const notes = await invoke<NoteFile[]>('list_notes');

// Backend (src-tauri/src/lib.rs)
#[tauri::command]
fn list_notes() -> Result<Vec<NoteFile>, String> { ... }
```

### State Management

Zustand stores with localStorage persistence:
```typescript
export const useThemeStore = create<ThemeState>()(
  persist(
    (set) => ({ theme: 'system', setTheme: (theme) => set({ theme }) }),
    { name: 'notomattic-theme' }
  )
);
```

### Path Alias

`@/` maps to `src/` in imports.

### TipTap Editor

- Wiki-style links: `[[Note Name]]` or `[[Display|target-note]]`
- Auto-save: 1-second debounce via `useAutoSave.ts`
- Extensions: Bold, Italic, Underline, Strikethrough, Headings, Lists, Blockquotes, Code, Links, Images, Text alignment, Highlights

### Template Variables

- `{{date}}` - Current date (YYYY-MM-DD)
- `{{time}}` - Current time (HH:mm)
- `{{day_of_week}}` - Day name

## Design Documentation

Reference these files when modifying UI:
- `docs/DESIGN_SYSTEM.md` - Color system, typography, spacing
- `docs/COMPONENT_PATTERNS.md` - Reusable component patterns
- `docs/PROJECT_STATUS.md` - Feature status, bugs, roadmap

## Technical Debt

- No test suite configured
- Files stored as HTML with .md extension
- Minimal error handling (errors go to console, not user-facing)
- All notes loaded into memory (no pagination)

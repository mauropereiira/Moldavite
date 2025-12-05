# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**Notomattic v2** is a native macOS note-taking application with WYSIWYG editing, daily notes, calendar integration, and wiki-style linking.

**Tech Stack:**
- **Frontend:** React 19 + TypeScript 5.9 + Vite 7
- **Backend:** Tauri 2.9 (Rust) with Swift integration for native macOS features
- **Editor:** TipTap 3.10 (ProseMirror-based)
- **State:** Zustand 5.0 with localStorage persistence
- **Styling:** Tailwind CSS 4.1 with PostCSS

**Status:** Early Beta - Core MVP functional (see PROJECT_STATUS.md)

## Development Commands

```bash
# Development (recommended)
npm run tauri dev        # Run Tauri in development mode with hot reload

# Building
npm run build            # Build frontend only
npm run tauri build      # Build production Tauri app (DMG + .app)

# Preview
npm run preview          # Preview production build
```

**Note:** No test, lint, or format scripts are currently configured.

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

### File Storage Structure

Notes are stored in `~/Documents/Notomattic/`:
```
~/Documents/Notomattic/
├── daily/              # Daily notes (YYYY-MM-DD.md)
├── notes/              # Standalone notes
└── templates/          # Custom templates (JSON)
```

**Known Issue:** Files are currently stored as HTML with .md extension. Should be actual Markdown format.

### Code Organization

```
src/
├── components/         # React components organized by feature
│   ├── calendar/      # Calendar and Timeline components
│   ├── editor/        # TipTap editor + toolbar + extensions
│   ├── layout/        # Main layout and RightPanel
│   ├── sidebar/       # Note list sidebar
│   ├── templates/     # Template picker and editor
│   ├── settings/      # Settings modal
│   └── ui/            # Reusable UI components
├── hooks/             # Custom React hooks
│   ├── useNotes.ts    # Note CRUD operations
│   ├── useAutoSave.ts # Debounced auto-save (1s delay)
│   ├── useSearch.ts   # Note search functionality
│   └── useTemplates.ts # Template operations
├── stores/            # Zustand state stores
│   ├── noteStore.ts   # Active note state
│   ├── calendarStore.ts # Calendar state
│   ├── themeStore.ts  # Theme (light/dark/system)
│   ├── settingsStore.ts # App settings
│   └── templateStore.ts # Template management
├── lib/               # Utility libraries
│   ├── fileSystem.ts  # Tauri command wrappers
│   ├── calendar.ts    # Calendar API wrappers
│   └── templates.ts   # Template utilities
└── types/             # TypeScript type definitions

src-tauri/
├── src/
│   ├── lib.rs         # Main Tauri commands (789 lines - ALL backend logic here)
│   ├── calendar.rs    # EventKit Swift bridge
│   ├── main.rs        # Entry point
│   └── templates/     # Built-in template markdown files
└── src-swift/         # Swift code for macOS Calendar integration
```

## Key Patterns & Conventions

### State Management with Zustand

All global state uses Zustand stores with localStorage persistence:

```typescript
export const useThemeStore = create<ThemeState>()(
  persist(
    (set) => ({
      theme: 'system',
      setTheme: (theme) => set({ theme }),
    }),
    { name: 'notomattic-theme' }
  )
);
```

### Frontend-Backend Communication

Frontend calls Tauri commands via `invoke()`:

```typescript
// Frontend (src/lib/fileSystem.ts)
import { invoke } from '@tauri-apps/api/core';
const notes = await invoke<NoteFile[]>('list_notes');

// Backend (src-tauri/src/lib.rs)
#[tauri::command]
fn list_notes() -> Result<Vec<NoteFile>, String> { ... }
```

### Path Alias

TypeScript path alias configured: `@/` → `src/`

```typescript
import { useNoteStore } from '@/stores/noteStore';
```

### TipTap Editor Features

- **Extensions:** Bold, Italic, Underline, Strikethrough, Headings (H1-H3), Lists, Blockquotes, Code blocks, Links, Images, Text alignment, Highlights, Bubble menu
- **Wiki-style links:** `[[Note Name]]` or `[[Display|target-note]]`
- **Backlinks tracking:** Automatically maintained in note metadata
- **Auto-save:** 1-second debounce via `useAutoSave.ts`

### Template System

Templates support variable replacement:
- `{{date}}` - Current date (YYYY-MM-DD)
- `{{time}}` - Current time (HH:mm)
- `{{day_of_week}}` - Day name (Monday, Tuesday, etc.)

### Styling Conventions

- **Tailwind-first:** Use Tailwind utility classes for most styling
- **Reusable CSS classes:** Defined in `src/index.css` (`.toolbar-button`, `.sidebar-item`, etc.)
- **Dark mode:** Class-based with `dark:` prefix
- **Custom colors:** Defined in `tailwind.config.js` (`sidebar-light`, `editor-dark`, etc.)

See DESIGN_SYSTEM.md for comprehensive color system, typography, and spacing guidelines.

## Important Context

### Design Documentation

The project has extensive design documentation:
- **PROJECT_STATUS.md** - Feature status, known bugs, prioritized roadmap (P0-P3), technical debt
- **DESIGN_SYSTEM.md** - Complete color system, typography, spacing scale, component styles
- **COMPONENT_PATTERNS.md** - Reusable component patterns (buttons, inputs, containers, etc.)
- **DESIGN_TOKENS.md** - Design token reference
- **COLOR_PALETTE_REFERENCE.txt** - Specific color values

Always reference these files when adding features or modifying UI components.

### Known Issues & Technical Debt

From PROJECT_STATUS.md:
- Files stored as HTML with .md extension (should be actual Markdown)
- No test suite (unit or integration tests)
- Minimal error handling and input validation
- No error boundary component
- Hard-coded values (e.g., 1000ms debounce in `useAutoSave.ts`)
- No caching layer

### Error Handling Pattern

Current pattern (minimal):
```typescript
// Frontend
try {
  const result = await invoke('command');
  toast.success('Operation successful');
} catch (error) {
  toast.error(String(error));
}

// Backend
fn command() -> Result<T, String> {
  // Return Err(String) on failure
}
```

Error handling needs improvement across the codebase.

### TypeScript Configuration

- **Strict mode enabled**
- **Modern target:** ES2021
- **No unused locals/parameters enforcement**

## Common Development Tasks

### Adding a New Tauri Command

1. Define command in `src-tauri/src/lib.rs`
2. Add command to builder in `src-tauri/src/lib.rs` (line ~780)
3. Create wrapper function in `src/lib/fileSystem.ts` (or appropriate lib file)
4. Use `invoke()` from frontend components

### Adding a New Component

1. Create component in appropriate `src/components/` subdirectory
2. Add TypeScript types in `src/types/` if needed
3. Follow existing component patterns from COMPONENT_PATTERNS.md
4. Use Tailwind classes following DESIGN_SYSTEM.md guidelines
5. Export from directory's `index.ts` for clean imports

### Adding New State

1. Create Zustand store in `src/stores/`
2. Use `persist()` middleware if state should survive app restarts
3. Import and use store with `useStoreName()` hook in components

### Modifying the Editor

- Editor configuration: `src/components/editor/Editor.tsx`
- Toolbar buttons: `src/components/editor/Toolbar.tsx`
- Extensions: `src/components/editor/extensions/`
- Editor styles: `src/index.css` (`.ProseMirror` classes)

### Apple Calendar Integration

- Swift code: `src-tauri/src-swift/`
- Rust bridge: `src-tauri/src/calendar.rs`
- Frontend wrapper: `src/lib/calendar.ts`
- Calendar UI: `src/components/calendar/`

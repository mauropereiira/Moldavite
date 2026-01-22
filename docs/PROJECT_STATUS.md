# Moldavite v2 - Project Status

**Last Updated:** November 18, 2025
**Status:** Early Beta - Core MVP Functional

---

## Overview

Moldavite v2 is a Tauri + React note-taking app for macOS. The core note-taking functionality is implemented and working. The app can create, read, update, and organize daily notes with a rich text editor.

**Stack:** TypeScript/React (Frontend) + Rust/Tauri (Backend)
**Storage:** `~/Documents/Moldavite/` (filesystem-based)

---

## 1. What's Implemented and Working

### Core Features (Fully Functional)

| Feature | Description | Status |
|---------|-------------|--------|
| **Note CRUD** | Create, read, update notes | Working |
| **Daily Notes** | Auto-creates notes for specific dates | Working |
| **Standalone Notes** | Create named notes separate from daily | Working |
| **Rich Text Editor** | TipTap editor with full formatting | Working |
| **Auto-save** | 1-second debounced saving | Working |
| **Calendar** | Month view with note indicators | Working |
| **Theme System** | Light/Dark/System modes | Working |
| **Keyboard Shortcuts** | 10+ shortcuts (Cmd+B, Cmd+I, etc.) | Working |
| **File Persistence** | Notes saved to filesystem | Working |

### Editor Capabilities

- Bold, Italic, Underline, Strikethrough
- Headings (H1, H2, H3)
- Bullet and Numbered Lists
- Blockquotes
- Code blocks (inline and block)
- Links (auto-linking enabled)
- Images (base64 support)
- Text alignment (left, center, right)
- Highlights
- Undo/Redo

### UI Components

- **Sidebar** - Note list with daily/standalone separation
- **Editor** - Full-screen rich text editing
- **Toolbar** - Complete formatting toolbar
- **Calendar** - Month navigation with day selection
- **Right Panel** - Calendar display (timeline placeholder)

---

## 2. Feature Completeness

### Complete

- Note creation and editing
- Daily note system (YYYY-MM-DD format)
- Rich text formatting (10+ extensions)
- Auto-save with debounce
- Theme persistence (localStorage)
- Calendar navigation and note indicators
- Keyboard shortcuts for common actions
- Basic file storage (plain text)

### Partially Complete

| Feature | What Works | What's Missing |
|---------|------------|----------------|
| **Delete Notes** | Backend command exists | No UI to trigger delete |
| **Note Metadata** | Dates tracked in state | Not persisted to file |
| **Timeline** | UI placeholder exists | No functionality |

### Not Started

- Search/filter notes
- Folders/organization
- Tags/labels
- Full-text search
- Export (PDF, Markdown)
- Cloud sync
- Note templates
- Multi-window support

---

## 3. Issues and Bugs

### Critical Issues

| Issue | Impact | Location |
|-------|--------|----------|
| **Silent save failures** | User unaware of data loss | `useAutoSave.ts` |

### Known Problems

1. **HTML stored as .md files**
   - Files have `.md` extension but contain Markdown (converted from TipTap HTML)
   - Conversion exists but some edge cases may not round-trip perfectly

2. **Timeline is placeholder**
   - Shows "Timeline coming soon" message
   - No actual functionality
   - Consider removing or implementing

### Recently Fixed

- ✅ **Input validation** - Note titles now validated (letters, numbers, spaces, hyphens only)
- ✅ **Path traversal protection** - `..` blocked in note titles
- ✅ **Delete notes UI** - Trash system with 7-day recovery (v0.4.0)
- ✅ **Error notifications** - Toast system implemented
- ✅ **Search** - Note search by title implemented

---

## 4. Missing MVP Features

### Must Have for MVP

All critical MVP features have been implemented:
- ✅ Delete Notes UI (trash system)
- ✅ Search (by title)
- ✅ Error Notifications (toast system)
- ✅ Input Validation (strict title rules)

### Should Have

5. **Full-text Search** - Search note content
6. **Note Preview** - Show snippet in sidebar
7. **Confirmation Dialogs** - Confirm before delete
8. **Empty State** - Better UX when no notes exist

### Nice to Have

9. **Folders/Categories** - Organize notes
10. **Tags** - Label and filter notes
11. **Sort Options** - By date, name, modified
12. **Word Count** - Show in editor footer

---

## 5. Priority List - What to Work On Next

---

### P0-1: Toast Notification System
**Estimate: 2-3 hours** | **Priority: Critical**

| # | Task | Description | Time |
|---|------|-------------|------|
| 1.1 | Install toast library | Add `sonner` or `react-hot-toast` to dependencies | 10 min |
| 1.2 | Create ToastProvider | Wrap App.tsx with toast provider component | 15 min |
| 1.3 | Create toast utility | Export toast functions (success, error, info) | 20 min |
| 1.4 | Add save notifications | Show toast on auto-save success | 20 min |
| 1.5 | Add error notifications | Show toast on save/load failures | 30 min |
| 1.6 | Add CRUD notifications | Toasts for create/delete operations | 30 min |
| 1.7 | Theme toast styling | Match toasts to light/dark theme | 30 min |
| 1.8 | Test all scenarios | Verify toasts appear correctly | 15 min |

**Files to modify:**
- `package.json` - Add dependency
- `src/App.tsx` - Add Toaster component
- `src/lib/toast.ts` - New utility (optional)
- `src/hooks/useNotes.ts` - Add toast calls
- `src/hooks/useAutoSave.ts` - Add save notifications

**Implementation notes:**
```typescript
// Recommended: Use sonner for simplicity
import { toast } from 'sonner';
toast.success('Note saved');
toast.error('Failed to save note');
```

---

### P0-2: Delete Note Functionality
**Estimate: 2-2.5 hours** | **Priority: Critical**

| # | Task | Description | Time |
|---|------|-------------|------|
| 2.1 | Verify backend command | Confirm `delete_note` works in lib.rs | 10 min |
| 2.2 | Add deleteNote to hook | Create function in useNotes.ts | 20 min |
| 2.3 | Create delete button | Add trash icon button to note item in sidebar | 20 min |
| 2.4 | Create ConfirmDialog | Modal component for delete confirmation | 30 min |
| 2.5 | Wire up confirmation | Show dialog on delete click | 15 min |
| 2.6 | Handle post-delete state | Select next note or show empty state | 25 min |
| 2.7 | Add keyboard shortcut | Cmd+Backspace to delete current note | 15 min |
| 2.8 | Add toast notifications | Success/error feedback for delete | 10 min |
| 2.9 | Test edge cases | Delete last note, delete current note | 15 min |

**Files to modify:**
- `src/hooks/useNotes.ts` - Add deleteNote function
- `src/components/sidebar/Sidebar.tsx` - Add delete button
- `src/components/ConfirmDialog.tsx` - New component
- `src/hooks/useKeyboardShortcuts.ts` - Add delete shortcut

**Implementation notes:**
```typescript
// ConfirmDialog props
interface ConfirmDialogProps {
  isOpen: boolean;
  title: string;
  message: string;
  onConfirm: () => void;
  onCancel: () => void;
}
```

---

### P0-3: Input Validation for Note Titles
**Estimate: 1.5-2 hours** | **Priority: Critical**

| # | Task | Description | Time |
|---|------|-------------|------|
| 3.1 | Create validation utility | Define rules and error messages | 30 min |
| 3.2 | Invalid char validation | Block `/\:*?"<>\|` characters | 10 min |
| 3.3 | Length validation | Max 200 chars, min 1 char | 10 min |
| 3.4 | Reserved name check | Block Windows reserved names (CON, PRN, etc) | 10 min |
| 3.5 | Whitespace validation | Trim and block whitespace-only | 10 min |
| 3.6 | Integrate in create flow | Validate before creating new note | 20 min |
| 3.7 | Show validation errors | Display inline error messages | 20 min |
| 3.8 | Add to Rust backend | Secondary validation in lib.rs | 15 min |
| 3.9 | Test validation | Try all invalid inputs | 15 min |

**Files to modify:**
- `src/utils/validation.ts` - New utility
- `src/components/sidebar/Sidebar.tsx` - Add validation to create
- `src-tauri/src/lib.rs` - Add backend validation

**Validation rules:**
```typescript
// src/utils/validation.ts
export const INVALID_CHARS = /[\/\\:*?"<>|]/;
export const MAX_TITLE_LENGTH = 200;
export const RESERVED_NAMES = ['CON', 'PRN', 'AUX', 'NUL', 'COM1', 'LPT1'];

export function validateTitle(title: string): { valid: boolean; error?: string } {
  const trimmed = title.trim();
  if (!trimmed) return { valid: false, error: 'Title cannot be empty' };
  if (trimmed.length > MAX_TITLE_LENGTH) return { valid: false, error: 'Title too long' };
  if (INVALID_CHARS.test(trimmed)) return { valid: false, error: 'Title contains invalid characters' };
  if (RESERVED_NAMES.includes(trimmed.toUpperCase())) return { valid: false, error: 'Reserved name' };
  return { valid: true };
}
```

---

### P1-1: Search/Filter Notes
**Estimate: 3-4 hours** | **Priority: High**

| # | Task | Description | Time |
|---|------|-------------|------|
| 4.1 | Create SearchInput component | Input with search icon and clear button | 30 min |
| 4.2 | Add search state | searchQuery state in noteStore or local | 15 min |
| 4.3 | Add to sidebar | Place search input above note list | 15 min |
| 4.4 | Implement title filtering | Filter notes by title match | 30 min |
| 4.5 | Add debounce | 300ms debounce on search input | 15 min |
| 4.6 | Highlight matches | Bold matching text in results | 30 min |
| 4.7 | Add content search | Search inside note content | 45 min |
| 4.8 | Empty results state | Show message when no matches | 15 min |
| 4.9 | Keyboard shortcut | Cmd+F to focus search | 15 min |
| 4.10 | Clear on Escape | ESC key clears search | 10 min |

**Files to modify:**
- `src/components/SearchInput.tsx` - New component
- `src/components/sidebar/Sidebar.tsx` - Integrate search
- `src/stores/noteStore.ts` - Add search state (optional)
- `src/hooks/useKeyboardShortcuts.ts` - Add Cmd+F

---

### P1-2: Fix HTML/Markdown Storage
**Estimate: 2-3 hours** | **Priority: High**

| # | Task | Description | Time |
|---|------|-------------|------|
| 5.1 | Install turndown | Add HTML-to-Markdown converter | 10 min |
| 5.2 | Create markdown utils | Conversion functions | 30 min |
| 5.3 | Modify save function | Convert HTML to MD before saving | 30 min |
| 5.4 | Modify load function | Convert MD back to HTML for TipTap | 30 min |
| 5.5 | Test round-trip | Ensure formatting survives conversion | 30 min |
| 5.6 | Handle edge cases | Tables, code blocks, images | 30 min |
| 5.7 | Migration script | Convert existing HTML files to MD | 30 min |

**Files to modify:**
- `package.json` - Add turndown, marked dependencies
- `src/utils/markdown.ts` - New converter utility
- `src/hooks/useAutoSave.ts` - Convert on save
- `src/hooks/useNotes.ts` - Convert on load

---

## Implementation Order

| Order | Task | Time | Cumulative |
|-------|------|------|------------|
| 1 | Toast Notifications | 2-3h | 2-3h |
| 2 | Input Validation | 1.5-2h | 3.5-5h |
| 3 | Delete Note UI | 2-2.5h | 5.5-7.5h |
| 4 | Search/Filter | 3-4h | 8.5-11.5h |
| 5 | HTML/MD Fix | 2-3h | 10.5-14.5h |

**Total: 10.5-14.5 hours**

---

### P2 - Medium Priority

7. **Improve sidebar UX**
   - Show note preview/snippet
   - Show last modified date
   - Better empty state

8. **Implement or remove Timeline**
   - Either build the timeline feature
   - Or remove the placeholder entirely

9. **Add confirmation dialogs**
   - Before deleting notes
   - Before discarding unsaved changes

### P3 - Low Priority

10. **Add folder organization**
11. **Implement tags**
12. **Add export functionality**
13. **Add sorting options**
14. **Implement note templates**

---

## 6. Technical Debt

### Code Quality

- No tests (unit or integration)
- Minimal code comments
- Hard-coded magic numbers (1000ms debounce)
- Unused `chrono` dependency in Rust
- Some loading states not properly synchronized

### Architecture

- No proper error boundary component
- State could be more modular
- No caching layer for notes
- All notes loaded into memory

### Performance

- No pagination for large note lists
- No lazy loading
- Full filesystem scan on every init
- Calendar recalculates all 42 days on render

---

## 7. File Structure Reference

```
src/
├── components/
│   ├── calendar/Calendar.tsx      # Month calendar
│   ├── editor/Editor.tsx          # TipTap rich editor
│   ├── editor/Toolbar.tsx         # Formatting toolbar
│   ├── layout/Layout.tsx          # 3-column layout
│   ├── layout/RightPanel.tsx      # Calendar + timeline
│   └── sidebar/Sidebar.tsx        # Note list
├── hooks/
│   ├── useNotes.ts                # Note CRUD operations
│   ├── useAutoSave.ts             # Debounced auto-save
│   └── useKeyboardShortcuts.ts    # Keyboard shortcuts
├── stores/
│   ├── noteStore.ts               # Note state (Zustand)
│   └── themeStore.ts              # Theme state (Zustand)
├── lib/
│   └── fileSystem.ts              # Tauri command wrappers
└── types/
    └── note.ts                    # TypeScript interfaces

src-tauri/src/
└── lib.rs                         # All Rust commands (170 lines)
```

---

## 8. Quick Start for Development

```bash
# Install dependencies
npm install

# Run in development
npm run tauri dev

# Build for production
npm run tauri build
```

### Key Files to Modify

- **Add new features:** `src/components/`
- **Add Tauri commands:** `src-tauri/src/lib.rs`
- **Add state:** `src/stores/`
- **Add styles:** `src/index.css`

---

## Summary

**What's Done:** Core note-taking works well. You can create notes, edit with rich formatting, auto-save, use daily notes via calendar, and switch themes.

**What's Broken:** Error handling is silent, no way to delete notes from UI, file format mismatch (.md contains HTML).

**What's Missing:** Search, delete UI, error notifications, input validation.

**Next Steps:** Focus on P0 items (error notifications, delete UI, input validation) to make the app feel complete and safe to use.

# Quick Switcher (Cmd+K) Design

**Date:** 2026-01-21
**Status:** Approved
**Priority:** High — First in UX enhancement series

---

## Overview

A keyboard-driven modal for rapidly navigating between notes. Triggered by `Cmd+K`, it provides instant search across all notes with fuzzy matching, recent notes when empty, and smooth animations throughout.

---

## Interaction Model

### Trigger & Dismiss
- **Open:** `Cmd+K` from anywhere in the app
- **Close:** `Escape`, click backdrop, or select a note

### Search Behavior
- Searches all notes (daily + standalone) by title
- Instant results as you type (no debounce for local data)
- Empty input shows recent notes (last 7 opened)
- Fuzzy matching: "mtg" finds "Meeting Notes"

### Keyboard Navigation
- `↑` / `↓` — Move selection through results
- `Enter` — Open selected note and close switcher
- `Escape` — Close without action

### Result Items Display
- Note title with matched characters highlighted
- Type indicator: daily (calendar icon) vs standalone (document icon)
- Relative time: "2 hours ago", "Yesterday"

---

## Visual Design

### Container
- **Width:** 560px
- **Max height:** 420px (~8 results visible)
- **Background:** `var(--bg-surface)` with `backdrop-filter: blur(12px)`
- **Border:** `1px solid var(--border-subtle)`
- **Border radius:** 16px
- **Shadow:** Layered soft shadow
  ```css
  box-shadow:
    0 0 0 1px rgba(0,0,0,0.05),
    0 4px 16px rgba(0,0,0,0.12),
    0 16px 48px rgba(0,0,0,0.12);
  ```

### Search Input
- Font size: 18px
- No visible border, clean minimal look
- Placeholder: "Search notes..." in muted color
- Search icon (magnifying glass) left-aligned, 20px
- Padding: 20px 24px

### Result Items
- Padding: 12px 24px
- Title: 15px, primary text color
- Metadata: 13px, muted — "Daily · 2 hours ago"
- Selected/hover: `var(--bg-hover)` with 8px border radius
- Matched characters: accent color + semi-bold

### Backdrop
- Light mode: `rgba(0,0,0,0.3)`
- Dark mode: `rgba(0,0,0,0.5)`
- Click to dismiss

### Animations
- **Open:** Scale 0.96→1.0, opacity 0→1, 150ms ease-out
- **Results:** Stagger fade-in, 30ms delay between items
- **Close:** Fade out 100ms
- **Selection:** Background transition 100ms

---

## Architecture

### File Structure
```
src/components/quick-switcher/
├── QuickSwitcher.tsx      # Main modal component
├── QuickSwitcherInput.tsx # Search input with icon
├── QuickSwitcherItem.tsx  # Individual result row
└── index.ts               # Exports

src/stores/
└── quickSwitcherStore.ts  # Open/close state

src/hooks/
└── useQuickSwitcher.ts    # Search logic + keyboard handling
```

### State Management
New Zustand store for UI state:
```typescript
interface QuickSwitcherState {
  isOpen: boolean;
  open: () => void;
  close: () => void;
}
```

### Recent Notes Tracking
Add to `noteStore`:
```typescript
recentNoteIds: string[]  // Last 7 opened, deduplicated
```

### Data Flow
1. `Cmd+K` → `quickSwitcherStore.open()`
2. Component mounts, auto-focus input
3. Filter notes from `useNotes()` as user types
4. Track `selectedIndex` in component state
5. `Enter` → `setActiveNote()` + `close()`

### Fuzzy Matching
```typescript
function fuzzyMatch(query: string, title: string): boolean {
  let qi = 0;
  const q = query.toLowerCase();
  const t = title.toLowerCase();
  for (const c of t) {
    if (c === q[qi]) qi++;
    if (qi === q.length) return true;
  }
  return false;
}
```

---

## Integration Points

| File | Change |
|------|--------|
| `App.tsx` | Render `<QuickSwitcher />` at root |
| `useKeyboardShortcuts.ts` | Add `Cmd+K` handler |
| `noteStore.ts` | Add `recentNoteIds` tracking |
| `index.css` | Add switcher styles |

---

## Future Enhancements (Not in v1)

- Full-text content search
- Action commands ("/new note", "/settings")
- Note creation from switcher
- Tag filtering within switcher

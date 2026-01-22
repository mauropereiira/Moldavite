# Moldavite Design System - Comprehensive Analysis

## Overview
Moldavite v2 is a macOS native note-taking application built with React, TypeScript, and Tauri. It uses Tailwind CSS 4.1 as the primary styling framework with a custom theme system supporting both light and dark modes.

---

## 1. Color Scheme & CSS Variables

### Theme Implementation
- **Framework**: Tailwind CSS 4.1 with PostCSS
- **Dark Mode Strategy**: CSS class-based (`darkMode: 'class'`)
- **System Detection**: Supports system preference detection with `window.matchMedia('(prefers-color-scheme: dark)')`
- **Storage**: Theme preference persisted via Zustand with localStorage

### Custom Color Definitions (from tailwind.config.js)

#### Application-Specific Colors
```javascript
colors: {
  sidebar: {
    light: '#f5f5f5',      // Light gray
    dark: '#1e1e1e'        // Very dark gray/almost black
  },
  editor: {
    light: '#ffffff',       // Pure white
    dark: '#2d2d2d'        // Dark gray
  },
  panel: {
    light: '#fafafa',      // Off-white
    dark: '#252525'        // Almost black
  }
}
```

### Tailwind Gray Scale Used
The design system relies heavily on the Tailwind default gray palette:

**Light Theme:**
- `white` (#ffffff) - Editor background
- `gray-50` (#f9fafb) - Toolbar background
- `gray-200` (#e5e7eb) - Hover states, borders
- `gray-300` (#d1d5db) - Dividers, scrollbar
- `gray-400` (#9ca3af) - Secondary text, placeholders
- `gray-500` (#6b7280) - Tertiary text
- `gray-700` (#374151) - Active state backgrounds
- `gray-900` (#111827) - Primary text, dark backgrounds

**Dark Theme:**
- `gray-800` (#1f2937) - Code blocks background
- `gray-700` (#374151) - Active/hover states
- `gray-600` (#4b5563) - Scrollbar, borders
- `gray-500` (#6b7280) - Secondary text
- `gray-400` (#9ca3af) - Tertiary text
- `gray-300` (#d1d5db) - Not used in dark mode
- `gray-900` (#111827) - Primary background

### Accent Colors

**Primary Action Color (Blue):**
- `blue-500` (#3b82f6) - Indicator dots
- `blue-600` (#2563eb) - Buttons, active selections, links (light)
- `blue-700` (#1d4ed8) - Hover state
- `blue-400` (#60a5fa) - Links (dark), today indicator (dark)

**Status Colors (from Tailwind defaults):**
- Success: `green-500`/`green-600` (not currently used but available)
- Error: `red-500`/`red-600` (not currently used but available)
- Warning: `yellow-500`/`amber-500` (highlight color: `#fef08a`)

**Highlight Color:**
- Light mode: `#fef08a` (soft yellow)
- Dark mode: `rgba(113, 63, 18, 0.5)` (dark brown transparent)

### Color Usage by Component

**Sidebar**
- Light background: `#f5f5f5`
- Dark background: `#1e1e1e`
- Item hover: `#e5e7eb` (light) / `#374151` (dark)
- Item active: `#dbeafe` background + `#2563eb` text (light) / rgba(30, 58, 138, 0.3) + `#60a5fa` (dark)
- Borders: `gray-200` (light) / `gray-700` (dark)

**Editor**
- Light background: `#ffffff`
- Dark background: `#2d2d2d`
- Link color: `#2563eb` (light) / `#60a5fa` (dark)
- Code background: `#f3f4f6` (light) / `#1f2937` (dark)
- Blockquote border: `#d1d5db` (light) / `#4b5563` (dark)

**Right Panel**
- Light background: `#fafafa`
- Dark background: `#252525`
- Borders: `gray-200` (light) / `gray-700` (dark)

**Toolbar**
- Light background: `#f9fafb` (gray-50)
- Dark background: `#1f2937` (gray-800)
- Button text: Inherits currentColor (icon color)
- Divider: `#d1d5db` (light) / `#4b5563` (dark)

---

## 2. Typography & Spacing Patterns

### Font Families

**Sans Serif (Default)**
```javascript
fontFamily: {
  sans: [
    '-apple-system',
    'BlinkMacSystemFont',
    'Segoe UI',
    'Roboto',
    'Helvetica',
    'Arial',
    'sans-serif'
  ]
}
```
System font stack optimized for macOS (San Francisco), with fallbacks for other platforms.

**Monospace**
```javascript
fontFamily: {
  mono: [
    'SF Mono',
    'Menlo',
    'Monaco',
    'Courier New',
    'monospace'
  ]
}
```
Used for code blocks and inline code.

### Font Sizes Used

| Element | Size | Weight | Line Height |
|---------|------|--------|------------|
| H1 | 1.875rem (30px) | 700 | Default |
| H2 | 1.5rem (24px) | 700 | Default |
| H3 | 1.25rem (20px) | 600 | Default |
| Paragraph | Default (1rem/16px) | 400 | Default |
| Label/Section Header | 0.75rem (12px) | 600 | Default |
| Small Text | 0.875rem (14px) | 400 | Default |
| Extra Small | 0.75rem (12px) | 400 | Default |

### Spacing Scale

**Used in Components** (rem-based):
- `0.125rem` (2px) - Code padding
- `0.25rem` - Small borders, toolbar button radius
- `0.375rem` - Toolbar button padding, sidebar item padding (vertical)
- `0.5rem` - Editor margins, list item spacing
- `0.75rem` - Section padding, spacing above/below text
- `1rem` - Standard padding, code block padding, quote padding
- `1.5rem` - List indent, line spacing
- `2rem` - Not explicitly used
- `4rem` - Sidebar and panel padding

**Gap/Space Between Items** (Tailwind utilities):
- `gap-0.5` - Calendar grid gaps
- `gap-1` - Text and elements spacing
- `gap-0` - Sidebar list items (space-y-0.5)

**Margins in Editor** (`index.css`):
- Paragraph: `0.5rem 0`
- H1: `1rem 0`
- H2: `0.75rem 0`
- H3: `0.5rem 0`
- Lists: `0.5rem 0`
- List items: `0.25rem 0`
- Blockquote: `1rem 0`
- Pre: `1rem 0`
- Image: `1rem 0`
- HR: `1.5rem 0`

---

## 3. Existing Component Styles

### Button Components

**Toolbar Buttons** (`.toolbar-button`)
```css
padding: 0.375rem;           /* 6px */
border-radius: 0.25rem;      /* 4px */
transition: background-color 0.15s;

:hover {
  background-color: #e5e7eb (light) / #374151 (dark);
}
```

**Toolbar Button Active** (`.toolbar-button-active`)
- Same as hover state
- Applied when tool is active (bold, italic, etc.)

**Primary Action Button** (Today's Note)
```
px-3 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition-colors
```

**Sidebar Items** (`.sidebar-item`)
```css
padding: 0.375rem 0.75rem;  /* 6px 12px */
border-radius: 0.375rem;    /* 6px */
cursor: pointer;
transition: background-color 0.15s;

:hover {
  background-color: #e5e7eb (light) / #374151 (dark);
}
```

**Sidebar Item Active** (`.sidebar-item-active`)
```css
background-color: #dbeafe (light) / rgba(30, 58, 138, 0.3) (dark);
color: #2563eb (light) / #60a5fa (dark);
```

**Calendar Day Buttons**
```
aspect-square flex items-center justify-center text-xs rounded-md
- Today indicator: font-bold, text-blue-600 (light) / text-blue-400 (dark)
- Selected: bg-blue-600 text-white
- Hover: hover:bg-gray-200 (light) / hover:bg-gray-700 (dark)
- Disabled (not current month): text-gray-300 (light) / text-gray-600 (dark)
```

**Text Input** (Note title input)
```
px-2 py-1 text-sm
border border-gray-300 (light) / border-gray-600 (dark)
rounded
bg-white (light) / bg-gray-800 (dark)
focus:outline-none focus:ring-2 focus:ring-blue-500
```

### Navigation/Structural Components

**Layout** (`Layout.tsx`)
```
- Main container: flex h-screen w-screen bg-white (light) / bg-gray-900 (dark)
- Sidebar: w-64 flex-shrink-0 border-r
- Editor: flex-1 flex flex-col min-w-0
- Right panel: w-72 flex-shrink-0 border-l
```

**Sidebar**
```
- Header: px-4 py-4 border-b
- Sections: px-3 py-2
- Items list: space-y-0.5
```

**Editor**
```
- Header: px-6 py-3 border-b
- Toolbar: gap-0.5 p-2 border-b
- Content: flex-1 overflow-y-auto
```

### Typography Utilities

**Headings**
- `text-lg font-semibold` - Main titles
- `text-sm font-medium` - Section headers
- `text-xs font-semibold uppercase tracking-wider` - Category labels

**Text Emphasis**
- `font-medium` - Important text
- `font-semibold` - Strong emphasis
- `italic` - Blockquotes, placeholders
- `truncate` - Long text truncation
- `opacity-50` - Disabled state

---

## 4. Theme Implementation Details

### File Structure

**Theme Store** (`src/stores/themeStore.ts`)
```typescript
type Theme = 'light' | 'dark' | 'system';

interface ThemeState {
  theme: Theme;
  setTheme: (theme: Theme) => void;
}

// Persisted via Zustand middleware (localStorage: 'moldavite-theme')
```

**Application of Theme** (`applyTheme` function)
```typescript
export const applyTheme = (theme: Theme) => {
  const root = document.documentElement;
  
  if (theme === 'system') {
    const systemDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    root.classList.toggle('dark', systemDark);
  } else {
    root.classList.toggle('dark', theme === 'dark');
  }
};
```

### Dark Mode Strategy

**Tailwind Configuration**
```javascript
darkMode: 'class'  // Uses HTML element class toggle
```

**Light Theme** (default)
- Root element: no 'dark' class
- `body { background-color: white; color: #111827; }`
- All `dark:` prefixed classes are inactive

**Dark Theme**
- Root element: has 'dark' class
- `body { background-color: #111827; color: #f3f4f6; }`
- All `.dark` CSS rules activate
- All `dark:` prefixed Tailwind classes apply

### Theme Switching Logic

1. User clicks theme button (☀️ light → 🌙 dark → 💻 system)
2. `setTheme()` updates Zustand store
3. Theme preference saved to localStorage
4. `applyTheme()` called to toggle 'dark' class on root
5. On system preference change (when theme='system'), listener re-applies theme

---

## 5. Layout Structure & Z-Index

### Layout Hierarchy

**Main Container**
```
<div className="flex h-screen w-screen overflow-hidden">
  ├── Sidebar (w-64, flex-shrink-0)
  ├── Editor (flex-1, flex flex-col)
  └── Right Panel (w-72, flex-shrink-0)
</div>
```

**Fixed Sizes**
- Sidebar width: 256px (w-64)
- Right Panel width: 288px (w-72)
- Editor: Remaining flex space

**Editor Section**
```
<div className="flex flex-col h-full">
  ├── Header (px-6 py-3) - Note title
  ├── Toolbar (gap-0.5 p-2) - Formatting tools
  └── Content (flex-1 overflow-y-auto) - Editor area
</div>
```

### Z-Index Usage

**Current Implementation**: No explicit z-index values used in codebase

**Implicit Stacking Order** (CSS natural stacking):
1. Editor content (base layer)
2. Toolbar (parent container, higher in DOM)
3. Modals/Dialogs (none currently implemented)
4. System elements (scrollbar, menus)

**Notes:**
- No overlays, modals, or dialogs currently implemented
- No tooltips with explicit z-index
- Scrollbar styling handled separately (`::-webkit-scrollbar`)
- Focus/active states use background color changes, not elevation

**Future Z-Index Considerations** (if adding):
- Modals: `z-50` or higher
- Dropdowns/Popovers: `z-40`
- Tooltips: `z-30`
- Notifications/Toasts: `z-20`
- Floating toolbars: `z-10`

---

## 6. Scrollbar Styles

**Light Mode**
```css
::-webkit-scrollbar {
  width: 8px;
  height: 8px;
}

::-webkit-scrollbar-thumb {
  background-color: #d1d5db;  /* gray-300 */
  border-radius: 9999px;      /* Fully rounded */
}

::-webkit-scrollbar-thumb:hover {
  background-color: #9ca3af;  /* gray-400 */
}
```

**Dark Mode**
```css
.dark ::-webkit-scrollbar-thumb {
  background-color: #4b5563;  /* gray-600 */
}

.dark ::-webkit-scrollbar-thumb:hover {
  background-color: #6b7280;  /* gray-500 */
}
```

---

## 7. Editor Styles (TipTap)

### Configuration
```
editorProps: {
  attributes: {
    class: 'prose dark:prose-invert max-w-none focus:outline-none min-h-full p-6'
  }
}
```

Uses Tailwind Typography (`@tailwindcss/typography`) for prose styling.

### Heading Styles
- H1: `font-size: 1.875rem; font-weight: 700; margin: 1rem 0;`
- H2: `font-size: 1.5rem; font-weight: 700; margin: 0.75rem 0;`
- H3: `font-size: 1.25rem; font-weight: 600; margin: 0.5rem 0;`

### List Styles
- Lists: `padding-left: 1.5rem; margin: 0.5rem 0;`
- Unordered: `list-style-type: disc;`
- Ordered: `list-style-type: decimal;`
- Items: `margin: 0.25rem 0;`

### Code Styles
- Inline: `background: #f3f4f6` (light) / `#1f2937` (dark), `padding: 0.125rem 0.375rem`, `border-radius: 0.25rem`, `font-size: 0.875rem`
- Block: `background: #f3f4f6` (light) / `#1f2937` (dark), `padding: 1rem`, `border-radius: 0.5rem`

### Quote Styles
- Border: `4px solid #d1d5db` (light) / `#4b5563` (dark) on left
- Padding: `padding-left: 1rem`
- Font: `font-style: italic`

### Link Styles
- Color: `#2563eb` (light) / `#60a5fa` (dark)
- Decoration: `text-decoration: underline`

### Highlight
- Light: `background-color: #fef08a` (soft yellow)
- Dark: `background-color: rgba(113, 63, 18, 0.5)` (dark brown transparent)

---

## 8. Notification/Alert Status

**Current Status**: No notification or alert component system currently implemented.

**Observed Status Indicators:**
- Saving indicator: Text label "Saving..." in editor header
- No error states visible
- No success messages
- No toast notifications
- No modal dialogs

**Opportunities for Implementation:**
- Toast notification system (top-right corner, auto-dismiss)
- Error alerts for save failures
- Confirmation dialogs for destructive actions
- Status badges for sync/save state

---

## 9. Animation & Transitions

**Used in Components:**
```css
transition: background-color 0.15s;  /* Toolbar buttons, sidebar items, scrollbar */
transition-colors                    /* Primary action buttons */
```

**Hover Effects**: Color changes with smooth 150ms transition

**Focus States**: 
- Ring outline: `focus:ring-2 focus:ring-blue-500`
- No shadow effects currently used

---

## 10. Responsive Breakpoints

**Current Layout**: Fixed column widths (not responsive)
- Sidebar: 256px (fixed)
- Right Panel: 288px (fixed)
- Editor: Flex (remaining space)

**Note**: Design is optimized for desktop/macOS application, not mobile-responsive.

---

## 11. Accessibility Considerations

**Text Selection Control**
```css
.no-select {
  -webkit-user-select: none;
  user-select: none;
}
```

**Font Smoothing**
```css
-webkit-font-smoothing: antialiased;
-moz-osx-font-smoothing: grayscale;
```

**Focus Indicators**
- Input focus: `focus:outline-none focus:ring-2 focus:ring-blue-500`
- Toolbar buttons: Use visual active state (background color)

**Color Contrast** (meeting WCAG standards):
- Primary text on light: `#111827` on `#ffffff` (high contrast)
- Primary text on dark: `#f3f4f6` on `#111827` (high contrast)
- Links: `#2563eb` and `#60a5fa` maintain good contrast

---

## Summary Table

| Aspect | Implementation |
|--------|-----------------|
| **Framework** | Tailwind CSS 4.1 + PostCSS |
| **Dark Mode** | CSS class-based (`class` strategy) |
| **Colors** | Custom sidebar/editor/panel colors + default Tailwind grays |
| **Primary Accent** | Blue (#2563eb light, #60a5fa dark) |
| **Typography** | System fonts (SF, Roboto) + SF Mono |
| **Spacing Scale** | Tailwind defaults (0.125rem to 4rem) |
| **Border Radius** | 0.25rem (toolbar), 0.375rem (sidebar), 0.5rem (blocks), 9999px (scrollbar) |
| **Shadows** | None currently used |
| **Transitions** | 0.15s background-color |
| **Z-Index** | No explicit values (natural stacking) |
| **Notifications** | Not implemented |
| **State Management** | Zustand with localStorage persistence |

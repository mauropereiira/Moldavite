# Moldavite Design Tokens - Quick Reference

## Color Palette

### Primary Colors

#### Light Theme
```
Background: #ffffff (white)
Text: #111827 (gray-900)
```

#### Dark Theme  
```
Background: #111827 (gray-900)
Text: #f3f4f6 (gray-100)
```

### Component Backgrounds

#### Sidebar
- Light: #f5f5f5
- Dark: #1e1e1e

#### Editor
- Light: #ffffff
- Dark: #2d2d2d

#### Panel (Right)
- Light: #fafafa
- Dark: #252525

#### Toolbar
- Light: #f9fafb (gray-50)
- Dark: #1f2937 (gray-800)

### Interactive Colors

#### Blue (Primary Action/Accent)
- 400: #60a5fa (dark mode text/links)
- 500: #3b82f6 (indicator dots)
- 600: #2563eb (buttons, selections, light mode links)
- 700: #1d4ed8 (hover state)

#### Gray Scale
- 50: #f9fafb (toolbar light)
- 200: #e5e7eb (hover, borders light)
- 300: #d1d5db (dividers, scrollbar light)
- 400: #9ca3af (secondary text, placeholders)
- 500: #6b7280 (tertiary text, scrollbar dark hover)
- 600: #4b5563 (scrollbar dark, borders dark)
- 700: #374151 (active states)
- 800: #1f2937 (code blocks dark)
- 900: #111827 (dark background)

#### Special
- Highlight Light: #fef08a (soft yellow)
- Highlight Dark: rgba(113, 63, 18, 0.5) (dark brown transparent)

### State Colors

#### Focus
- Ring: 2px solid #3b82f6 (blue-500)

#### Sidebar Active
- Light: #dbeafe background + #2563eb text
- Dark: rgba(30, 58, 138, 0.3) background + #60a5fa text

---

## Typography

### Font Families
- Sans: `-apple-system`, `BlinkMacSystemFont`, `Segoe UI`, `Roboto`, `Helvetica`, `Arial`, sans-serif
- Mono: `SF Mono`, `Menlo`, `Monaco`, `Courier New`, monospace

### Font Sizes
| Name | Size | Usage |
|------|------|-------|
| H1 | 1.875rem (30px) | Page titles |
| H2 | 1.5rem (24px) | Section headings |
| H3 | 1.25rem (20px) | Subsection headings |
| Body | 1rem (16px) | Paragraphs, main text |
| Small | 0.875rem (14px) | Secondary text |
| Extra Small | 0.75rem (12px) | Labels, captions |

### Font Weights
- Regular (400): Body text
- Medium (500): Important text, secondary headings
- Semibold (600): Section headers, strong text
- Bold (700): Main titles, H1/H2

---

## Spacing Scale

### Padding/Margin Units (rem)
```
0.125rem = 2px
0.25rem = 4px
0.375rem = 6px
0.5rem = 8px
0.75rem = 12px
1rem = 16px
1.5rem = 24px
2rem = 32px
3rem = 48px
4rem = 64px
```

### Component Spacing

| Component | Padding | Gap |
|-----------|---------|-----|
| Sidebar Header | 1rem (4px) | - |
| Sidebar Section | 0.75rem 0.75rem (12px) | - |
| Sidebar Item | 0.375rem 0.75rem (6px 12px) | - |
| Editor Header | 1.5rem 1.5rem (24px) | - |
| Editor Toolbar | 0.5rem (8px) | 0.125rem (2px) |
| Calendar | - | 0.125rem (2px) |
| Lists | - | 0.125rem (2px) |

---

## Border Radius

```
0.25rem (4px) - Toolbar buttons, inline code
0.375rem (6px) - Sidebar items, calendar grid items
0.5rem (8px) - Code blocks, images
9999px - Fully rounded (scrollbar)
```

---

## Shadows

Currently not used. If needed in future:
```
sm: 0 1px 2px 0 rgba(0, 0, 0, 0.05)
md: 0 4px 6px -1px rgba(0, 0, 0, 0.1)
lg: 0 10px 15px -3px rgba(0, 0, 0, 0.1)
```

---

## Transitions

```
Primary: transition: background-color 0.15s
Duration: 150ms
Easing: ease (default)
```

---

## Z-Index (Reserved for Future Use)

```
z-50: Modals, Dialogs
z-40: Dropdowns, Popovers
z-30: Tooltips
z-20: Notifications, Toasts
z-10: Floating elements
```

---

## Responsive Breakpoints

Currently not used - design is fixed-width for macOS app.

If needed in future:
```
sm: 640px
md: 768px
lg: 1024px
xl: 1280px
2xl: 1536px
```

---

## CSS Classes Reference

### Toolbar Button
```css
.toolbar-button {
  padding: 0.375rem;
  border-radius: 0.25rem;
  transition: background-color 0.15s;
}

.toolbar-button:hover {
  background-color: #e5e7eb (light) / #374151 (dark);
}

.toolbar-button-active {
  background-color: #e5e7eb (light) / #374151 (dark);
}
```

### Sidebar Item
```css
.sidebar-item {
  padding: 0.375rem 0.75rem;
  border-radius: 0.375rem;
  cursor: pointer;
  transition: background-color 0.15s;
}

.sidebar-item:hover {
  background-color: #e5e7eb (light) / #374151 (dark);
}

.sidebar-item-active {
  background-color: #dbeafe (light) / rgba(30, 58, 138, 0.3) (dark);
  color: #2563eb (light) / #60a5fa (dark);
}
```

### Text Selection Control
```css
.no-select {
  -webkit-user-select: none;
  user-select: none;
}
```

---

## Theme Implementation

### Storage
- Key: `moldavite-theme`
- Values: `'light'` | `'dark'` | `'system'`
- Persisted: localStorage via Zustand

### DOM Application
- Light: `<html>` (no dark class)
- Dark: `<html class="dark">`

### CSS Media Query Fallback
```css
@media (prefers-color-scheme: dark) {
  body {
    background-color: #111827;
    color: #f3f4f6;
  }
}
```

---

## Quick Copy Utilities

### Tailwind Classes
```
Text: text-xs | text-sm | text-sm | text-base | text-lg
Text Color: text-gray-{300,400,500,700,900} | text-blue-{400,600} | text-white
Background: bg-white | bg-gray-{50,800,900} | bg-blue-600 | bg-{sidebar,editor,panel}-{light,dark}
Border: border-{t,b,l,r} border-gray-{200,700}
Padding: px-{2,3,4,6} py-{1,2,3,4}
Margin: mx-1 my-1
Rounded: rounded rounded-md rounded-lg
Focus: focus:outline-none focus:ring-2 focus:ring-blue-500
Hover: hover:bg-gray-200 dark:hover:bg-gray-700
Flex: flex flex-col flex-1
Width: w-{64,72}
Height: h-{full,screen}
```

---

## Dark Mode Usage

All color utilities support dark: prefix:
```
dark:bg-{color}
dark:text-{color}
dark:border-{color}
dark:hover:bg-{color}
dark:focus:ring-{color}
```

Example:
```jsx
className="bg-white dark:bg-gray-900 text-gray-900 dark:text-white"
```

---

## Component Composition Patterns

### Button
```jsx
className="px-3 py-2 text-sm font-medium rounded-lg
  bg-blue-600 text-white
  hover:bg-blue-700
  transition-colors
  dark:bg-blue-500 dark:hover:bg-blue-600"
```

### Input
```jsx
className="px-2 py-1 text-sm
  border border-gray-300 dark:border-gray-600
  rounded
  bg-white dark:bg-gray-800
  text-gray-900 dark:text-white
  focus:outline-none focus:ring-2 focus:ring-blue-500"
```

### Section Header
```jsx
className="text-xs font-semibold
  text-gray-500 dark:text-gray-400
  uppercase tracking-wider"
```

### Card
```jsx
className="p-4
  bg-gray-50 dark:bg-gray-800
  border border-gray-200 dark:border-gray-700
  rounded-md"
```


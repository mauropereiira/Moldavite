# Notomattic Design System Documentation Index

This directory contains comprehensive documentation about the Notomattic design system and styling architecture.

## Documents

### 1. DESIGN_SYSTEM.md (15 KB)
**Comprehensive design system analysis** - The main reference document covering all aspects of the Notomattic design system.

Contents:
- Color scheme and CSS variables (light/dark theme colors)
- Typography and spacing patterns
- Existing component styles (buttons, inputs, sidebars, etc.)
- Theme implementation details
- Layout structure and z-index usage
- Scrollbar and editor styles
- Notification/alert status
- Animation and transitions
- Responsive considerations
- Accessibility features

**Use this for**: Understanding the overall design system, color palettes, typography specifications, and component styling approach.

---

### 2. DESIGN_TOKENS.md (6.1 KB)
**Quick reference for design tokens** - Fast lookup guide for colors, typography, spacing, and common utilities.

Contents:
- Color palette with hex values
- Font families and sizes (table format)
- Spacing scale (rem-based)
- Border radius values
- Transitions and animations
- CSS class reference
- Theme implementation details
- Quick copy Tailwind utilities
- Component composition patterns

**Use this for**: Quick lookups while coding, copying class names, and remembering color values.

---

### 3. COMPONENT_PATTERNS.md (9.4 KB)
**Copy-paste component patterns** - Real code examples showing how to build components in Notomattic.

Contents:
- Button patterns (primary, toolbar, icon, calendar nav)
- Input patterns
- Text patterns (titles, headers, secondary text)
- List patterns
- Container patterns
- Calendar pattern
- Divider/separator pattern
- Editor content pattern
- Common styling patterns
- Guidelines for creating new components

**Use this for**: Creating new components, copy-paste examples, and understanding established patterns.

---

## Key Design System Values

### Colors
- **Primary Accent**: Blue (#2563eb light, #60a5fa dark)
- **Primary Text**: Gray-900 light (#111827), White dark
- **Secondary Text**: Gray-500/600
- **Borders**: Gray-200 light, Gray-700 dark

### Typography
- **Font Stack**: System fonts (-apple-system, BlinkMacSystemFont, etc.)
- **Mono Font**: SF Mono, Menlo, Monaco
- **Base Size**: 1rem (16px)

### Spacing
- **Base Unit**: 0.25rem (4px)
- **Common Padding**: 0.5rem, 0.75rem, 1rem
- **Component Gaps**: 0.125rem to 1rem

### Dark Mode
- **Strategy**: CSS class-based (`darkMode: 'class'` in Tailwind)
- **Storage**: localStorage (key: `notomattic-theme`)
- **Values**: 'light', 'dark', 'system'

### Framework
- **CSS Framework**: Tailwind CSS 4.1
- **Processing**: PostCSS
- **Typography Plugin**: @tailwindcss/typography

---

## File Structure Reference

Key styling files in the project:

```
notomattic-v2/
├── tailwind.config.js          # Tailwind configuration with custom colors
├── postcss.config.js           # PostCSS configuration
├── src/
│   ├── index.css               # Global styles, component classes, editor styles
│   ├── App.tsx                 # Theme initialization and system preference listening
│   ├── stores/
│   │   └── themeStore.ts       # Theme state management (Zustand)
│   └── components/
│       ├── editor/             # Editor with TipTap (prose styles)
│       ├── sidebar/            # Sidebar with note list and theme toggle
│       ├── calendar/           # Calendar grid with day selection
│       ├── layout/             # Three-column layout (sidebar-editor-panel)
│       └── ui/                 # (Currently empty - UI in main components)
```

---

## Theme Implementation Quick Start

### Accessing Theme
```typescript
import { useThemeStore, applyTheme } from '@/stores';

function MyComponent() {
  const { theme, setTheme } = useThemeStore();
  
  const toggleTheme = () => {
    const newTheme = theme === 'light' ? 'dark' : 'light';
    setTheme(newTheme);
    applyTheme(newTheme);
  };
  
  return <button onClick={toggleTheme}>{theme}</button>;
}
```

### Using Theme Colors in Components
```jsx
className="bg-white dark:bg-gray-900 text-gray-900 dark:text-white"
```

### Adding Dark Mode Styles to CSS
```css
.my-element {
  color: #111827;
}

.dark .my-element {
  color: #f3f4f6;
}
```

---

## Creating New Components

### Best Practices
1. Use Tailwind utility classes as primary styling method
2. Add `dark:` prefix variants for all color properties
3. Reuse existing color values from DESIGN_TOKENS.md
4. Use existing button/item classes from index.css when applicable
5. Group related classes and use interpolation for conditionals

### Example Component Template
```jsx
export function MyComponent({ isActive, variant = 'default' }) {
  return (
    <div
      className={`
        px-3 py-2 text-sm rounded-md
        transition-colors
        ${variant === 'primary'
          ? 'bg-blue-600 text-white hover:bg-blue-700 dark:bg-blue-500 dark:hover:bg-blue-600'
          : 'bg-gray-200 text-gray-900 hover:bg-gray-300 dark:bg-gray-700 dark:text-white dark:hover:bg-gray-600'
        }
        ${isActive ? 'ring-2 ring-blue-500' : ''}
      `}
    >
      Content
    </div>
  );
}
```

---

## Testing Dark Mode

### Browser DevTools
```javascript
// Toggle dark mode in console
document.documentElement.classList.toggle('dark');
```

### Programmatically
```jsx
import { useThemeStore, applyTheme } from '@/stores';

const { setTheme } = useThemeStore();
setTheme('dark');
applyTheme('dark');
```

### System Preference
Theme will automatically switch if set to 'system' when OS preference changes.

---

## Current Limitations & Future Considerations

### Not Implemented
- No modal/dialog system (recommended z-index: z-50)
- No tooltip component (recommended z-index: z-30)
- No notification/toast system (recommended z-index: z-20)
- No custom shadow effects
- Not responsive (fixed column widths)

### Recommended Z-Index Values if Implemented
```javascript
z-10: Floating toolbars, sticky headers
z-20: Notifications, toasts
z-30: Tooltips
z-40: Dropdowns, popovers
z-50: Modals, dialogs
```

---

## Related Files

### Tailwind Configuration
**Location**: `/Users/mauropereira/Desktop/notomattic-v2/tailwind.config.js`

Custom colors defined:
- `sidebar.light/dark`
- `editor.light/dark`
- `panel.light/dark`

Custom fonts defined:
- Sans (system fonts)
- Mono (SF Mono, Menlo, Monaco)

### Global Styles
**Location**: `/Users/mauropereira/Desktop/notomattic-v2/src/index.css`

Contains:
- Base body styles
- Scrollbar styling
- Component classes (.toolbar-button, .sidebar-item, etc.)
- TipTap editor styles
- Placeholder styles

### Theme Store
**Location**: `/Users/mauropereira/Desktop/notomattic-v2/src/stores/themeStore.ts`

Provides:
- `useThemeStore()` hook
- `applyTheme()` function
- localStorage persistence

---

## Color Reference Quick Sheet

### Light Mode
```
Background: white (#ffffff)
Text: gray-900 (#111827)
Secondary: gray-500 (#6b7280)
Tertiary: gray-400 (#9ca3af)
Borders: gray-200 (#e5e7eb)
Hover: gray-200 (#e5e7eb)
Active: gray-300 (#d1d5db)
Accent: blue-600 (#2563eb)
```

### Dark Mode
```
Background: gray-900 (#111827)
Text: white (#ffffff)
Secondary: gray-400 (#9ca3af)
Tertiary: gray-500 (#6b7280)
Borders: gray-700 (#374151)
Hover: gray-700 (#374151)
Active: gray-600 (#4b5563)
Accent: blue-400 (#60a5fa)
```

---

## Questions & Troubleshooting

### Dark mode classes not applying?
- Check that `document.documentElement` has `dark` class
- Verify Tailwind config has `darkMode: 'class'`
- Use `dark:` prefix in className

### Color not matching the palette?
- Check if it's a custom color (sidebar, editor, panel) vs standard Tailwind
- Look in tailwind.config.js for custom definitions
- Refer to DESIGN_TOKENS.md for correct hex values

### Component styling inconsistent?
- Check existing component patterns in COMPONENT_PATTERNS.md
- Ensure using correct spacing scale values
- Verify dark: variants are present

---

## Maintenance

These documents should be updated when:
- New colors are added to the palette
- Typography scales change
- New component patterns are established
- Theme implementation is modified
- New styling frameworks are adopted

---

**Last Updated**: November 18, 2025
**Relevant Files**: 
- `/Users/mauropereira/Desktop/notomattic-v2/DESIGN_SYSTEM.md`
- `/Users/mauropereira/Desktop/notomattic-v2/DESIGN_TOKENS.md`
- `/Users/mauropereira/Desktop/notomattic-v2/COMPONENT_PATTERNS.md`


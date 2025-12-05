# Notomattic Component Patterns

This document shows common component patterns used throughout the Notomattic codebase.

## Button Patterns

### Primary Action Button (Today's Note)
```jsx
<button
  onClick={handleClick}
  className="w-full px-3 py-2 text-sm font-medium text-white 
    bg-blue-600 rounded-lg hover:bg-blue-700 transition-colors"
>
  Today's Note
</button>
```

**Usage**: Main call-to-action buttons
**Colors**: Blue-600 (light), Blue-500 (dark)
**Hover**: Blue-700 / Blue-600

---

### Toolbar Button
```jsx
<button
  onClick={() => editor.chain().focus().toggleBold().run()}
  disabled={disabled}
  title="Bold (⌘B)"
  className={`toolbar-button ${isActive ? 'toolbar-button-active' : ''} ${
    disabled ? 'opacity-50 cursor-not-allowed' : ''
  }`}
>
  <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
    {/* SVG content */}
  </svg>
</button>
```

**Usage**: Text formatting, editor controls
**Styles**: `.toolbar-button` class from index.css
**States**: 
- Default: Gray-50 bg, transparent
- Hover: Gray-200 bg (light) / Gray-700 bg (dark)
- Active: Same as hover

---

### Icon Button (Small)
```jsx
<button
  onClick={handleClick}
  className="p-1 text-gray-500 hover:text-gray-700 
    dark:text-gray-400 dark:hover:text-gray-200"
  title="New note"
>
  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
  </svg>
</button>
```

**Usage**: Compact actions, secondary buttons
**Colors**: Gray-500/700 text with transparent background
**Hover**: Text color change (no background)

---

### Calendar Navigation Button
```jsx
<button
  onClick={handlePrevMonth}
  className="p-1 hover:bg-gray-200 dark:hover:bg-gray-700 rounded"
>
  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    {/* SVG */}
  </svg>
</button>
```

**Usage**: Navigation controls
**Hover**: Gray-200 (light) / Gray-700 (dark) background

---

## Input Patterns

### Text Input (Note Title)
```jsx
<input
  type="text"
  value={newNoteTitle}
  onChange={e => setNewNoteTitle(e.target.value)}
  onKeyDown={e => {
    if (e.key === 'Enter') handleCreateNote();
    if (e.key === 'Escape') setIsCreating(false);
  }}
  placeholder="Note title..."
  className="w-full px-2 py-1 text-sm 
    border border-gray-300 dark:border-gray-600 rounded 
    bg-white dark:bg-gray-800 
    focus:outline-none focus:ring-2 focus:ring-blue-500"
  autoFocus
/>
```

**Usage**: Text input fields
**Border**: Gray-300 (light) / Gray-600 (dark)
**Background**: White (light) / Gray-800 (dark)
**Focus**: Blue-500 ring (2px)
**Padding**: px-2 py-1

---

## Text Patterns

### Main Title (Sidebar)
```jsx
<h1 className="text-lg font-semibold text-gray-900 dark:text-white">
  Notomattic
</h1>
```

**Size**: text-lg (1.125rem)
**Weight**: font-semibold
**Color**: Gray-900 (light) / White (dark)

---

### Section Header
```jsx
<h2 className="text-xs font-semibold text-gray-500 dark:text-gray-400 
  uppercase tracking-wider mb-2">
  Daily Notes
</h2>
```

**Size**: text-xs (0.75rem)
**Weight**: font-semibold
**Color**: Gray-500 (light) / Gray-400 (dark)
**Transform**: uppercase
**Letter Spacing**: tracking-wider
**Margin**: mb-2

---

### Secondary Text
```jsx
<p className="text-xs text-gray-400 dark:text-gray-500 px-3 py-2">
  No daily notes yet
</p>
```

**Size**: text-xs
**Color**: Gray-400 (light) / Gray-500 (dark)
**Padding**: px-3 py-2

---

### Placeholder/Tertiary Text
```jsx
<div className="text-sm text-gray-400 dark:text-gray-500 italic">
  Timeline feature coming soon...
</div>
```

**Size**: text-sm
**Color**: Gray-400 (light) / Gray-500 (dark)
**Style**: italic

---

## List Patterns

### Sidebar Item List
```jsx
<div className="space-y-0.5">
  {dailyNotes.map(note => (
    <button
      key={note.path}
      onClick={() => loadNote(note)}
      className={`sidebar-item w-full text-left text-sm ${
        isNoteActive(note) 
          ? 'sidebar-item-active' 
          : 'text-gray-700 dark:text-gray-300'
      }`}
    >
      {note.date ? format(parseISO(note.date), 'MMM d, yyyy') : note.name}
    </button>
  ))}
</div>
```

**Spacing**: space-y-0.5 (2px gap between items)
**Items**: Use `.sidebar-item` and `.sidebar-item-active` classes
**Text Color**: Gray-700 (light) / Gray-300 (dark)
**Active**: Styled with `.sidebar-item-active`

---

## Container Patterns

### Flexbox Container (Layout)
```jsx
<div className="flex h-screen w-screen overflow-hidden bg-white dark:bg-gray-900">
  <div className="w-64 flex-shrink-0 border-r border-gray-200 dark:border-gray-700">
    {/* Sidebar */}
  </div>
  <div className="flex-1 flex flex-col min-w-0">
    {/* Main content */}
  </div>
  <div className="w-72 flex-shrink-0 border-l border-gray-200 dark:border-gray-700">
    {/* Right panel */}
  </div>
</div>
```

**Parent**: `flex h-screen w-screen overflow-hidden`
**Fixed Columns**: `w-64`, `w-72` with `flex-shrink-0`
**Flexible Column**: `flex-1 flex flex-col min-w-0`
**Borders**: `border-l/r border-gray-200 dark:border-gray-700`

---

### Vertical Stack (Editor)
```jsx
<div className="flex flex-col h-full">
  <div className="px-6 py-3 border-b border-gray-200 dark:border-gray-700">
    {/* Header */}
  </div>
  <div className="gap-0.5 p-2 border-b border-gray-200 dark:border-gray-700 
    bg-gray-50 dark:bg-gray-800">
    {/* Toolbar */}
  </div>
  <div className="flex-1 overflow-y-auto">
    {/* Content */}
  </div>
</div>
```

**Structure**: `flex flex-col h-full`
**Sections**: Stacked with `flex-1` for expandable content
**Overflow**: `overflow-y-auto` for scrollable content

---

## Calendar Pattern

### Calendar Grid
```jsx
<div className="grid grid-cols-7 gap-0.5">
  {days.map(day => (
    <button
      key={day.toISOString()}
      onClick={() => handleDayClick(day)}
      className={`
        aspect-square flex items-center justify-center text-xs rounded-md
        relative transition-colors
        ${!isCurrentMonth ? 'text-gray-300 dark:text-gray-600' : 'text-gray-700 dark:text-gray-300'}
        ${isSelected ? 'bg-blue-600 text-white' : 'hover:bg-gray-200 dark:hover:bg-gray-700'}
        ${isToday && !isSelected ? 'font-bold text-blue-600 dark:text-blue-400' : ''}
      `}
    >
      {format(day, 'd')}
      {dayHasNote && !isSelected && (
        <span className="absolute bottom-0.5 w-1 h-1 bg-blue-500 rounded-full" />
      )}
    </button>
  ))}
</div>
```

**Grid**: `grid grid-cols-7 gap-0.5`
**Cells**: `aspect-square` for square buttons
**Alignment**: `flex items-center justify-center`
**Size**: `text-xs`
**Radius**: `rounded-md`
**States**:
- Out of month: Gray-300 (light) / Gray-600 (dark)
- Normal: Gray-700 (light) / Gray-300 (dark)
- Selected: Blue-600 background with white text
- Today: Bold, Blue-600 (light) / Blue-400 (dark) text
- With note: Indicator dot at bottom

---

## Divider/Separator Pattern

### Horizontal Divider
```jsx
<div className="w-px h-6 bg-gray-300 dark:bg-gray-600 mx-1" />
```

**Width**: w-px (1px)
**Height**: h-6 (24px)
**Color**: Gray-300 (light) / Gray-600 (dark)
**Margin**: mx-1

---

### Border Line (Between sections)
```jsx
<div className="border-b border-gray-200 dark:border-gray-700" />
```

**Direction**: `border-b` (bottom), `border-t` (top), `border-l` (left), `border-r` (right)
**Color**: Gray-200 (light) / Gray-700 (dark)

---

## Editor Content Pattern

### Prose Area (TipTap Editor)
```jsx
<div className="flex-1 overflow-y-auto">
  <EditorContent 
    editor={editor} 
    className="h-full"
  />
</div>
```

**EditorProps** (configured in useEditor):
```javascript
editorProps: {
  attributes: {
    class: 'prose dark:prose-invert max-w-none focus:outline-none min-h-full p-6'
  }
}
```

**Classes**:
- `prose`: Tailwind typography
- `dark:prose-invert`: Dark mode typography
- `max-w-none`: Remove max-width constraint
- `focus:outline-none`: Remove focus ring
- `min-h-full`: Fill container
- `p-6`: 24px padding

---

## Common Styling Patterns

### Transition Effects
```jsx
className="transition-colors"  // Smooth color transition
className="transition: background-color 0.15s"  // Custom CSS
```

### Disabled States
```jsx
className={`... ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
```

### Truncation
```jsx
className="truncate"  // Single line ellipsis
```

### Flex Utilities
```jsx
className="flex items-center justify-between"  // Horizontal with space-between
className="flex flex-col gap-1"  // Vertical stack with gap
```

### Color Emphasis
```jsx
className="text-gray-500 dark:text-gray-400"  // Secondary text
className="text-blue-600 dark:text-blue-400"  // Accent text
className="text-white"  // High contrast
```

---

## Creating New Components

When creating new components, follow these patterns:

1. **Use Tailwind classes** for most styling
2. **Use CSS classes** from index.css for reusable button/item patterns
3. **Use dark: prefix** for all color changes
4. **Group related classes** logically
5. **Use interpolation** for conditional classes:
   ```jsx
   className={`base-classes ${isActive ? 'active-state' : 'inactive-state'}`}
   ```

Example new component:
```jsx
export function MyComponent({ isActive, onClick }) {
  return (
    <button
      onClick={onClick}
      className={`
        px-3 py-2 text-sm font-medium rounded-md
        transition-colors
        ${isActive 
          ? 'bg-blue-600 text-white' 
          : 'text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700'
        }
      `}
    >
      Click me
    </button>
  );
}
```


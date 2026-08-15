# Cream — the Moldavite design system

**This file is the only design source of truth.** It replaces five documents
(`DESIGN_SYSTEM.md`, `DESIGN_TOKENS.md`, `COMPONENT_PATTERNS.md`,
`DESIGN_DOCUMENTATION_INDEX.md`, `COLOR_PALETTE_REFERENCE.txt`) that described a
blue / Tailwind-grey system removed long ago. If you are reading a hex like
`#2563eb` or `#f5f5f5` in a design doc, that doc is dead — this one wins.

Tokens live in `src/index.css`. That file _is_ the implementation of this
document. When the two disagree, fix the code.

---

## The thesis

The design is an argument about confidence: **one voice, everything else
silent.** In a notes app that means the user's writing is the only ink on the
page, and every pixel of chrome has to justify itself against it.

Practically, when you are unsure: **remove it.** Reach for a hairline before a
border, a border before a fill, type before an icon, and nothing before any of
them.

---

## Colour

Two colours do almost all the work. Everything below is already defined in
`src/index.css` — **consume tokens, never literals.**

### Light — cream ground, ink type

| Token                          | Value                 | Use                            |
| ------------------------------ | --------------------- | ------------------------------ |
| `--bg-base`                    | `#F9F6ED`             | the ground                     |
| `--bg-sidebar`, `--bg-panel`   | `#F2EEE1`             | one step down                  |
| `--bg-editor`, `--bg-elevated` | `#FFFDF6`             | one step up — the paper        |
| `--text-primary`               | `#0E0D0A`             | body copy                      |
| `--text-secondary`             | `rgba(14,13,10,0.52)` | secondary                      |
| `--text-muted`                 | `rgba(14,13,10,0.34)` | tertiary, captions             |
| `--border-default`             | `rgba(14,13,10,0.13)` | hairlines                      |
| `--border-strong`              | `rgba(14,13,10,0.24)` | emphasis hairlines             |
| `--accent-primary`             | `#2E5B3C`             | the one accent — see rationing |

Display type and headings use pure `#000000`. Body copy uses `#0E0D0A`, very
slightly off-black, because pure black on cream vibrates over a long reading
session. This distinction is deliberate — do not "correct" it.

### Dark — the same two colours, inverted

Not a grey theme. Warm ink ground `#14120C`, cream type `#F9F6ED`. It should
read as the same brand after dark, not a different app.

### Chrome is two colours. The editor is not.

The rationing rule below governs **chrome** — rails, panels, menus, buttons,
overlays. It does **not** govern the inside of a note.

A note is the user's document, not the app's furniture, and structure in a long
document is read far faster by hue than by size alone. So the editor gets a
small fixed palette via the `--syntax-*` tokens: a heading triad (plum, moss,
amber), a fourth hue for links deliberately distinct from all three so a link
never reads as a heading, and a gold highlight. Deep and desaturated on cream;
the same four hues lifted, not re-picked, for the ink ground.

This was got wrong once already — the syntax tokens were flattened to ink
during the first pass, which made long notes structurally illegible. Don't
flatten them again.

Calendar event regions are a narrow exception to the static-surface no-fill
rule: a faint source-colour wash and full-height source bar communicate which
stretch of time is occupied. That colour is data, not decorative chrome; do not
flatten timed or all-day events back into unfilled rows.

### Rationing the accent

`--accent-primary` is a deep moss green because moldavite is impact glass and
impact glass is green. It is **not** a UI accent to sprinkle.

> **Rule: at most one green thing on screen at a time.** The active-note
> marker, or the unsaved dot. Never both. Never a button, never a link, never a
> heading.

Text selection is two-colour: a solid ink block with cream type knocked out.
Not a tint.

### Semantic colour

Kept, because losing an error state is not minimalism. Retuned to sit in cream:
error is a burnt vermilion `#B03A1A`, not the old orange.

---

## Shape

The reference has no boxes, so neither do we.

- **`--radius-sm` / `--radius-md` / `--radius-lg` are all `0`.** They are kept
  as token names only so existing `var()` calls keep resolving. Never
  reintroduce a radius, and never hardcode `border-radius` in a component.
- **All `--shadow-*` are `none`.** Elevation is a hairline, not a blur. A modal
  sits on the ground and is separated by a rule.
- Borders are hairlines at `--border-default`.
- Buttons have no fill. They are ink type with a rule.

---

## Typography

All fonts are **self-hosted via `@fontsource`. The app ships zero CDN font
requests and that is a privacy commitment, not a preference.** Never add a
`fonts.googleapis.com` link.

| Role                                | Face           | Token            |
| ----------------------------------- | -------------- | ---------------- |
| Display, headings, labels, numerals | **Geist Mono** | `--font-display` |
| UI and body                         | **Geist**      | `--font-sans`    |
| Code                                | **Geist Mono** | `--font-mono`    |

Both faces are vendored as woff2 in `public/fonts/` — no `@fontsource` package,
no CDN. Two files, one family, zero dependencies.

The pairing is deliberately technical rather than pretty: mono for anything
structural (headings, section labels, dates, counts, tab titles) and Geist for
prose and UI. Mono numerals are the reason counts and dates don't reflow while
they animate.

**Tracking is not optional on a mono display face.** Geist Mono reads loose and
wide if left at zero: `-0.02em` at 26px and above, `-0.015em` from 17–25px, `0`
below that. The uppercase editorial labels are the exception — they keep their
positive `0.14em`, which is what makes them read as labels rather than text.

Inter and Merriweather stay installed as user-selectable **editor** fonts in
Settings. They are not chrome faces. Do not remove them — saved preferences
reference them.

**The wordmark and monogram are outlined SVG paths and depend on no font at
all.** They were drawn from Jost, which is no longer installed, and that is
fine: `src/components/ui/wordmarkGlyphs.ts` holds the per-glyph path data.
Regenerate it rather than hand-editing paths.

---

## Brand assets

Two masters, and everything else is derived from them. **Never hand-edit a
derived file** — regenerate it.

| Master | Derives |
| ------ | ------- |
| `src-tauri/icons/icon-master.svg` | the entire icon set: `.icns`, `.ico`, Windows Store tiles, iOS, Android, `icon.png`, plus `public/favicon.*` and `docs/{favicon,icon}.png` |
| `docs/og-image.svg` | `docs/og-image.png` |

The app icon is **cream on ink**, not ink on cream. At 16px — favicon, menu bar,
taskbar — the ink tile keeps its silhouette against any background while a cream
tile dissolves into a light one. The mark sits at 56% of the tile; 50% tested
visibly timid below 32px.

```bash
npx tauri icon src-tauri/icons/icon-master.svg   # the whole icon set
```

The remaining PNGs are rendered from the same SVGs at 1200×630 (OG), 256, 64 and
32px. Any rasteriser works; there is deliberately no build step for four files.

**This is the one that rots.** `icon.ico` shipped for months as generic blue
"N + book + fountain pen" clipart — a placeholder that survived because macOS
never reads `.ico` and nobody on the team ran Windows. It was six weeks older
than every sibling file. If you touch one brand asset, regenerate all of them
from the master and *look at the output*, including on the platform you don't
use.

---

## Structure

The palette is only half of it. The layout was rebuilt too, and these rules are
what stop it drifting back into a generic notes app.

**Icons are earned, not default.** The sidebar, calendar, timeline, tab bar and
editor footer are type-only: an affordance there gains a **visible text label**
rather than a smaller icon, and expand/collapse is a CSS hairline caret.

Icons are used deliberately in three places, and only these: the **icon rail**
(where there is no room for labels and the tooltip carries the name), **folder
rows** (`Folder`/`FolderOpen` — in a list mixing folders, notes and tags the
glyph's job is to say which *kind* of row this is, which type cannot), and
**dialogs**. All of them use `lucide-react` at `strokeWidth={1.25}` in
`--text-muted`. Anything heavier reads as a different app.

This rule was once written as "zero icons in chrome" and that went too far —
removing the folder glyph made the Index harder to scan, not cleaner.

**No fills, no boxes.** Selection is a 2px ink left-marker, not a filled card.
Counts are plain right-aligned numerals, not badge pills. Tags are plain
`#tag` text. Buttons are type on a hairline. Nothing has a background tint
except the ground itself.

**Section labels are editorial.** `10px`, `letter-spacing: 0.14em`, uppercase,
`--text-muted`, on a `1px solid var(--border-muted)` hairline.

**One measure.** `--editor-measure` governs both the note header and the prose
body. Never hardcode a column width beside it. It is **user-controlled** —
`editorWidth` in Settings (Narrow / Medium / Wide / Full, default Wide) is
applied at runtime by `applyEditorWidth`, and each option caps against the
viewport so a narrow window keeps its margins. The original fixed `68ch` was
typographically correct and looked starved on a wide window; don't put it back
as a constant.

**Type carries hierarchy.** With no fills, radii or shadows left to lean on,
size, weight, tracking and space are the only tools. Headings are Jost at
28/21/17px with `-0.01em` tracking and asymmetric margins (~1.6em above, 0.5em
below) so they bind to the text they introduce.

**Colour is data, not decoration.** The only colour left in the interface is
the rationed accent and genuinely data-bearing colour — calendar-source
swatches (6px squares) and user-chosen note colours. If a colour is not
carrying information, it should not be there.

**Secondary empty states share one signature mark.** No search results, empty
folders, empty trash, missing backlinks and empty tag filters use the mirrored
`a` glyph from `WORDMARK_GLYPHS`, rendered at roughly 20px in `--text-muted`.
Keep the existing empty-state copy. The welcome screen remains the primary
empty state, and the signature mark never replaces or competes with the
monogram in chrome.

## Motion

Near-silent. Note switches crossfade and hairlines draw on hover. Full-window
navigation overlays are the one larger gesture: they enter over 320ms from
`translateY(8px)` and opacity zero, then exit faster over 200ms. Their columns
stagger by 18ms. Only opacity and transform animate. No glow, gradient,
parallax or bounce. `prefers-reduced-motion` skips the motion everywhere.

Click-opened navigation overlays, dropdowns, context menus and the quick
switcher set their transform origin to the trigger's position relative to the
opening surface. This impact origin carries through the existing fade and
near-imperceptible scale without changing duration or easing. Keyboard opens
fall back to the centre. Reduced motion removes the transform with the rest of
the animation.

---

## Chrome

The note is the default app surface. Navigation is summoned, not permanently
parked beside the editor:

| Surface                             | Pin setting        | Shortcut | Default           |
| ----------------------------------- | ------------------ | -------- | ----------------- |
| Index (notes, folders, daily, tags) | `showSidebar`      | `⌘\`     | overlay, unpinned |
| Agenda (calendar and timeline)      | `showRightPanel`   | `⌘⌥\`    | overlay, unpinned |
| Focus mode                          | `focusModeEnabled` | `⌘.`     | off               |

The two `show*` settings are pins. When a pin is on, its shortcut shows or
hides the classic column for the current window. When it is off, the shortcut
opens a full-window overlay. Overlay visibility is transient and never
persisted. Only one overlay can be open at a time.

The editor keeps two quiet discovery affordances: a masked monogram button for
the Index at top-left, and `Index · Agenda · Settings` text links at the bottom.

Focus mode hides pinned columns, the tab bar, footer and backlinks header at
once, leaving the note alone on cream. It is implemented as a `.focus-mode`
class on `<html>`, mirroring how `.compact-mode` already works.

---

## House rules for changing UI

1. **Consume tokens.** A raw hex in a component is a bug. The only legitimate
   literals are `themeStore.ts` preset swatches, `NoteColorPicker.tsx`'s note
   palette (persisted in user frontmatter), `GraphView.tsx` canvas fallbacks,
   and markdown-conversion colours in `fileSystem.ts`.
2. **Never write `var(--token, #fallback)`.** A fallback silently hides an
   undefined token and ships an off-palette colour. If a token is missing,
   define it. `grep -rn "var(--[a-z-]*," src/` must return nothing.
3. **New surfaces use inline `style={{}}` reading `var()`**, matching the
   dominant existing pattern. Adding classes to `index.css` serialises work on
   a 3,700-line file everything else also needs.
4. **Six theme presets ship as a feature.** `default` is Cream. Solarized,
   Dracula, Nord, Gruvbox and Sepia have canonical hexes that **cannot** be
   recoloured. Any new token added to `:root` must be considered across all
   eight blocks, and `themeStore.ts`'s `PRESETS[]` swatch array needs
   hand-syncing.
5. **New settings need three edits** — the `SettingsState` interface,
   `defaultSettings`, and the `partialize` allow-list — or they silently fail
   to persist. There is no migration needed for a new boolean.
6. **New shortcuts need two edits** — `SHORTCUTS` in `lib/shortcuts.ts` and a
   `runShortcut` case in `useKeyboardShortcuts.ts`. That hook mounts inside the
   editor tree, so anything that must work with no note open mounts at the App
   root instead, following `ShortcutHelpHost`.

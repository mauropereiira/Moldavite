# Settings Fixes, "What's New" Popup & Release Polish — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the Settings info-tooltip bug and the undefined `--accent-color` variable, add a version-gated "What's New" popup sourced from `CHANGELOG.md`, add safe Settings a11y polish, polish the release pipeline, and cut `v1.4.0`.

**Architecture:** Tauri v2 + React 19 + TypeScript + Zustand (persisted via `zustand/middleware`). UI uses CSS custom properties (`var(--...)`) for theming; components are function components with inline `style` objects. Updater + GitHub release pipeline already exist; this work adds the missing in-app release-notes surface and fixes real bugs. New pure logic is isolated in `src/lib/` for unit testing; the only Vite-specific wiring (`?raw` import) is kept out of tested units.

**Tech Stack:** React 19, TypeScript 5.9, Zustand 5, Vite 7, Vitest 4 + @testing-library/react (jsdom), Tauri v2 (`@tauri-apps/api/app` `getVersion`), lucide-react icons, Node ESM scripts.

## Global Constraints

- Version bump target: **1.3.1 → 1.4.0** (new user-facing feature → minor).
- Version must stay in sync across exactly four files: `package.json`, `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml`, `src-tauri/Cargo.lock`.
- Repo slug is `mauropereiira/Moldavite` (double-`i` owner) — do not "correct" it.
- Theme tokens only: use `var(--accent-primary)`, `var(--bg-elevated)`, `var(--text-secondary)`, etc. Never hardcode hex except existing inline fallbacks like `var(--text-error, #ef4444)`. The token `--accent-color` does NOT exist — never reintroduce it.
- Tests colocate as `*.test.ts`/`*.test.tsx`; Vitest has `globals: true` (no need to import `describe/it/expect`, but existing tests import them explicitly — follow that style), jsdom env, setup at `src/test/setup.ts`.
- Lint must pass `eslint . --ext ts,tsx`; build is `tsc && vite build`; bundle budget enforced by `npm run check:size`.
- Commit message footer for every commit:
  `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`
- Do NOT push the `v1.4.0` tag (triggers a public signed release) — stop at the PR and confirm with the user.

---

## File Structure

**Create:**
- `src/lib/changelog.ts` — pure changelog parser + version helpers (unit-tested).
- `src/lib/changelog.test.ts` — parser/version tests.
- `src/lib/releaseNotes.ts` — `?raw` CHANGELOG import wrapper (the only Vite-specific module; not unit-tested).
- `src/stores/whatsNewStore.ts` — persisted `lastSeenVersion` + transient modal state.
- `src/components/updates/WhatsNewModal.tsx` — the popup + launch-check effect.
- `src/components/updates/WhatsNewModal.test.tsx` — render test.
- `src/hooks/useFocusTrap.ts` — reusable modal focus trap.
- `src/hooks/useFocusTrap.test.tsx` — initial-focus test.
- `scripts/bump-version.mjs` — sync version across the four files.
- `scripts/extract-changelog.mjs` — extract one version's notes for CI release body.
- `docs/RELEASING.md` — release runbook.

**Modify:**
- `src/components/settings/common/InfoTooltip.tsx` — portal + flip/clamp positioning.
- `src/components/settings/SettingsModal.tsx` — remove tabpanel `tabIndex={0}`; add focus trap.
- `src/components/settings/sections/AboutSection.tsx` — `--accent-color`→`--accent-primary`; add "What's New" button.
- `src/components/updates/UpdateNotification.tsx` — `--accent-color`→`--accent-primary`.
- `src/components/templates/TemplateCard.tsx` — `--accent-color`→`--accent-primary`.
- `src/components/settings/sections/SidebarSection.tsx` — slider label association.
- `src/components/settings/sections/AppearanceSection.tsx` — slider label association.
- `src/stores/index.ts` — export `useWhatsNewStore`.
- `src/components/updates/index.ts` — export `WhatsNewModal` (verify barrel path).
- `src/hooks/index.ts` — export `useFocusTrap` (verify barrel path).
- `src/App.tsx` — mount `<WhatsNewModal />`.
- `src/vite-env.d.ts` — `*?raw` module declaration if missing.
- `.github/workflows/release.yml` — per-version release body; remove dead Ubuntu step.
- `package.json` — add `release:version` script; version bump.
- `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml`, `src-tauri/Cargo.lock` — version bump.
- `CHANGELOG.md`, `docs/PROJECT_STATUS.md`, `README.md` — docs.

**Scope note (deferred to follow-ups, recorded in PROJECT_STATUS):** segmented-button `role="radiogroup"` semantics for groups beyond what this plan touches, the General↔Data tab functional duplication, and the sidebar-width slider appearing in both Appearance and Sidebar tabs. These are mechanical/product-structure items, not bugs, and are listed as fast-follows.

---

## Task 1: Fix the undefined `--accent-color` variable

**Files:**
- Modify: `src/components/settings/sections/AboutSection.tsx` (lines 24, 25, 62, 78)
- Modify: `src/components/updates/UpdateNotification.tsx` (lines 43, 47, 81, 97)
- Modify: `src/components/templates/TemplateCard.tsx` (lines 29, 35)

**Interfaces:**
- Consumes: nothing.
- Produces: nothing (pure CSS-token correction).

- [ ] **Step 1: Confirm the bug** — `--accent-color` is referenced but never declared (only `--accent-primary`/`--accent-hover`/`--accent-subtle` exist in `src/index.css`).

Run: `grep -rn "accent-color" src/`
Expected: 10 matches across the three files above, and `grep -n -- "--accent-color" src/index.css` returns nothing.

- [ ] **Step 2: Replace all usages** with `var(--accent-primary)`.

Run:
```bash
cd /Users/mauropereira/Desktop/Development/Moldavite
sed -i '' 's/var(--accent-color)/var(--accent-primary)/g' \
  src/components/settings/sections/AboutSection.tsx \
  src/components/updates/UpdateNotification.tsx \
  src/components/templates/TemplateCard.tsx
```

- [ ] **Step 3: Verify no usages remain**

Run: `grep -rn "accent-color" src/`
Expected: no output.

- [ ] **Step 4: Type-check + lint the changed files**

Run: `npm run lint && npx tsc --noEmit`
Expected: PASS (no errors).

- [ ] **Step 5: Commit**

```bash
git add src/components/settings/sections/AboutSection.tsx src/components/updates/UpdateNotification.tsx src/components/templates/TemplateCard.tsx
git commit -m "fix(ui): replace undefined --accent-color with --accent-primary

The --accent-color CSS variable was never defined, so the Install Update
button, update banner/progress, and selected template cards rendered with
no accent color. Use the real --accent-primary token.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: Rewrite InfoTooltip with a portal + flip/clamp positioning, and stop the scroll-snap

**Files:**
- Modify: `src/components/settings/common/InfoTooltip.tsx`
- Create: `src/components/settings/common/InfoTooltip.test.tsx`
- Modify: `src/components/settings/SettingsModal.tsx:250` (remove `tabIndex={0}` from the tabpanel)

**Interfaces:**
- Consumes: nothing.
- Produces: `InfoTooltip({ text }: { text: string })` — unchanged public prop API; now renders the popover via `createPortal` into `document.body` with `role="tooltip"`.

- [ ] **Step 1: Write the failing test**

Create `src/components/settings/common/InfoTooltip.test.tsx`:
```tsx
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { InfoTooltip } from './InfoTooltip';

describe('InfoTooltip', () => {
  it('shows the text on hover, portaled to document.body', () => {
    render(<InfoTooltip text="Helpful explanation" />);
    expect(screen.queryByRole('tooltip')).toBeNull();
    fireEvent.mouseEnter(screen.getByRole('button', { name: /more information/i }));
    const tip = screen.getByRole('tooltip');
    expect(tip).toHaveTextContent('Helpful explanation');
    // Portaled directly under <body>, not nested in the trigger wrapper.
    expect(tip.parentElement).toBe(document.body);
  });

  it('hides on mouse leave', () => {
    render(<InfoTooltip text="x" />);
    const btn = screen.getByRole('button', { name: /more information/i });
    fireEvent.mouseEnter(btn);
    expect(screen.getByRole('tooltip')).toBeInTheDocument();
    fireEvent.mouseLeave(btn);
    expect(screen.queryByRole('tooltip')).toBeNull();
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npm test -- src/components/settings/common/InfoTooltip.test.tsx`
Expected: FAIL — current tooltip has no `role="tooltip"` and is not portaled to body.

- [ ] **Step 3: Replace `InfoTooltip.tsx` with the portaled implementation**

```tsx
/**
 * InfoTooltip — small (i) info icon that shows an explanatory popover on
 * hover/focus. The popover is rendered through a portal to document.body and
 * positioned with `position: fixed` from the trigger's bounding rect, so it is
 * never clipped by the Settings scroll container. It flips above the icon when
 * there isn't room below, and clamps horizontally to stay inside the viewport.
 */

import { useLayoutEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Info } from 'lucide-react';

export interface InfoTooltipProps {
  text: string;
}

const TOOLTIP_WIDTH = 260;
const GAP = 8;
const EDGE = 8;
/** Approx popover height used to decide whether to flip above. */
const FLIP_THRESHOLD = 140;

export function InfoTooltip({ text }: InfoTooltipProps) {
  const [isVisible, setIsVisible] = useState(false);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const [pos, setPos] = useState<{ top: number; left: number; placement: 'top' | 'bottom' }>({
    top: 0,
    left: 0,
    placement: 'bottom',
  });
  const tooltipId = useId();

  useLayoutEffect(() => {
    if (!isVisible) return;

    const compute = () => {
      const el = triggerRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      let left = rect.left + rect.width / 2 - TOOLTIP_WIDTH / 2;
      left = Math.max(EDGE, Math.min(left, vw - TOOLTIP_WIDTH - EDGE));
      const spaceBelow = vh - rect.bottom;
      const placement: 'top' | 'bottom' =
        spaceBelow < FLIP_THRESHOLD && rect.top > FLIP_THRESHOLD ? 'top' : 'bottom';
      const top = placement === 'bottom' ? rect.bottom + GAP : rect.top - GAP;
      setPos({ top, left, placement });
    };

    compute();
    window.addEventListener('scroll', compute, true);
    window.addEventListener('resize', compute);
    return () => {
      window.removeEventListener('scroll', compute, true);
      window.removeEventListener('resize', compute);
    };
  }, [isVisible]);

  return (
    <span className="inline-flex items-center ml-1.5">
      <button
        ref={triggerRef}
        type="button"
        className="p-0.5 rounded-full transition-all duration-200"
        style={{ color: 'var(--text-muted)', backgroundColor: 'transparent' }}
        onMouseEnter={(e) => {
          setIsVisible(true);
          e.currentTarget.style.color = 'var(--accent-primary)';
          e.currentTarget.style.backgroundColor = 'var(--accent-subtle)';
          e.currentTarget.style.transform = 'scale(1.1)';
        }}
        onMouseLeave={(e) => {
          setIsVisible(false);
          e.currentTarget.style.color = 'var(--text-muted)';
          e.currentTarget.style.backgroundColor = 'transparent';
          e.currentTarget.style.transform = 'scale(1)';
        }}
        onFocus={() => setIsVisible(true)}
        onBlur={() => setIsVisible(false)}
        aria-label="More information"
        aria-describedby={isVisible ? tooltipId : undefined}
      >
        <Info aria-hidden="true" className="w-3.5 h-3.5" />
      </button>
      {isVisible &&
        createPortal(
          <div
            id={tooltipId}
            role="tooltip"
            className="px-3 py-2 text-xs"
            style={{
              position: 'fixed',
              top: pos.top,
              left: pos.left,
              width: TOOLTIP_WIDTH,
              transform: pos.placement === 'top' ? 'translateY(-100%)' : undefined,
              backgroundColor: 'var(--bg-elevated)',
              border: '1px solid var(--border-default)',
              borderRadius: 'var(--radius-md)',
              boxShadow: 'var(--shadow-lg)',
              color: 'var(--text-secondary)',
              zIndex: 10000,
              whiteSpace: 'normal',
              pointerEvents: 'none',
            }}
          >
            {text}
          </div>,
          document.body
        )}
    </span>
  );
}
```

- [ ] **Step 4: Run the test — it passes**

Run: `npm test -- src/components/settings/common/InfoTooltip.test.tsx`
Expected: PASS (both tests).

- [ ] **Step 5: Remove the scroll-snap trigger** — delete `tabIndex={0}` from the tabpanel in `src/components/settings/SettingsModal.tsx`.

Change (around line 246-251):
```tsx
          <div
            id={tabPanelId(activeTab)}
            role="tabpanel"
            aria-labelledby={tabButtonId(activeTab)}
            tabIndex={0}
            className="flex-1 overflow-y-auto p-6 min-w-0"
          >
```
to:
```tsx
          <div
            id={tabPanelId(activeTab)}
            role="tabpanel"
            aria-labelledby={tabButtonId(activeTab)}
            className="flex-1 overflow-y-auto p-6 min-w-0"
          >
```

- [ ] **Step 6: Lint + type-check**

Run: `npm run lint && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/components/settings/common/InfoTooltip.tsx src/components/settings/common/InfoTooltip.test.tsx src/components/settings/SettingsModal.tsx
git commit -m "fix(settings): portal info tooltips and stop scroll-snap

Render InfoTooltip popovers through a portal to document.body with fixed
positioning, viewport flip, and horizontal clamping so they are no longer
clipped by the overflow-y-auto tabpanel or forced into a narrow column.
Remove tabIndex={0} from the tabpanel, which was the focus-into-view target
that snapped the panel to the top of the section.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: Reusable focus trap + apply it to SettingsModal

**Files:**
- Create: `src/hooks/useFocusTrap.ts`
- Create: `src/hooks/useFocusTrap.test.tsx`
- Modify: `src/hooks/index.ts` (add export)
- Modify: `src/components/settings/SettingsModal.tsx` (use the hook; add `ref`/`tabIndex` to the dialog box)

**Interfaces:**
- Consumes: nothing.
- Produces: `useFocusTrap(ref: React.RefObject<HTMLElement | null>, active: boolean): void` — on `active` true, moves focus into `ref`'s first focusable element, traps Tab within it, and restores focus to the previously-focused element when `active` becomes false or the component unmounts.

- [ ] **Step 1: Write the failing test**

Create `src/hooks/useFocusTrap.test.tsx`:
```tsx
import { describe, it, expect } from 'vitest';
import { useRef } from 'react';
import { render, screen } from '@testing-library/react';
import { useFocusTrap } from './useFocusTrap';

function Harness({ active }: { active: boolean }) {
  const ref = useRef<HTMLDivElement | null>(null);
  useFocusTrap(ref, active);
  return (
    <div ref={ref} tabIndex={-1}>
      <button>first</button>
      <button>second</button>
    </div>
  );
}

describe('useFocusTrap', () => {
  it('moves focus to the first focusable element when active', async () => {
    render(<Harness active />);
    // Initial focus is deferred via rAF; wait a tick.
    await new Promise((r) => setTimeout(r, 0));
    expect(document.activeElement).toBe(screen.getByText('first'));
  });

  it('does nothing when inactive', async () => {
    render(<Harness active={false} />);
    await new Promise((r) => setTimeout(r, 0));
    expect(document.activeElement).not.toBe(screen.getByText('first'));
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npm test -- src/hooks/useFocusTrap.test.tsx`
Expected: FAIL — `useFocusTrap` does not exist.

- [ ] **Step 3: Implement the hook**

Create `src/hooks/useFocusTrap.ts`:
```ts
import { useEffect } from 'react';

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Trap keyboard focus inside `ref` while `active`. On activation, focus moves
 * to the first focusable descendant (or the container). Tab/Shift+Tab cycle
 * within the container. On deactivation/unmount, focus returns to whatever was
 * focused before.
 */
export function useFocusTrap(
  ref: React.RefObject<HTMLElement | null>,
  active: boolean
): void {
  useEffect(() => {
    if (!active) return;
    const container = ref.current;
    if (!container) return;

    const previouslyFocused = document.activeElement as HTMLElement | null;

    const focusFirst = () => {
      const focusables = container.querySelectorAll<HTMLElement>(FOCUSABLE);
      (focusables.length ? focusables[0] : container).focus();
    };
    const raf = requestAnimationFrame(focusFirst);

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return;
      const focusables = Array.from(
        container.querySelectorAll<HTMLElement>(FOCUSABLE)
      );
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const activeEl = document.activeElement;
      if (e.shiftKey && activeEl === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && activeEl === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', handleKeyDown, true);

    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener('keydown', handleKeyDown, true);
      previouslyFocused?.focus?.();
    };
  }, [ref, active]);
}
```

- [ ] **Step 4: Export from the hooks barrel**

In `src/hooks/index.ts` add:
```ts
export { useFocusTrap } from './useFocusTrap';
```
(If `src/hooks/index.ts` does not exist, import directly from `@/hooks/useFocusTrap` in Task 3 Step 6 and skip this step.)

- [ ] **Step 5: Run the test — it passes**

Run: `npm test -- src/hooks/useFocusTrap.test.tsx`
Expected: PASS.

- [ ] **Step 6: Apply the hook in SettingsModal**

In `src/components/settings/SettingsModal.tsx`:

(a) Add the import near the top (after the stores import):
```tsx
import { useFocusTrap } from '@/hooks/useFocusTrap';
```

(b) Inside the component, after the existing `tabRefs` ref declaration, add a dialog ref and call the hook (place this BEFORE the `if (!settingsStore.isSettingsOpen) return null;` early return so hooks always run):
```tsx
  const dialogRef = useRef<HTMLDivElement | null>(null);
  useFocusTrap(dialogRef, settingsStore.isSettingsOpen);
```

(c) On the modal box `<div>` (currently line 162-168), add `ref={dialogRef}` and `tabIndex={-1}`:
```tsx
      <div
        ref={dialogRef}
        tabIndex={-1}
        className="w-full max-w-3xl mx-4 max-h-[85vh] flex flex-col modal-elevated modal-content-enter"
        style={{ borderRadius: 'var(--radius-md)' }}
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-modal-title"
      >
```

- [ ] **Step 7: Type-check, lint, run the focused tests**

Run: `npx tsc --noEmit && npm run lint && npm test -- src/hooks/useFocusTrap.test.tsx`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/hooks/useFocusTrap.ts src/hooks/useFocusTrap.test.tsx src/hooks/index.ts src/components/settings/SettingsModal.tsx
git commit -m "feat(a11y): focus-trap the Settings modal on open

Add a reusable useFocusTrap hook (initial focus + Tab cycling + focus
restore) and apply it to SettingsModal so keyboard focus stays inside the
dialog while it is open.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: Associate range-slider labels with their inputs

**Files:**
- Modify: `src/components/settings/sections/SidebarSection.tsx` (Sidebar Width ~99-117, Right Panel Width ~124-142)
- Modify: `src/components/settings/sections/AppearanceSection.tsx` (Sidebar Width ~209-225)

**Interfaces:**
- Consumes: nothing.
- Produces: nothing (a11y attributes only).

- [ ] **Step 1: SidebarSection — Sidebar Width.** Give the `<label>` an `htmlFor` and the `<input>` a matching `id`.

Change the label (line ~99-101) and input (line ~108-117):
```tsx
              <label htmlFor="sidebar-width-range" className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
                Sidebar Width
              </label>
```
```tsx
          <input
            id="sidebar-width-range"
            type="range"
            min="200"
            max="400"
            step="10"
            value={settings.sidebarWidth}
            onChange={(e) => settings.setSidebarWidth(Number(e.target.value))}
            className="w-full h-2 rounded appearance-none cursor-pointer"
            style={{ backgroundColor: 'var(--bg-inset)', accentColor: 'var(--accent-primary)' }}
          />
```

- [ ] **Step 2: SidebarSection — Right Panel Width.**

```tsx
                <label htmlFor="right-panel-width-range" className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
                  Right Panel Width
                </label>
```
```tsx
            <input
              id="right-panel-width-range"
              type="range"
              min="250"
              max="500"
              step="10"
              value={settings.rightPanelWidth}
              onChange={(e) => settings.setRightPanelWidth(Number(e.target.value))}
              className="w-full h-2 rounded appearance-none cursor-pointer"
              style={{ backgroundColor: 'var(--bg-inset)', accentColor: 'var(--accent-primary)' }}
            />
```

- [ ] **Step 3: AppearanceSection — Sidebar Width.** This slider duplicates the Sidebar tab's; use a distinct id to avoid an id collision when both render.

```tsx
            <label htmlFor="appearance-sidebar-width-range" className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
              Sidebar Width
            </label>
```
```tsx
          <input
            id="appearance-sidebar-width-range"
            type="range"
            min="200"
            max="400"
            step="10"
            value={settings.sidebarWidth}
            onChange={(e) => settings.setSidebarWidth(Number(e.target.value))}
            className="w-full h-2 rounded appearance-none cursor-pointer"
            style={{ backgroundColor: 'var(--bg-inset)', accentColor: 'var(--accent-primary)' }}
          />
```

- [ ] **Step 4: Lint + type-check**

Run: `npm run lint && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/settings/sections/SidebarSection.tsx src/components/settings/sections/AppearanceSection.tsx
git commit -m "fix(a11y): associate sidebar width sliders with their labels

Add matching id/htmlFor to the Sidebar Width and Right Panel Width range
inputs so clicking the label focuses the slider and screen readers announce
the control name.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 5: Changelog parser + version helpers (pure, unit-tested)

**Files:**
- Create: `src/lib/changelog.ts`
- Create: `src/lib/changelog.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `interface ChangelogGroup { title: string; items: string[]; }`
  - `interface ChangelogEntry { version: string; date: string | null; groups: ChangelogGroup[]; }`
  - `parseChangelog(raw: string, version: string): ChangelogEntry | null`
  - `isNewerVersion(a: string, b: string): boolean` — true when semver `a > b`.
  - `shouldShowWhatsNew(args: { lastSeenVersion: string | null; currentVersion: string; hasEntry: boolean }): boolean`

- [ ] **Step 1: Write the failing tests**

Create `src/lib/changelog.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { parseChangelog, isNewerVersion, shouldShowWhatsNew } from './changelog';

const SAMPLE = `# Changelog

All notable changes to Moldavite are documented here.

## [1.4.0] - 2026-06-30

### Added
- **What's New popup** — shows release notes after an update.
- **Plugin commands** — register palette commands.

### Fixed
- **Info tooltips** — no longer clipped off-screen.

## [1.3.1] - 2026-05-02

### Fixed
- **Pinned tabs** — survive sidebar navigation.
`;

describe('parseChangelog', () => {
  it('extracts the requested version section with grouped bullets', () => {
    const entry = parseChangelog(SAMPLE, '1.4.0');
    expect(entry).not.toBeNull();
    expect(entry!.version).toBe('1.4.0');
    expect(entry!.date).toBe('2026-06-30');
    expect(entry!.groups).toHaveLength(2);
    expect(entry!.groups[0].title).toBe('Added');
    expect(entry!.groups[0].items).toHaveLength(2);
    // Markdown bold markers are stripped for safe plain-text rendering.
    expect(entry!.groups[0].items[0]).toContain("What's New popup");
    expect(entry!.groups[0].items[0]).not.toContain('**');
    expect(entry!.groups[1].title).toBe('Fixed');
  });

  it('does not bleed into the next version section', () => {
    const entry = parseChangelog(SAMPLE, '1.4.0');
    const all = entry!.groups.flatMap((g) => g.items).join(' ');
    expect(all).not.toContain('Pinned tabs');
  });

  it('returns null for a version not present', () => {
    expect(parseChangelog(SAMPLE, '9.9.9')).toBeNull();
  });

  it('returns null for malformed input', () => {
    expect(parseChangelog('not a changelog', '1.0.0')).toBeNull();
  });
});

describe('isNewerVersion', () => {
  it('compares semver numerically', () => {
    expect(isNewerVersion('1.4.0', '1.3.1')).toBe(true);
    expect(isNewerVersion('1.10.0', '1.9.9')).toBe(true);
    expect(isNewerVersion('1.3.1', '1.4.0')).toBe(false);
    expect(isNewerVersion('1.4.0', '1.4.0')).toBe(false);
  });
  it('ignores pre-release suffixes', () => {
    expect(isNewerVersion('1.4.0-beta.1', '1.3.1')).toBe(true);
  });
});

describe('shouldShowWhatsNew', () => {
  it('does not show on first launch (no lastSeenVersion)', () => {
    expect(
      shouldShowWhatsNew({ lastSeenVersion: null, currentVersion: '1.4.0', hasEntry: true })
    ).toBe(false);
  });
  it('shows when current is newer and an entry exists', () => {
    expect(
      shouldShowWhatsNew({ lastSeenVersion: '1.3.1', currentVersion: '1.4.0', hasEntry: true })
    ).toBe(true);
  });
  it('does not show without a changelog entry', () => {
    expect(
      shouldShowWhatsNew({ lastSeenVersion: '1.3.1', currentVersion: '1.4.0', hasEntry: false })
    ).toBe(false);
  });
  it('does not show on same version or downgrade', () => {
    expect(
      shouldShowWhatsNew({ lastSeenVersion: '1.4.0', currentVersion: '1.4.0', hasEntry: true })
    ).toBe(false);
    expect(
      shouldShowWhatsNew({ lastSeenVersion: '1.4.0', currentVersion: '1.3.1', hasEntry: true })
    ).toBe(false);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npm test -- src/lib/changelog.test.ts`
Expected: FAIL — module `./changelog` not found.

- [ ] **Step 3: Implement the parser**

Create `src/lib/changelog.ts`:
```ts
/**
 * Pure helpers for reading Keep-a-Changelog formatted release notes and
 * deciding when to show the in-app "What's New" popup. No I/O — the raw
 * changelog string is injected by the caller (see lib/releaseNotes.ts).
 */

export interface ChangelogGroup {
  title: string;
  items: string[];
}

export interface ChangelogEntry {
  version: string;
  date: string | null;
  groups: ChangelogGroup[];
}

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Remove markdown emphasis markers so notes render as safe plain text. */
const stripEmphasis = (s: string) => s.replace(/\*\*/g, '').replace(/`/g, '').trim();

/**
 * Extract the section for `version` from a Keep-a-Changelog document.
 * Returns null if the version heading is not found.
 */
export function parseChangelog(raw: string, version: string): ChangelogEntry | null {
  if (!raw || typeof raw !== 'string') return null;
  const lines = raw.split(/\r?\n/);

  const headingRe = new RegExp(`^##\\s*\\[${escapeRegExp(version)}\\]\\s*(?:-\\s*(.+))?\\s*$`);
  let start = -1;
  let date: string | null = null;
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(headingRe);
    if (m) {
      start = i;
      date = m[1] ? m[1].trim() : null;
      break;
    }
  }
  if (start === -1) return null;

  const groups: ChangelogGroup[] = [];
  let current: ChangelogGroup | null = null;
  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i];
    if (/^##\s/.test(line)) break; // next version section
    const sub = line.match(/^###\s+(.+?)\s*$/);
    if (sub) {
      current = { title: sub[1].trim(), items: [] };
      groups.push(current);
      continue;
    }
    const bullet = line.match(/^\s*-\s+(.*)$/);
    if (bullet) {
      if (!current) {
        current = { title: 'Changes', items: [] };
        groups.push(current);
      }
      current.items.push(stripEmphasis(bullet[1]));
    }
  }

  const nonEmpty = groups.filter((g) => g.items.length > 0);
  if (nonEmpty.length === 0) return null;
  return { version, date, groups: nonEmpty };
}

const numericParts = (v: string): number[] =>
  v
    .split('-')[0]
    .split('.')
    .map((n) => parseInt(n, 10) || 0);

/** True when semver `a` is strictly greater than `b` (pre-release ignored). */
export function isNewerVersion(a: string, b: string): boolean {
  const pa = numericParts(a);
  const pb = numericParts(b);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const x = pa[i] ?? 0;
    const y = pb[i] ?? 0;
    if (x !== y) return x > y;
  }
  return false;
}

export function shouldShowWhatsNew(args: {
  lastSeenVersion: string | null;
  currentVersion: string;
  hasEntry: boolean;
}): boolean {
  const { lastSeenVersion, currentVersion, hasEntry } = args;
  if (lastSeenVersion === null) return false; // first launch
  if (!hasEntry) return false;
  return isNewerVersion(currentVersion, lastSeenVersion);
}
```

- [ ] **Step 4: Run the tests — they pass**

Run: `npm test -- src/lib/changelog.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add src/lib/changelog.ts src/lib/changelog.test.ts
git commit -m "feat(updates): add changelog parser and version helpers

Pure parseChangelog/isNewerVersion/shouldShowWhatsNew used by the What's New
popup. Parses Keep-a-Changelog sections into grouped bullets and decides when
to show release notes after an update.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 6: Wire the raw CHANGELOG import

**Files:**
- Create: `src/lib/releaseNotes.ts`
- Modify: `src/vite-env.d.ts` (only if the `?raw` type is missing)

**Interfaces:**
- Consumes: `parseChangelog`, `ChangelogEntry` from `./changelog`.
- Produces: `getReleaseNotes(version: string): ChangelogEntry | null` — parses the bundled `CHANGELOG.md` for `version`.

- [ ] **Step 1: Implement the wrapper**

Create `src/lib/releaseNotes.ts`:
```ts
/**
 * Bundles the project CHANGELOG.md at build time (Vite `?raw`) and exposes the
 * parsed notes for a given version. This is the single place that performs the
 * Vite-specific raw import, keeping changelog.ts pure and unit-testable.
 */
import changelogRaw from '../../CHANGELOG.md?raw';
import { parseChangelog, type ChangelogEntry } from './changelog';

export function getReleaseNotes(version: string): ChangelogEntry | null {
  try {
    return parseChangelog(changelogRaw, version);
  } catch {
    return null;
  }
}
```

- [ ] **Step 2: Ensure the `?raw` type exists**

Run: `grep -n "vite/client\|?raw" src/vite-env.d.ts`
- If it references `/// <reference types="vite/client" />` (which declares `*?raw`), no change is needed.
- If `npx tsc --noEmit` (next step) errors on the `?raw` import, append to `src/vite-env.d.ts`:
```ts
declare module '*?raw' {
  const content: string;
  export default content;
}
```

- [ ] **Step 3: Type-check (verifies the import resolves)**

Run: `npx tsc --noEmit`
Expected: PASS. (If it fails on the `?raw` import, apply Step 2's declaration, then rerun.)

- [ ] **Step 4: Commit**

```bash
git add src/lib/releaseNotes.ts src/vite-env.d.ts
git commit -m "feat(updates): bundle CHANGELOG.md and expose parsed release notes

Add releaseNotes.getReleaseNotes(version), the single site that imports
CHANGELOG.md via Vite ?raw and parses it, so the changelog logic stays pure.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 7: whatsNewStore (persisted lastSeenVersion + transient modal state)

**Files:**
- Create: `src/stores/whatsNewStore.ts`
- Modify: `src/stores/index.ts` (export + doc line)

**Interfaces:**
- Consumes: `ChangelogEntry` from `@/lib/changelog`.
- Produces: `useWhatsNewStore` with state `{ lastSeenVersion: string | null; isOpen: boolean; entry: ChangelogEntry | null }` and actions `open(entry: ChangelogEntry): void`, `close(): void`, `markSeen(version: string): void`. Only `lastSeenVersion` is persisted (key `moldavite-whats-new`).

- [ ] **Step 1: Implement the store**

Create `src/stores/whatsNewStore.ts`:
```ts
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { ChangelogEntry } from '@/lib/changelog';

interface WhatsNewState {
  /** Last app version the user has seen the What's New popup for (persisted). */
  lastSeenVersion: string | null;
  /** Whether the popup is currently open (transient). */
  isOpen: boolean;
  /** The release-notes entry to display (transient). */
  entry: ChangelogEntry | null;
  open: (entry: ChangelogEntry) => void;
  close: () => void;
  markSeen: (version: string) => void;
}

export const useWhatsNewStore = create<WhatsNewState>()(
  persist(
    (set) => ({
      lastSeenVersion: null,
      isOpen: false,
      entry: null,
      open: (entry) => set({ entry, isOpen: true }),
      close: () => set({ isOpen: false }),
      markSeen: (version) => set({ lastSeenVersion: version }),
    }),
    {
      name: 'moldavite-whats-new',
      // Persist only the durable cursor, not transient modal state.
      partialize: (state) => ({ lastSeenVersion: state.lastSeenVersion }),
    }
  )
);
```

- [ ] **Step 2: Export from the stores barrel**

In `src/stores/index.ts`, add to the "Feature stores" group (after the `useUpdateStore` line):
```ts
export { useWhatsNewStore } from './whatsNewStore';
```
And add to the `## Available Stores` doc list near the top:
```
 * - `useWhatsNewStore` - "What's New" release-notes popup state
```

- [ ] **Step 3: Type-check + lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/stores/whatsNewStore.ts src/stores/index.ts
git commit -m "feat(updates): add whatsNewStore for the release-notes popup

Persists lastSeenVersion (key moldavite-whats-new) and holds transient
open/entry state for the What's New modal.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 8: WhatsNewModal component + launch check + mount in App

**Files:**
- Create: `src/components/updates/WhatsNewModal.tsx`
- Create: `src/components/updates/WhatsNewModal.test.tsx`
- Modify: `src/components/updates/index.ts` (barrel export — verify the path; the components barrel re-exports `./updates`)
- Modify: `src/App.tsx` (mount `<WhatsNewModal />`)

**Interfaces:**
- Consumes: `useWhatsNewStore`, `getReleaseNotes`, `useFocusTrap`, `getVersion` from `@tauri-apps/api/app`, `shouldShowWhatsNew` from `@/lib/changelog`.
- Produces: `WhatsNewModal()` — always mounted; renders `null` unless `useWhatsNewStore.isOpen`. On mount it runs the launch check (compares `getVersion()` to `lastSeenVersion`, opens itself when newer with notes, then calls `markSeen`).

- [ ] **Step 1: Write the failing test**

Create `src/components/updates/WhatsNewModal.test.tsx`:
```tsx
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { WhatsNewModal } from './WhatsNewModal';
import { useWhatsNewStore } from '@/stores/whatsNewStore';

// getVersion is async; resolve to a fixed version so the launch effect is deterministic.
vi.mock('@tauri-apps/api/app', () => ({ getVersion: () => Promise.resolve('1.4.0') }));

describe('WhatsNewModal', () => {
  beforeEach(() => {
    useWhatsNewStore.setState({ lastSeenVersion: '1.4.0', isOpen: false, entry: null });
  });

  it('renders nothing when closed', () => {
    const { container } = render(<WhatsNewModal />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders the version, groups, and bullets when opened', () => {
    render(<WhatsNewModal />);
    useWhatsNewStore.getState().open({
      version: '1.4.0',
      date: '2026-06-30',
      groups: [{ title: 'Fixed', items: ['Info tooltips no longer clipped'] }],
    });
    expect(screen.getByText(/what's new/i)).toBeInTheDocument();
    expect(screen.getByText(/1\.4\.0/)).toBeInTheDocument();
    expect(screen.getByText('Fixed')).toBeInTheDocument();
    expect(screen.getByText('Info tooltips no longer clipped')).toBeInTheDocument();
  });

  it('closes when the dismiss button is clicked', () => {
    render(<WhatsNewModal />);
    useWhatsNewStore.getState().open({ version: '1.4.0', date: null, groups: [{ title: 'Added', items: ['x'] }] });
    fireEvent.click(screen.getByRole('button', { name: /got it/i }));
    expect(useWhatsNewStore.getState().isOpen).toBe(false);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npm test -- src/components/updates/WhatsNewModal.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the component**

Create `src/components/updates/WhatsNewModal.tsx`:
```tsx
/**
 * WhatsNewModal — shows release notes after the app updates to a new version.
 *
 * Always mounted (in App). On mount it compares the running version to the
 * persisted lastSeenVersion and opens itself when the running version is newer
 * and has a CHANGELOG entry (never on first launch). Re-openable from
 * Settings → About via useWhatsNewStore.open().
 */
import { useEffect, useRef } from 'react';
import { Sparkles, X } from 'lucide-react';
import { getVersion } from '@tauri-apps/api/app';
import { useWhatsNewStore } from '@/stores/whatsNewStore';
import { getReleaseNotes } from '@/lib/releaseNotes';
import { shouldShowWhatsNew } from '@/lib/changelog';
import { useFocusTrap } from '@/hooks/useFocusTrap';

export function WhatsNewModal() {
  const { isOpen, entry, open, close, markSeen } = useWhatsNewStore();
  const dialogRef = useRef<HTMLDivElement | null>(null);
  useFocusTrap(dialogRef, isOpen);

  // Launch check: show notes once per upgrade. Never blocks app startup.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const current = await getVersion();
        const releaseEntry = getReleaseNotes(current);
        const lastSeen = useWhatsNewStore.getState().lastSeenVersion;
        if (
          !cancelled &&
          shouldShowWhatsNew({
            lastSeenVersion: lastSeen,
            currentVersion: current,
            hasEntry: !!releaseEntry,
          }) &&
          releaseEntry
        ) {
          open(releaseEntry);
        }
        if (!cancelled) markSeen(current);
      } catch (err) {
        console.error('[whatsNew] launch check failed:', err);
      }
    })();
    return () => {
      cancelled = true;
    };
    // Run once on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!isOpen || !entry) return null;

  return (
    <div
      className="fixed inset-0 modal-backdrop-dark flex items-center justify-center z-[9999] modal-backdrop-enter"
      onClick={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <div
        ref={dialogRef}
        tabIndex={-1}
        className="w-full max-w-md mx-4 max-h-[80vh] flex flex-col modal-elevated modal-content-enter"
        style={{ borderRadius: 'var(--radius-md)' }}
        role="dialog"
        aria-modal="true"
        aria-labelledby="whats-new-title"
      >
        {/* Header */}
        <div
          className="flex items-center justify-between px-6 py-4 flex-shrink-0"
          style={{ borderBottom: '1px solid var(--border-default)' }}
        >
          <div className="flex items-center gap-2">
            <Sparkles aria-hidden="true" className="w-5 h-5" style={{ color: 'var(--accent-primary)' }} />
            <h2 id="whats-new-title" className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>
              What's New in v{entry.version}
            </h2>
          </div>
          <button
            onClick={close}
            className="p-1 transition-colors"
            style={{ color: 'var(--text-muted)', borderRadius: 'var(--radius-sm)' }}
            aria-label="Close what's new"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-5">
          {entry.date && (
            <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
              {entry.date}
            </p>
          )}
          {entry.groups.map((group) => (
            <div key={group.title} className="space-y-2">
              <h3 className="text-sm font-semibold" style={{ color: 'var(--accent-primary)' }}>
                {group.title}
              </h3>
              <ul className="space-y-1.5">
                {group.items.map((item, i) => (
                  <li
                    key={i}
                    className="text-sm flex gap-2"
                    style={{ color: 'var(--text-secondary)' }}
                  >
                    <span aria-hidden="true" style={{ color: 'var(--accent-primary)' }}>
                      •
                    </span>
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        {/* Footer */}
        <div className="flex justify-end px-6 py-4 flex-shrink-0" style={{ borderTop: '1px solid var(--border-default)' }}>
          <button
            onClick={close}
            className="px-4 py-2 text-sm font-medium text-white transition-colors"
            style={{ backgroundColor: 'var(--accent-primary)', borderRadius: 'var(--radius-sm)' }}
          >
            Got it
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run the test — it passes**

Run: `npm test -- src/components/updates/WhatsNewModal.test.tsx`
Expected: PASS (3 tests).

- [ ] **Step 5: Export from the updates barrel**

Check `src/components/updates/index.ts`:
Run: `cat src/components/updates/index.ts`
Add (matching the existing export style in that file):
```ts
export { WhatsNewModal } from './WhatsNewModal';
```
(If `UpdateNotification` is exported there, mirror its exact syntax.)

- [ ] **Step 6: Mount in App**

In `src/App.tsx`:
- Add `WhatsNewModal` to the import from `./components` (line 2), e.g.:
```tsx
import { Layout, ToastContainer, UpdateNotification, WhatsNewModal, CalendarOnboardingModal, AppOnboardingModal } from './components';
```
- Add `<WhatsNewModal />` to the render tree next to `<UpdateNotification />`:
```tsx
      <UpdateNotification />
      <WhatsNewModal />
```

- [ ] **Step 7: Type-check, lint, run the test again**

Run: `npx tsc --noEmit && npm run lint && npm test -- src/components/updates/WhatsNewModal.test.tsx`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/components/updates/WhatsNewModal.tsx src/components/updates/WhatsNewModal.test.tsx src/components/updates/index.ts src/App.tsx
git commit -m "feat(updates): add What's New popup shown after app updates

WhatsNewModal compares the running version to the persisted lastSeenVersion
on launch and shows the CHANGELOG notes for the new version once per upgrade
(never on first launch). Mounted in App alongside UpdateNotification.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 9: "What's New" re-open button in the About tab

**Files:**
- Modify: `src/components/settings/sections/AboutSection.tsx`

**Interfaces:**
- Consumes: `useWhatsNewStore` (open), `getReleaseNotes`.
- Produces: nothing.

- [ ] **Step 1: Add imports** to `AboutSection.tsx` (extend the existing imports):
```tsx
import { useWhatsNewStore } from '@/stores';
import { getReleaseNotes } from '@/lib/releaseNotes';
```
(Add `useWhatsNewStore` to the existing `@/stores` import line if you prefer a single import.)

- [ ] **Step 2: In the `AboutSection` component body**, after the `appVersion` effect, add a handler:
```tsx
  const openWhatsNew = useWhatsNewStore((s) => s.open);
  const handleShowWhatsNew = () => {
    const entry = getReleaseNotes(appVersion);
    if (entry) {
      setIsSettingsOpen(false); // close settings so the popup is visible
      openWhatsNew(entry);
    }
  };
```

- [ ] **Step 3: Add the button** inside the "App Info + Update Section" block, right after the version `<p>` (line ~142-145), so it sits under the version number:
```tsx
          <button
            type="button"
            onClick={handleShowWhatsNew}
            className="mt-1 text-xs underline-offset-2 hover:underline transition-colors"
            style={{ color: 'var(--accent-primary)', background: 'transparent' }}
          >
            What's new in this version
          </button>
```

- [ ] **Step 4: Type-check + lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/settings/sections/AboutSection.tsx
git commit -m "feat(about): add 'What's new in this version' link

Lets users re-open the release-notes popup for the current version from
Settings → About.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 10: Version-sync script + bump to 1.4.0

**Files:**
- Create: `scripts/bump-version.mjs`
- Modify: `package.json` (add `release:version` script; bumped version)
- Modify (by running the script): `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml`, `src-tauri/Cargo.lock`

**Interfaces:**
- Consumes: nothing.
- Produces: `node scripts/bump-version.mjs <x.y.z>` updates the version in all four files and prints a confirmation.

- [ ] **Step 1: Implement the script**

Create `scripts/bump-version.mjs`:
```js
#!/usr/bin/env node
// Sync the app version across package.json, tauri.conf.json, Cargo.toml, and
// Cargo.lock. Usage: node scripts/bump-version.mjs 1.4.0
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');

const version = process.argv[2];
if (!version || !/^\d+\.\d+\.\d+$/.test(version)) {
  console.error('Usage: node scripts/bump-version.mjs <x.y.z>');
  process.exit(1);
}

// package.json
const pkgPath = join(root, 'package.json');
const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
pkg.version = version;
writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');

// tauri.conf.json
const confPath = join(root, 'src-tauri', 'tauri.conf.json');
const conf = JSON.parse(readFileSync(confPath, 'utf8'));
conf.version = version;
writeFileSync(confPath, JSON.stringify(conf, null, 2) + '\n');

// Cargo.toml — first `version = "..."` under [package]
const cargoPath = join(root, 'src-tauri', 'Cargo.toml');
let cargo = readFileSync(cargoPath, 'utf8');
cargo = cargo.replace(
  /(\[package\][\s\S]*?\nversion\s*=\s*")[^"]+(")/,
  `$1${version}$2`
);
writeFileSync(cargoPath, cargo);

// Cargo.lock — the [[package]] block whose name = "moldavite"
const lockPath = join(root, 'src-tauri', 'Cargo.lock');
let lock = readFileSync(lockPath, 'utf8');
lock = lock.replace(
  /(name = "moldavite"\nversion = ")[^"]+(")/,
  `$1${version}$2`
);
writeFileSync(lockPath, lock);

console.log(`Bumped version to ${version} in package.json, tauri.conf.json, Cargo.toml, Cargo.lock`);
```

- [ ] **Step 2: Add the npm script** to `package.json` `scripts` (after `"check:size"`):
```json
    "release:version": "node scripts/bump-version.mjs",
```

- [ ] **Step 3: Run the bump to 1.4.0**

Run: `node scripts/bump-version.mjs 1.4.0`
Expected: prints the confirmation line.

- [ ] **Step 4: Verify all four files are in sync**

Run:
```bash
node -p "require('./package.json').version"
node -p "require('./src-tauri/tauri.conf.json').version"
grep -m1 '^version' src-tauri/Cargo.toml
grep -A1 'name = "moldavite"' src-tauri/Cargo.lock | grep version
```
Expected: `1.4.0` in all four.

- [ ] **Step 5: Commit**

```bash
git add scripts/bump-version.mjs package.json src-tauri/tauri.conf.json src-tauri/Cargo.toml src-tauri/Cargo.lock
git commit -m "chore(release): add version-sync script and bump to 1.4.0

scripts/bump-version.mjs keeps the version in lockstep across package.json,
tauri.conf.json, Cargo.toml, and Cargo.lock. Bump to 1.4.0.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 11: Per-version release notes in CI + remove the dead Ubuntu step

**Files:**
- Create: `scripts/extract-changelog.mjs`
- Modify: `.github/workflows/release.yml`

**Interfaces:**
- Consumes: nothing.
- Produces: `node scripts/extract-changelog.mjs <x.y.z>` prints that version's CHANGELOG section to stdout (or a fallback line if absent).

- [ ] **Step 1: Implement the extractor**

Create `scripts/extract-changelog.mjs`:
```js
#!/usr/bin/env node
// Print the CHANGELOG.md section for a given version (for the GitHub release
// body). Usage: node scripts/extract-changelog.mjs 1.4.0
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const version = (process.argv[2] || '').replace(/^v/, '');
const raw = readFileSync(join(__dirname, '..', 'CHANGELOG.md'), 'utf8');
const lines = raw.split(/\r?\n/);

const esc = version.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const headingRe = new RegExp(`^##\\s*\\[${esc}\\]`);
let start = -1;
for (let i = 0; i < lines.length; i++) {
  if (headingRe.test(lines[i])) {
    start = i;
    break;
  }
}
if (start === -1) {
  console.log(`See CHANGELOG.md for details on v${version}.`);
  process.exit(0);
}
const out = [];
for (let i = start + 1; i < lines.length; i++) {
  if (/^##\s/.test(lines[i])) break;
  out.push(lines[i]);
}
console.log(out.join('\n').trim());
```

- [ ] **Step 2: Update `release.yml` — add an extraction step and use it as the body.**

In the `create-release` job, after the `Get version` step and before `Create release`, add:
```yaml
      - name: Extract release notes
        run: |
          node scripts/extract-changelog.mjs "$PACKAGE_VERSION" > release-notes.md
          echo "Extracted notes for $PACKAGE_VERSION"
```

Then change the `Create release` step's `script` body to read the file. Replace the existing `body: \`...\`` line with a version that prepends the extracted notes:
```yaml
      - name: Create release
        id: create-release
        uses: actions/github-script@v7
        with:
          script: |
            const fs = require('fs');
            const notes = fs.readFileSync('release-notes.md', 'utf8').trim();
            const body = [
              `## What's New`,
              ``,
              notes,
              ``,
              `## Installation`,
              ``,
              `### macOS`,
              `1. Download \`Moldavite_${process.env.PACKAGE_VERSION}_aarch64.dmg\` (Apple Silicon) or \`Moldavite_${process.env.PACKAGE_VERSION}_x64.dmg\` (Intel)`,
              `2. Open the DMG and drag to Applications`,
              `3. First launch: Right-click the app → Open → Open (this is only needed once)`,
              ``,
              `### Windows`,
              `1. Download \`Moldavite_${process.env.PACKAGE_VERSION}_x64-setup.exe\` (recommended) or \`.msi\``,
              `2. Run the installer`,
              `3. Windows may show SmartScreen warning - click "More info" → "Run anyway"`,
            ].join('\n');
            const { data } = await github.rest.repos.createRelease({
              owner: context.repo.owner,
              repo: context.repo.repo,
              tag_name: `${process.env.GITHUB_REF_NAME}`,
              name: `Moldavite ${process.env.GITHUB_REF_NAME}`,
              body,
              draft: false,
              prerelease: false
            })
            return data.id
```

- [ ] **Step 3: Remove the dead Ubuntu dependency step** in the `build-tauri` job (there is no `ubuntu-latest` in the matrix). Delete:
```yaml
      - name: Install dependencies (Ubuntu only)
        if: matrix.platform == 'ubuntu-latest'
        run: |
          sudo apt-get update
          sudo apt-get install -y libwebkit2gtk-4.0-dev libappindicator3-dev librsvg2-dev patchelf
```

- [ ] **Step 4: Smoke-test the extractor locally** (after Task 13 adds the 1.4.0 entry, this prints real notes; for now it prints the 1.3.1 section or fallback):

Run: `node scripts/extract-changelog.mjs 1.3.1`
Expected: prints the `### Fixed` / `### Added` bullets from the 1.3.1 section.

- [ ] **Step 5: Validate the workflow YAML parses**

Run: `node -e "const y=require('fs').readFileSync('.github/workflows/release.yml','utf8'); if(!/Extract release notes/.test(y)||/ubuntu-latest' *$/m.test(y)&&/Install dependencies \(Ubuntu only\)/.test(y)) throw new Error('check edits'); console.log('ok')"`
Expected: `ok` (the dead step removed, extraction step present).

- [ ] **Step 6: Commit**

```bash
git add scripts/extract-changelog.mjs .github/workflows/release.yml
git commit -m "ci(release): per-version release notes; drop dead Ubuntu step

Extract the matching CHANGELOG section into the GitHub release body so notes
match the in-app What's New popup. Remove the Ubuntu deps step that had no
matching matrix entry.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 12: RELEASING.md runbook

**Files:**
- Create: `docs/RELEASING.md`

**Interfaces:** none.

- [ ] **Step 1: Write the runbook**

Create `docs/RELEASING.md`:
```markdown
# Releasing Moldavite

Moldavite ships signed + notarized macOS (Apple Silicon + Intel) and Windows
builds via GitHub Actions, and updates existing installs through the Tauri
updater. This is the end-to-end release process.

## 1. Prepare the release branch

1. Branch from `main`: `git checkout -b release/vX.Y.Z`.
2. Bump the version everywhere it lives (keeps all four files in sync):
   ```bash
   npm run release:version -- X.Y.Z
   ```
   This updates `package.json`, `src-tauri/tauri.conf.json`,
   `src-tauri/Cargo.toml`, and `src-tauri/Cargo.lock`.
3. Add a `## [X.Y.Z] - YYYY-MM-DD` section to `CHANGELOG.md` (Keep-a-Changelog
   format: `### Added` / `### Changed` / `### Fixed` / `### Removed`). This is
   the single source of truth — it becomes both the GitHub release body and the
   in-app "What's New" popup.
4. Commit and open a PR into `main`. Let CI (`ci.yml`) pass.

## 2. Tag and publish

1. Merge the PR.
2. From `main`, create and push the tag:
   ```bash
   git checkout main && git pull
   git tag vX.Y.Z
   git push origin vX.Y.Z
   ```
3. The tag push triggers `.github/workflows/release.yml`, which:
   - creates a GitHub Release whose body is the extracted `CHANGELOG.md`
     section for this version,
   - builds, signs, and notarizes macOS aarch64 + x86_64 and Windows,
   - uploads artifacts and generates `latest.json` (the updater manifest).

## 3. Verify

- Confirm the Release has the DMGs, the `.exe`/`.msi`, and `latest.json`.
- Open an older install → it should detect the update within ~5s (or via
  Settings → About → Check for Updates), download, install, and relaunch.
- On relaunch, the "What's New" popup shows this version's notes.

## Required GitHub secrets

| Secret | Purpose |
|---|---|
| `APPLE_CERTIFICATE`, `APPLE_CERTIFICATE_PASSWORD` | Developer ID signing cert (base64 .p12) |
| `APPLE_ID`, `APPLE_PASSWORD`, `APPLE_TEAM_ID` | Apple notarization |
| `TAURI_SIGNING_PRIVATE_KEY`, `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | Updater artifact signing |

## Updater key rotation

The updater verifies downloads against the public key hardcoded in
`src-tauri/tauri.conf.json` (`plugins.updater.pubkey`). It MUST correspond to
the private key in `TAURI_SIGNING_PRIVATE_KEY`. To rotate keys, generate a new
keypair with `npm run tauri signer generate`, update both the secret and the
`pubkey` in `tauri.conf.json` in the same release, and note that clients on the
old key cannot verify updates signed with the new key — plan a transition.

## Versioning

Semantic versioning: bug-fix-only → patch; new user-facing feature →
minor; breaking change → major.
```

- [ ] **Step 2: Commit**

```bash
git add docs/RELEASING.md
git commit -m "docs: add release runbook (RELEASING.md)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 13: CHANGELOG 1.4.0 entry + docs updates + flagged follow-ups

**Files:**
- Modify: `CHANGELOG.md`
- Modify: `docs/PROJECT_STATUS.md`
- Modify: `README.md`

**Interfaces:** none.

- [ ] **Step 1: Add the 1.4.0 section** at the top of `CHANGELOG.md`, immediately under the intro line and above `## [1.3.1]`:
```markdown
## [1.4.0] - 2026-06-30

### Added
- **"What's New" popup** — after the app updates, a dialog shows the release notes for the new version (sourced from this changelog). Re-openable any time from Settings → About → "What's new in this version". Never shown on a first install.
- **Release runbook** — `docs/RELEASING.md` documents the full signed/notarized release + self-update process, required secrets, and updater-key rotation.
- **Version-sync tooling** — `npm run release:version -- X.Y.Z` keeps the version aligned across `package.json`, `tauri.conf.json`, `Cargo.toml`, and `Cargo.lock`.

### Fixed
- **Settings info tooltips** — the (i) popovers are now rendered through a portal with viewport-aware positioning, so they no longer get clipped off-screen, collapse into a narrow column, or snap the settings panel back to the top of the section when you scroll.
- **Update UI accent color** — the "Install Update" button, update banner, download progress bar, and selected template cards referenced an undefined CSS variable (`--accent-color`) and rendered without their accent color. They now use the real `--accent-primary` token.

### Changed
- **Settings modal accessibility** — focus is trapped inside the modal while open (initial focus, Tab cycling, focus restore on close), and the sidebar-width range sliders are now associated with their labels.
- **Release notes in GitHub Releases** — the release body is now the matching `CHANGELOG.md` section instead of a generic link, matching the in-app "What's New" content.
```

- [ ] **Step 2: Verify the extractor now returns the new notes**

Run: `node scripts/extract-changelog.mjs 1.4.0`
Expected: prints the `### Added` / `### Fixed` / `### Changed` bullets above.

- [ ] **Step 3: Update `docs/PROJECT_STATUS.md`** — locate the bug/known-issues and features sections and:
  - Mark fixed: info-tooltip clipping/scroll-snap; undefined `--accent-color`.
  - Add shipped: "What's New" popup; Settings focus-trap; release tooling/runbook.
  - Add a "Known follow-ups (deferred)" list with these items (read the file first to match its existing heading style):
    - Segmented-button groups outside Theme/Font Size/Sort still lack `role="radiogroup"`/`aria-checked` (Editor: Line Height, Default Note Type; General: Auto-Lock, Encrypted Import mode) — mechanical a11y sweep.
    - General and Data tabs duplicate backup / import-export / encrypted-backup UIs — decide which tab owns what.
    - The sidebar-width slider appears in both the Appearance and Sidebar tabs — consolidate to one.

  Run first: `sed -n '1,80p' docs/PROJECT_STATUS.md` to match structure, then edit.

- [ ] **Step 4: Update `README.md`** — in the features/updates area, add a short line:
```markdown
- **Automatic updates** — Moldavite checks for new versions and updates in place. After updating, a "What's New" popup summarizes the changes.
```
  Run first: `grep -n "update\|Update\|Features\|##" README.md | head -40` to find the right spot.

- [ ] **Step 5: Commit**

```bash
git add CHANGELOG.md docs/PROJECT_STATUS.md README.md
git commit -m "docs: changelog 1.4.0, project status, and README update note

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 14: Full verification + open PR (stop before tag)

**Files:** none (verification + git).

- [ ] **Step 1: Full test suite**

Run: `npm test`
Expected: PASS, including the new `changelog`, `useFocusTrap`, `InfoTooltip`, and `WhatsNewModal` tests.

- [ ] **Step 2: Lint + type-check + production build**

Run: `npm run lint && npm run build`
Expected: `tsc` clean, `vite build` succeeds.

- [ ] **Step 3: Bundle-size budget**

Run: `npm run check:size`
Expected: within budget. If the `?raw` CHANGELOG import pushes raw size over, note the delta in the PR (CHANGELOG is small; this should be negligible).

- [ ] **Step 4: Manual smoke checklist** (run `npm run tauri dev`):
  - Settings → Sidebar → hover the Layout "i" near the bottom and the far-right section icons: tooltip is fully visible (flips above near the bottom), readable width, and scrolling the panel does NOT snap to the top.
  - Settings → About: the "Install Update"/"Check for Updates" button and accents render with the theme accent color (try a non-default preset too).
  - Settings → About → "What's new in this version": the popup opens with the 1.4.0 notes.
  - Simulate an upgrade: in devtools run `localStorage.setItem('moldavite-whats-new', JSON.stringify({state:{lastSeenVersion:'1.3.1'},version:0}))`, reload → the popup appears once; dismiss → it does not reappear on the next reload.
  - Clear `moldavite-whats-new` from localStorage, reload → no popup (first-launch behavior).
  - Tab through the Settings modal: focus stays inside it.

- [ ] **Step 5: Push the branch and open the PR**

```bash
git push -u origin feat/settings-fixes-whats-new
gh pr create --title "Settings fixes, What's New popup & release polish (v1.4.0)" \
  --body "$(cat <<'EOF'
## Summary
- Fix Settings info-tooltip clipping/narrow-column/scroll-snap (portal + viewport-aware positioning).
- Fix undefined \`--accent-color\` → \`--accent-primary\` (restores the Install Update button + accents).
- Add a version-gated "What's New" popup sourced from \`CHANGELOG.md\`; re-openable from About.
- Settings modal focus-trap + slider label association.
- Release polish: version-sync script, per-version release notes in CI, drop dead Ubuntu step, \`docs/RELEASING.md\`.
- Bump to v1.4.0.

## Test plan
- \`npm test\` (new tests: changelog parser, useFocusTrap, InfoTooltip, WhatsNewModal).
- \`npm run lint && npm run build && npm run check:size\`.
- Manual: tooltip positioning, accent rendering, What's New gate (fresh vs upgrade), focus trap.

## Deferred follow-ups (in PROJECT_STATUS)
- Remaining segmented-button radiogroup a11y; General↔Data tab dedup; duplicated sidebar-width slider.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 6: STOP.** Do not create or push the `v1.4.0` tag. Report the PR URL to the user and confirm before tagging (the tag triggers a public, signed, notarized release).

---

## Self-Review

**Spec coverage:**
- §A tooltip → Task 2 (portal/flip/clamp + tabIndex removal). ✓
- §B accent-color → Task 1. ✓
- §C What's New → Tasks 5 (parser), 6 (raw wiring), 7 (store), 8 (modal + launch + mount), 9 (About re-open). ✓
- §D polish → Task 3 (focus trap), Task 4 (slider labels). Segmented-button semantics intentionally deferred and recorded in PROJECT_STATUS (Task 13) — noted as a scope refinement. ✓ (with documented deferral)
- §E release pipeline → Task 10 (version script + bump), 11 (CI notes + dead step), 12 (RELEASING.md), 14 (PR, stop before tag). ✓
- §F docs → Task 13. ✓
- Testing → unit tests in Tasks 2/3/5/8; manual checklist in Task 14. ✓

**Placeholder scan:** No TBD/TODO; every code step contains complete code. The only conditional ("if `tsc` errors on `?raw`") includes the exact declaration to add. ✓

**Type consistency:** `ChangelogEntry`/`ChangelogGroup` defined in Task 5 are consumed unchanged in Tasks 6/7/8. `useFocusTrap(ref, active)` defined in Task 3 is consumed in Tasks 3 and 8 with the same signature. `useWhatsNewStore` actions `open/close/markSeen` defined in Task 7 are used consistently in Tasks 8/9. `getReleaseNotes(version)` defined in Task 6 used in Tasks 8/9. ✓

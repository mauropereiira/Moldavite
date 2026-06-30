# Spec 1 — Settings fixes, "What's New" popup, and release polish

**Date:** 2026-06-30
**Status:** Approved (design) — ready for implementation plan
**Author:** Claude (brainstorming session with Mauro)

## Context

Moldavite is a Tauri v2 + React/TypeScript macOS note app. A discovery pass established that two features the user assumed were missing are in fact already built and working:

- **Auto-update** is fully wired (`tauri-plugin-updater`, `src/stores/updateStore.ts`, About tab UI; checks on launch + every 24h; one-click download/install/relaunch).
- **GitHub release + self-update pipeline** is built (`.github/workflows/release.yml` on `v*` tags → signed + notarized macOS aarch64/x86_64 + Windows → `latest.json` → GitHub Release; `ci.yml` lint/test/build on every push).

So the actual work in this spec is: fix real UI bugs, add the in-app "What's New" release-notes popup (the genuine gap), polish the release tooling, and cut a new release. The permissioned-open plugin system is **out of scope** here and gets its own spec next.

## Goals

1. Fix the Settings info-tooltip bug (clipping, narrow-column wrap, scroll-snap-to-top).
2. Fix the undefined `--accent-color` CSS variable (breaks the "Install Update" button and other accents).
3. Add a version-gated "What's New" popup sourced from `CHANGELOG.md`.
4. Apply a safe subset of Settings accessibility/polish fixes; flag (not auto-fix) product-structure duplication.
5. Polish the release pipeline (version-sync script, per-version release notes, runbook) and cut `v1.4.0`.
6. Update documentation.

## Non-goals

- Building the plugin system (separate spec).
- Removing/merging the General↔Data tab duplication or the duplicated sidebar-width slider (flagged for a follow-up product decision, not done here).
- Adding new editor or calendar features.

---

## A. Tooltip fix

**File:** `src/components/settings/common/InfoTooltip.tsx` (hand-rolled, 73 lines). Also `src/components/settings/SettingsModal.tsx`.

### Root causes (confirmed)
1. **Clipping** — the popover is an absolute `<div>` with **no portal**, trapped inside the `overflow-y-auto` tabpanel (`SettingsModal.tsx:246–251`). Anything past the panel edge is clipped.
2. **Narrow-column wrap** — `max-w-[320px]` with no width floor, centered on the icon via `left:50%; translateX(-50%)`; icons sit at the far right of `justify-between` rows, so the box overflows the panel edge and text reflows into the visible sliver.
3. **Scroll-snap-to-top** — the tabpanel is focusable (`tabIndex={0}`, `SettingsModal.tsx:250`); combined with the tooltip's `onFocus`/`onBlur` and the `key={activeTab}` wrapper (`SettingsModal.tsx:253`) that remounts and replays `.tab-content-enter`, an implicit focus-into-view resets `scrollTop`.

### Fix
- **Portal** the popover to `document.body` via `createPortal`, using `position: fixed`.
- **Position from the trigger's `getBoundingClientRect()`** computed on show:
  - Default: below the icon, centered.
  - **Flip above** if below would overflow the viewport bottom.
  - **Clamp** the horizontal position so the box stays ≥8px inside the viewport on both sides.
  - Recompute on `scroll` (capture) and `resize` while visible; remove listeners on hide/unmount.
- **Fixed width** ~260px with `white-space: normal` so text wraps at a readable width.
- **Remove `tabIndex={0}`** from the tabpanel scroll container (`SettingsModal.tsx:250`). ESC + arrow-key tab navigation already provide keyboard support; the panel does not need to be a focus target. Portaling also removes the tooltip from the keyed subtree, so it no longer triggers a remount/animation replay.
- Keep hover + focus (keyboard) triggers; keep `z-index` above the modal (modal is `z-[9999]`, so tooltip uses a value `> 9999`, e.g. `z-[10000]`, now that it is portaled to body).

### Approach decision
Self-contained portal + flip/clamp helper inside `InfoTooltip.tsx` — **no new dependency**, matches the codebase's hand-rolled style. (`@floating-ui/react` was considered and rejected for a single tooltip; can revisit if more floating UI is needed later, e.g. for the plugin system.)

---

## B. `--accent-color` undefined-variable fix

`var(--accent-color)` is referenced but never declared in `src/index.css` (only `--accent-primary` exists). Affected usages render with no color:
- `src/components/settings/sections/AboutSection.tsx` (lines ~24, 25, 62, 78) — **"Install Update" button background**, update banner border, download icon, progress-bar fill.
- `src/components/updates/UpdateNotification.tsx`
- `src/components/templates/TemplateCard.tsx`

**Fix:** replace every `var(--accent-color)` with the real token `var(--accent-primary)`. Grep the whole `src/` tree to catch any other usages. (Chosen over adding an alias variable, to avoid a redundant shadow token.) Verify `--accent-primary` is theme-aware in `index.css` so the accents track the selected color preset.

---

## C. "What's New" popup

### Data source & parsing
- Import the changelog at build time: `import changelogRaw from '@/../CHANGELOG.md?raw'` (Vite `?raw`). Single source of truth, works offline, identical content to the GitHub release body (see §E).
- A parser (`src/lib/changelog.ts`) extracts the section for a given version from the Keep-a-Changelog format:
  - Find the `## [X.Y.Z] - DATE` heading, capture until the next `## [` heading.
  - Return `{ version, date, groups: { Added: string[], Changed: string[], Fixed: string[], ... } }` (group = the `### Added`/`### Fixed` subheadings; bullets are `- ...` lines). If no subheadings, fall back to a flat bullet list.
  - Return `null` if the version is not found.

### Trigger logic & state
- New persisted store `src/stores/whatsNewStore.ts` (Zustand + `persist`, key `moldavite-whats-new`), holding `lastSeenVersion: string | null` and modal open state.
- On app mount (in `App.tsx` or the existing startup effect alongside `updateStore.startPeriodicChecks()`):
  1. `const current = await getVersion()` (`@tauri-apps/api/app`).
  2. If `lastSeenVersion === null` → **first launch**: set `lastSeenVersion = current`, show nothing.
  3. Else if `current !== lastSeenVersion` and `parseChangelog(current)` is non-null → open `WhatsNewModal`; on close (or immediately), set `lastSeenVersion = current`.
  4. Else → set `lastSeenVersion = current`, show nothing.
- Use a simple semver-aware "is newer" guard so a downgrade does not pop the modal; `!==` plus "current parses in changelog" is acceptable, but prefer a tiny semver-greater check.

### UI
- `src/components/updates/WhatsNewModal.tsx` — styled to match existing modals (backdrop `z-[9999]`, panel, header with close, "Got it" primary button). Shows "What's New in vX.Y.Z", the date, and grouped bullets (Added / Changed / Fixed with small section labels and icons).
- Re-openable from the **About tab**: a "Release notes" / "What's New" link that opens the modal for the current version regardless of `lastSeenVersion`.

### Error handling
- Parse failure or missing entry never blocks launch — the effect is wrapped so any error is logged and the modal simply does not show.

---

## D. Settings polish (safe subset)

**Fix now (low-risk, no product decision):**
- **Modal focus management** (`SettingsModal.tsx`): on open, move focus into the dialog (first focusable or the dialog container); trap Tab within the modal; restore focus to the previously focused element on close. Currently absent (`role="dialog" aria-modal="true"` with no trap).
- **Slider label association**: add `id` to the range inputs and `htmlFor` to their labels (or `aria-label`) in `SidebarSection.tsx` (sidebar width, right-panel width), `AppearanceSection.tsx` (sidebar width), and `GeneralSection.tsx` (save delay).
- **Segmented-button semantics**: give the mutually-exclusive `<button>` groups `role="radiogroup"` / `role="radio"` / `aria-checked`, mirroring the pattern already used by Appearance's color presets (`AppearanceSection.tsx:66–84`). Groups to update: Theme, Font Size, Line Height, Default Note Type, Sort Notes By, Auto-Lock, Encrypted Import mode.

**Flag for a separate decision (do NOT change in this spec):**
- General (`GeneralSection.tsx`) and Data (`SettingsData.tsx`) tabs duplicate backup / import-export / encrypted-backup UIs. Needs a product call on which tab owns what.
- The sidebar-width slider appears in **both** Appearance (`AppearanceSection.tsx:207–230`) and Sidebar (`SidebarSection.tsx:96–118`) tabs, bound to the same setting.

These will be listed in `docs/PROJECT_STATUS.md` as known follow-ups.

---

## E. Release pipeline polish + cut a release

### Version-sync script
- `scripts/bump-version.mjs`, run via an npm script (e.g. `npm run release:version -- 1.4.0`). Updates the version in `package.json`, `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml`, and refreshes `src-tauri/Cargo.lock` (e.g. `cargo update -p moldavite --precise <ver>` or targeted edit). Validates all three end in sync and prints the result. Eliminates the current hand-edit drift risk across three files.

### `release.yml` improvements
- Add a step that **extracts the matching `CHANGELOG.md` section** for the tag's version and uses it as the GitHub Release body, so release notes are per-version and identical to the in-app What's New (single source of truth).
- **Remove the dead Linux-deps step** (`release.yml:72–76`) — there is no `ubuntu` entry in the build matrix.

### Runbook
- New `docs/RELEASING.md`: end-to-end process (bump version → update CHANGELOG → open `release/vX.Y.Z` PR → merge → push `vX.Y.Z` tag → CI builds/signs/notarizes/publishes → verify `latest.json` + self-update). Document the required secrets (`APPLE_*`, `TAURI_SIGNING_PRIVATE_KEY[_PASSWORD]`) and that `TAURI_SIGNING_PRIVATE_KEY` must match the `pubkey` hardcoded in `tauri.conf.json` (key-rotation note).

### Cut `v1.4.0`
- Bump `1.3.1 → 1.4.0` (new user-facing feature → minor) using the new script.
- Add a `## [1.4.0]` CHANGELOG section describing this spec's work (tooltip fix, accent-color fix, What's New popup, a11y polish, release tooling).
- Commit on a feature branch and open a PR.
- **Gate:** stop before pushing the `v1.4.0` tag. Pushing the tag triggers a public, signed, notarized release — confirm with the user first.

---

## F. Documentation

- `CHANGELOG.md` — new `## [1.4.0]` entry.
- `docs/PROJECT_STATUS.md` — mark tooltip/accent bugs fixed, What's New shipped; record the flagged duplication follow-ups.
- `README.md` — minor touch-ups if any user-facing behavior changed (e.g. mention "What's New on update").
- `docs/RELEASING.md` — new (see §E).

---

## Testing

- **Unit (Vitest):**
  - `changelog.ts` parser: correct section extraction, grouped bullets, missing-version → `null`, malformed input → `null`/empty.
  - What's New "should show" logic: first-launch (no show), upgrade (show), same-version (no show), downgrade (no show).
- **Manual checklist:**
  - Tooltip: hover icons at the top, bottom, and far-right of a section; narrow window; verify no clipping, readable width, flips above near the bottom, no scroll-snap.
  - Accent: "Install Update" button and update banner render with the accent color; track the selected color preset.
  - What's New: simulate version bump (set `lastSeenVersion` lower) → modal shows current notes; "Got it" dismisses and does not reappear; About-tab re-open works; fresh `localStorage` → no modal.
- **CI:** existing `ci.yml` (lint, vitest, build, bundle-size, clippy, cargo test) must stay green.

## Risks & mitigations

- *Tooltip portal + fixed positioning regressions* → covered by the manual edge checklist; the helper is small and self-contained.
- *`?raw` changelog import bloats the bundle* → CHANGELOG is small; acceptable. `check:size` budget will catch regressions.
- *Removing `tabIndex={0}` harms keyboard scroll* → ESC + arrow-key tab nav remain; the panel content is reachable via its controls.
- *Cutting a release is irreversible/outward-facing* → explicit user confirmation gate before pushing the tag.

## Implementation order (suggested)

1. B (accent-color) — smallest, unblocks visible update UI.
2. A (tooltip) + D focus/a11y polish.
3. C (What's New: parser → store → modal → wiring → About re-open).
4. E (version script, release.yml, RELEASING.md).
5. F (docs) + cut `v1.4.0` PR.
6. Confirm with user → push tag.

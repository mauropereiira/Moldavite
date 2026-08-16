#!/usr/bin/env node
/**
 * Enforce per-asset size budgets on `dist/`.
 *
 * Fails the build if any produced asset (post-minify, pre-gzip) is larger
 * than the matching budget. Budgets are chosen from current sizes plus
 * modest headroom so we notice regressions early.
 */
import { readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { readFileSync } from 'node:fs';

const DIST = 'dist/assets';

// Pattern → raw KB, gzip KB. Headroom is ~20% above current sizes so the
// check catches regressions but tolerates small organic growth.
const BUDGETS = [
  { pattern: /^react-vendor-.*\.js$/, rawKb: 240, gzipKb: 75 },
  { pattern: /^tiptap-vendor-.*\.js$/, rawKb: 500, gzipKb: 160 },
  { pattern: /^markdown-vendor-.*\.js$/, rawKb: 180, gzipKb: 75 },
  { pattern: /^date-vendor-.*\.js$/, rawKb: 60, gzipKb: 15 },
  { pattern: /^html2pdf-.*\.js$/, rawKb: 1100, gzipKb: 320 },
  // The bundled CHANGELOG.md (?raw) lives in its own chunk so release-notes
  // content doesn't count against the app-code budget and can grow per release.
  // gzip bumped for the v1.6 release-notes section (What's New content ships in this chunk).
  // Bumped for the v1.9 round: this chunk is prose, so it grows once per entry
  // and the only way to hold a line here is to write fewer or worse release
  // notes. Measured 40.2 KB raw / 16.1 KB gz on main at the time of the bump.
  // Raised generously rather than by inches. This chunk is the changelog, so
  // it grows once per release and never shrinks: a tight cap on it has to be
  // lifted every time and therefore signals nothing. Three releases in one day
  // each tripped it by under a kilobyte. What actually needs watching is app
  // code, which has its own budget below. The ceiling here exists only to
  // catch something genuinely wrong — a binary or a dependency landing in this
  // chunk — not to ration release notes. Measured 65.5 KB raw / 25.1 KB gz.
  { pattern: /^changelog-.*\.js$/, rawKb: 160, gzipKb: 55 },
  { pattern: /^index-.*\.css$/, rawKb: 130, gzipKb: 25 },
];

// Soft cap on combined app (non-vendor) JS — sum of all index-*.js chunks.
// Bumped in 1.5.0 for the plugin sandbox rewrite (worker + RPC wiring).
// Bumped in 1.6.0 for the semantic-search UI (search mode chips + results,
// related-notes panel, lifecycle store) — ~10 KB raw, no new dependencies.
// Bumped another 2 KB for the built-in MCP setup and write-consent controls.
// Bumped for Plugin API v2 host enforcement (stream-capped fetch + redirect
// validation, note-read mapping, Keychain RPC, and the expanded Worker proxy)
// plus the note-rename UI + path-keyed state migration (lazy-loaded modal).
// Bumped for the API v2 host-consent/prompt broker and WordPress install UI.
// PluginDialogHost is lazy-loaded, but this combined budget deliberately also
// counts lazy app chunks, so it includes the small split-chunk/gzip overhead.
// Bumped for the graph-view overhaul (deterministic layout, LOD, fit-view).
// Bumped for force-clustered graph physics + plugin About/instructions dialog.
// Bumped for the community plugin browser (registry list + install states).
// Bumped for the animated welcome screen's inline wordmark glyph geometry;
// the screen is lazy-loaded, but lazy app chunks are deliberately counted here.
// Bumped 2 KB for the permanent icon rail, modular chrome settings and the
// persisted pin-to-mode migration. Gzip remains within the existing cap.
// Bumped 2 KB raw / 1 KB gz for click-relative impact origins and the shared
// outlined signature glyph used by secondary empty states.
// Bumped 3 KB raw / 2 KB gz for the constellation renderer and month event indicators.
// Bumped 3 KB raw for the randomized welcome meteor; gzip remains within the existing cap.
// Bumped 2 KB raw / 1 KB gz for the exclusive active-surface coordinator that
// Index, Agenda, Graph, Timeline and Search now share (~0.5 KB raw measured).
// Bumped 4 KB raw / 2 KB gz for the star-map graph: per-frame galaxy entrance,
// degree-weighted star styling and free panning. Partly offset by dropping
// lucide-react from GraphView; measured 567.3 KB raw / 153.4 KB gz at the bump.
// Bumped 2 KB gz for 2.0: the Cream redesign merged with MCP write-consent, so
// the attributed-agent prompt lands on top of the redesigned chrome. Raw stays
// at 570 — only gzip crossed. Measured 566.5 KB raw / 155.2 KB gz at the bump.
// Bumped 4 KB raw for the WordPress.com publishing UI: the store, the typed
// IPC layer and the footer menu. Measured 571.2 KB raw / 156.6 KB gz at the
// bump; gzip stayed inside 157 and is left alone.
// Bumped 6 KB raw / 3 KB gz for the audit round: per-note write serialisation
// with generations, the external-reload recheck, transactional Forge and root
// switching, the task-list run splitter, and the pinned-notes bar. This is
// machinery whose only job is to stop the app losing a user's writing, which
// is worth more than the kilobytes. Measured 577.9 KB raw / 158.6 KB gz.
// Bumped a further 5 KB raw / 2 KB gz for the accessibility round: a shared
// dialog surface with focus trapping, restoration and topmost-only Escape,
// applied across thirteen overlays that previously had none of it. Keyboard
// users could tab straight out of every modal in the app. Measured 582.4 KB
// raw / 160.3 KB gz.
// Bumped 3 KB raw for 2.2.1: pin reordering with drag and keyboard, the
// overflow menu, inline title renaming, and the calendar's day-mark legend.
// Measured 585.3 KB raw / 161.4 KB gz — only raw crossed, so gzip is left
// where it is rather than given headroom nothing has asked for.
const APP_JS_BUDGET = { rawKb: 589, gzipKb: 162 };

async function main() {
  let entries;
  try {
    entries = await readdir(DIST);
  } catch {
    console.error(`Missing ${DIST} — run \`npm run build\` first.`);
    process.exit(1);
  }

  const failures = [];
  const matched = new Set();
  let appRaw = 0;
  let appGzip = 0;

  for (const name of entries) {
    const isIndexJs = /^index-.*\.js$/.test(name) || /-.*\.js$/.test(name);
    const budget = BUDGETS.find((b) => b.pattern.test(name));

    const full = join(DIST, name);
    const st = await stat(full);
    if (!st.isFile() || !name.match(/\.(js|css)$/)) continue;
    const size = st.size;
    const gzip = gzipSync(readFileSync(full)).length;
    const rawKb = size / 1024;
    const gzipKb = gzip / 1024;

    if (!budget && isIndexJs && name.endsWith('.js')) {
      appRaw += rawKb;
      appGzip += gzipKb;
    }

    if (!budget) continue;
    matched.add(budget.pattern.source);

    const line = `${name.padEnd(45)} ${rawKb.toFixed(1).padStart(8)} KB   ${gzipKb.toFixed(1).padStart(7)} KB gz`;

    if (rawKb > budget.rawKb || gzipKb > budget.gzipKb) {
      failures.push(`${line}   ❌ over budget (${budget.rawKb} / ${budget.gzipKb} gz)`);
    } else {
      console.log(line);
    }
  }

  const appLine = `${'app (index-*.js total)'.padEnd(45)} ${appRaw.toFixed(1).padStart(8)} KB   ${appGzip.toFixed(1).padStart(7)} KB gz`;
  if (appRaw > APP_JS_BUDGET.rawKb || appGzip > APP_JS_BUDGET.gzipKb) {
    failures.push(
      `${appLine}   ❌ over budget (${APP_JS_BUDGET.rawKb} / ${APP_JS_BUDGET.gzipKb} gz)`
    );
  } else {
    console.log(appLine);
  }

  for (const b of BUDGETS) {
    if (!matched.has(b.pattern.source)) {
      failures.push(`No asset matched ${b.pattern} — chunk renamed or removed?`);
    }
  }

  if (failures.length) {
    console.error('\nBundle size budget violations:');
    for (const f of failures) console.error('  ' + f);
    process.exit(1);
  }
  console.log('\nAll bundles within budget.');
}

main();

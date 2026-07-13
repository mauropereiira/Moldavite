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
  { pattern: /^changelog-.*\.js$/, rawKb: 36, gzipKb: 12 },
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
const APP_JS_BUDGET = { rawKb: 544, gzipKb: 146 };

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
      failures.push(
        `${line}   ❌ over budget (${budget.rawKb} / ${budget.gzipKb} gz)`,
      );
    } else {
      console.log(line);
    }
  }

  const appLine = `${'app (index-*.js total)'.padEnd(45)} ${appRaw.toFixed(1).padStart(8)} KB   ${appGzip.toFixed(1).padStart(7)} KB gz`;
  if (appRaw > APP_JS_BUDGET.rawKb || appGzip > APP_JS_BUDGET.gzipKb) {
    failures.push(
      `${appLine}   ❌ over budget (${APP_JS_BUDGET.rawKb} / ${APP_JS_BUDGET.gzipKb} gz)`,
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

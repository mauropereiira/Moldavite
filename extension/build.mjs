/**
 * Bundles the extension into dist/chrome, dist/chrome-store and dist/firefox.
 *
 * The three differ only in manifest keys, because `key` and
 * `browser_specific_settings` are not interchangeable:
 *
 * - `dist/chrome` keeps `key`, which pins the unpacked build to the extension
 *   id the desktop app allows in its native-messaging host manifest. Without it
 *   an unpacked load gets a fresh id on every profile and the bridge refuses it.
 * - `dist/chrome-store` drops `key`. The Web Store assigns its own id and
 *   re-signs the package, and Chrome refuses to install one whose `key` implies
 *   a different id. Uploading the unpacked manifest is therefore a rejected
 *   item, not a working one. See docs/CHROME_STORE.md for the id step that
 *   follows a first upload.
 * - `dist/firefox` drops `key` and keeps the Gecko id.
 */

import { cp, mkdir, rm, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { build } from 'esbuild';

const manifest = JSON.parse(readFileSync('manifest.json', 'utf8'));

const TARGETS = {
  chrome: (m) => ({ ...m, browser_specific_settings: undefined }),
  'chrome-store': (m) => ({ ...m, key: undefined, browser_specific_settings: undefined }),
  firefox: (m) => ({ ...m, key: undefined }),
};

const COPIED = [
  ['src/popup.html', 'popup.html'],
  ['src/popup.css', 'popup.css'],
  ['icon-16.png', 'icon-16.png'],
  ['icon-32.png', 'icon-32.png'],
  ['icon-48.png', 'icon-48.png'],
  ['icon-128.png', 'icon-128.png'],
];

await rm('dist', { recursive: true, force: true });

for (const [target, transform] of Object.entries(TARGETS)) {
  const outdir = `dist/${target}`;
  await mkdir(outdir, { recursive: true });

  await build({
    entryPoints: ['src/popup.js', 'src/content.js'],
    outdir,
    bundle: true,
    format: 'esm',
    target: 'es2022',
    legalComments: 'inline',
  });

  for (const [from, to] of COPIED) {
    await cp(from, `${outdir}/${to}`);
  }

  const output = JSON.parse(JSON.stringify(transform(manifest)));
  await writeFile(`${outdir}/manifest.json`, `${JSON.stringify(output, null, 2)}\n`);
}

console.log(`built ${Object.keys(TARGETS).map((t) => `dist/${t}`).join(', ')}`);

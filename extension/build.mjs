/**
 * Bundles the extension into dist/chrome and dist/firefox.
 *
 * Both targets get identical code and the same manifest: Chrome ignores
 * `browser_specific_settings`, Firefox ignores `key`. They are separate
 * directories only so the Chrome zip and the Firefox XPI can be built and
 * signed independently.
 */

import { cp, mkdir, rm } from 'node:fs/promises';
import { build } from 'esbuild';

const TARGETS = ['chrome', 'firefox'];
const COPIED = [
  ['manifest.json', 'manifest.json'],
  ['src/popup.html', 'popup.html'],
  ['src/popup.css', 'popup.css'],
];

await rm('dist', { recursive: true, force: true });

for (const target of TARGETS) {
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
}

console.log(`built ${TARGETS.map((target) => `dist/${target}`).join(' and ')}`);

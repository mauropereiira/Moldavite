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

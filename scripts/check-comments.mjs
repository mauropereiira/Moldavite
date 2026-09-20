#!/usr/bin/env node
/**
 * Fails on the comment patterns that are always noise, never a judgement call.
 *
 * Restating comments cannot be detected mechanically, so this does not try.
 * It catches the two shapes that have no legitimate use and that accumulated
 * to over a thousand lines before anyone counted: decorative banners, and a
 * short list of filler openers. See the Comments section of CONTRIBUTING.md.
 */
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const EXTENSIONS = /\.(rs|ts|tsx|js|mjs|css|swift)$/;
const SKIP = /^(node_modules|dist|src-tauri\/target|src-tauri\/gen|docs\/fonts)\//;

// A rule of repeated punctuation used as a section divider.
const BANNER = /^\s*(?:\/\/+|\/\*+|\*|#)\s*[=*_~-]{5,}/;

// Openers that never survive the "what would a reader lose" test.
const FILLER = [
  /\b(?:this|the)\s+(?:function|method|class|component|hook|module)\s+(?:is responsible for|simply|basically|just)\b/i,
  /^\s*(?:\/\/|\*|#)\s*(?:note that|it'?s important to (?:note|understand)|as you can see|obviously|basically,|simply put)\b/i,
  /^\s*(?:\/\/|\*|#)\s*(?:here we|we then|now we)\b/i,
];

function tracked() {
  return execFileSync('git', ['ls-files'], { encoding: 'utf8' })
    .split('\n')
    .filter((f) => f && EXTENSIONS.test(f) && !SKIP.test(f));
}

const findings = [];
for (const file of tracked()) {
  let text;
  try {
    text = readFileSync(file, 'utf8');
  } catch {
    continue;
  }
  text.split('\n').forEach((line, i) => {
    if (BANNER.test(line)) {
      findings.push([file, i + 1, 'decorative banner', line.trim().slice(0, 60)]);
      return;
    }
    if (FILLER.some((re) => re.test(line))) {
      findings.push([file, i + 1, 'filler comment', line.trim().slice(0, 60)]);
    }
  });
}

if (findings.length === 0) {
  console.log('✓ comments clean — no banners or filler in tracked sources');
  process.exit(0);
}

console.error(`✗ ${findings.length} comment issue(s). See "Comments" in CONTRIBUTING.md.\n`);
for (const [file, line, kind, text] of findings) {
  console.error(`  ${file}:${line}  ${kind}\n    ${text}`);
}
process.exit(1);

#!/usr/bin/env node
/**
 * Audit the design-token layer.
 *
 * Three failure modes, all of which have actually shipped in this repo before:
 *
 *   1. A `var(--x)` whose token is never defined. It silently renders as
 *      nothing, or as whatever fallback was pasted next to it.
 *   2. A `var(--x, #fallback)`. The fallback HIDES failure mode 1 — the
 *      command palette rendered in a leftover blue-grey for months this way,
 *      immune to every theme, because each call site carried its own literal.
 *   3. A raw hex in a component. Themeable surfaces must read tokens; a
 *      literal cannot follow a preset.
 *
 * Run: node scripts/check-tokens.mjs
 */
import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join, relative, resolve } from 'node:path';

const DEFAULT_ROOT = fileURLToPath(new URL('..', import.meta.url));
const rootFlag = process.argv.indexOf('--root');
if (rootFlag !== -1 && !process.argv[rootFlag + 1]) {
  console.error('Usage: node scripts/check-tokens.mjs [--root <project-root>]');
  process.exit(2);
}
const ROOT = rootFlag === -1 ? DEFAULT_ROOT : resolve(process.argv[rootFlag + 1]);
const SRC = join(ROOT, 'src');
const CSS = join(SRC, 'index.css');

/**
 * Custom properties supplied at runtime from React inline styles rather than
 * declared in CSS, so they are legitimately absent from the token layer.
 */
const RUNTIME_TOKENS = new Set(['--index', '--duration']);

/** Files allowed to contain raw hex colours, with the reason why. */
const HEX_ALLOWLIST = new Map([
  ['src/index.css', 'the token layer itself, plus canonical third-party presets'],
  ['src/stores/themeStore.ts', 'preset swatch chips shown in the theme picker'],
  ['src/components/ui/NoteColorPicker.tsx', 'note colour palette'],
  ['src/components/graph/GraphView.tsx', 'canvas fallbacks read via getComputedStyle'],
  ['src/lib/fileSystem.ts', 'markdown/HTML conversion colours'],
]);

/** Files allowed to contain named colours as data or checker fixtures. */
const KEYWORD_ALLOWLIST = new Map([
  ['src/index.css', 'the token layer itself'],
  ['src/lib/agents.ts', 'documented note-frontmatter colour example'],
  ['src/lib/agents.test.ts', 'assertion for the documented frontmatter example'],
  ['src/lib/checkTokens.test.ts', 'literal-colour checker fixture'],
  ['src/lib/fileSystem.conflict.test.ts', 'persisted note-colour fixture'],
  ['src/hooks/useNotes.rename.test.tsx', 'persisted note-colour fixture'],
]);

async function walk(dir) {
  const out = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...(await walk(p)));
    else if (/\.(ts|tsx|css)$/.test(e.name)) out.push(p);
  }
  return out;
}

const files = await walk(SRC);
const read = new Map(await Promise.all(files.map(async (f) => [f, await readFile(f, 'utf8')])));

// --- defined tokens: every `--x:` declaration anywhere in the CSS layer ---
const defined = new Set();
for (const [f, text] of read) {
  if (!f.endsWith('.css')) continue;
  for (const m of text.matchAll(/^\s*(--[a-zA-Z0-9-]+)\s*:/gm)) defined.add(m[1]);
}

/**
 * Tailwind palette utilities (`text-red-500`, `bg-blue-900`, …). These compile
 * to literal colours from Tailwind's own palette, so they ignore our tokens
 * completely and survive a full retheme looking exactly as wrong as before.
 * They are invisible to the hex check because they are class names.
 */
const TW_COLOR =
  /\b(?:text|bg|border|ring|fill|stroke|divide|outline|decoration|shadow|from|via|to)-(?:red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|slate|gray|zinc|neutral|stone)-\d{2,3}\b/g;

/**
 * Named CSS colours can hide in inline styles without producing a raw hex.
 * Anchor the match to colour-bearing CSS/JSX properties so prose, variable
 * names, and classes such as `whitespace-nowrap` are not mistaken for colours.
 */
const COLOR_KEYWORDS =
  'white|black|red|green|blue|gray|grey|orange|yellow|purple|pink|brown|cyan|magenta|lime|navy|teal|olive|maroon|silver|aqua|fuchsia';
const COLOR_KEYWORD = new RegExp(
  `\\b(?:color|background(?:Color|-color)?|border(?:Top|Right|Bottom|Left)?(?:Color)?|border-(?:top-|right-|bottom-|left-)?color|outline(?:Color|-color)?|textDecorationColor|text-decoration-color|accentColor|accent-color|caretColor|caret-color|fill|stroke|boxShadow|box-shadow)\\s*(?::|=)[^;,}]*?\\b(${COLOR_KEYWORDS})\\b`,
  'gi'
);
const QUOTED_COLOR_KEYWORD = new RegExp(`(['"])(${COLOR_KEYWORDS})\\1`, 'gi');

const problems = { undef: [], fallback: [], hex: [], tailwind: [], keyword: [] };

for (const [f, text] of read) {
  const rel = relative(ROOT, f);
  const lines = text.split('\n');

  lines.forEach((line, i) => {
    const at = `${rel}:${i + 1}`;

    // 2. var() with a fallback — always a bug in this codebase.
    for (const m of line.matchAll(/var\(\s*(--[a-zA-Z0-9-]+)\s*,/g)) {
      problems.fallback.push(`${at}  var(${m[1]}, …)`);
    }

    // 1. var() referencing an undefined token.
    for (const m of line.matchAll(/var\(\s*(--[a-zA-Z0-9-]+)/g)) {
      if (!defined.has(m[1]) && !RUNTIME_TOKENS.has(m[1])) {
        problems.undef.push(`${at}  ${m[1]}`);
      }
    }

    // 4. Tailwind palette utilities, which bypass the token layer entirely.
    for (const m of line.matchAll(TW_COLOR)) {
      problems.tailwind.push(`${at}  ${m[0]}`);
    }

    // 5. literal named colours outside the data/fixture allowlist.
    if (!KEYWORD_ALLOWLIST.has(rel)) {
      const namedColours = new Set();
      for (const m of line.matchAll(COLOR_KEYWORD)) {
        namedColours.add(m[1].toLowerCase());
      }
      for (const m of line.matchAll(QUOTED_COLOR_KEYWORD)) {
        namedColours.add(m[2].toLowerCase());
      }
      for (const colour of namedColours) problems.keyword.push(`${at}  ${colour}`);
    }

    // 3. raw hex outside the allowlist (ignore token definitions themselves).
    if (HEX_ALLOWLIST.has(rel)) return;
    if (/^\s*--[a-zA-Z0-9-]+\s*:/.test(line)) return;
    for (const m of line.matchAll(/#[0-9a-fA-F]{6}\b/g)) {
      problems.hex.push(`${at}  ${m[0]}`);
    }
  });
}

const report = (title, items, hint) => {
  if (!items.length) return 0;
  console.error(`\n✗ ${title} (${items.length})`);
  console.error(`  ${hint}`);
  for (const i of items.slice(0, 40)) console.error(`    ${i}`);
  if (items.length > 40) console.error(`    … and ${items.length - 40} more`);
  return items.length;
};

let failed = 0;
failed += report(
  'Undefined tokens',
  [...new Set(problems.undef)],
  'Referenced but never declared. Define it, or point it at the token that already exists.'
);
failed += report(
  'var() with a fallback',
  problems.fallback,
  'The fallback hides an undefined token and ships an off-palette colour. Define the token and drop the fallback.'
);
failed += report(
  'Raw hex outside the token layer',
  problems.hex,
  'Components must read tokens so they follow the active theme preset.'
);
failed += report(
  'Tailwind palette utilities',
  problems.tailwind,
  "These compile to Tailwind's own literal colours and ignore the theme entirely. Use a token."
);
failed += report(
  'Literal colour keywords',
  problems.keyword,
  'Named CSS colours ignore the theme. Use a token, or allowlist genuine colour data with a reason.'
);

if (failed) {
  console.error(`\n${failed} token problem(s).\n`);
  process.exit(1);
}
console.log(`✓ tokens clean — ${defined.size} defined, ${files.length} files checked`);

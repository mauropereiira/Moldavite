/** Every preset block in index.css defines the full palette at a readable contrast. */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';
import { describe, expect, it } from 'vitest';
import { PRESETS } from './themeStore';

const CSS = readFileSync(join(process.cwd(), 'src/index.css'), 'utf8');

const REQUIRED = [
  '--bg-base',
  '--bg-sidebar',
  '--bg-editor',
  '--bg-panel',
  '--bg-elevated',
  '--bg-inset',
  '--border-default',
  '--text-primary',
  '--text-secondary',
  '--accent-primary',
  '--accent-subtle',
  '--syntax-h1',
  '--syntax-h2',
  '--syntax-h3',
  '--syntax-code',
  '--syntax-link',
  '--hover-overlay',
];

function block(selector: string): Record<string, string> {
  const start = CSS.indexOf(`${selector} {`);
  expect(start, `missing block ${selector}`).toBeGreaterThanOrEqual(0);
  const body = CSS.slice(start, CSS.indexOf('}', start));
  return Object.fromEntries(
    [...body.matchAll(/(--[a-z0-9-]+):\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()])
  );
}

function rgb(value: string): [number, number, number] {
  const hex = /^#([0-9a-f]{6})$/i.exec(value);
  if (hex) {
    const n = parseInt(hex[1], 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  throw new Error(`not a hex colour: ${value}`);
}

function alphaOver(value: string, ground: [number, number, number]): [number, number, number] {
  const m = /^rgba\((\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\)$/.exec(value);
  if (!m) return rgb(value);
  const a = Number(m[4]);
  return [1, 2, 3].map((i) => Math.round(Number(m[i]) * a + ground[i - 1] * (1 - a))) as [
    number,
    number,
    number,
  ];
}

function luminance([r, g, b]: [number, number, number]): number {
  const f = (c: number) => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

function contrast(a: [number, number, number], b: [number, number, number]): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

const custom = PRESETS.filter((p) => p.id !== 'default');

describe.each(
  custom.flatMap((p) => [`:root[data-theme='${p.id}']`, `:root[data-theme='${p.id}'].dark`])
)('%s', (selector) => {
  const tokens = block(selector);

  it('defines the full palette', () => {
    for (const name of REQUIRED) expect(tokens[name], name).toBeDefined();
  });

  it('keeps body text, secondary text, accent and syntax readable', () => {
    for (const surface of ['--bg-base', '--bg-sidebar', '--bg-editor', '--bg-inset']) {
      const ground = rgb(tokens[surface]);
      expect(contrast(rgb(tokens['--text-primary']), ground), surface).toBeGreaterThanOrEqual(12);
      expect(
        contrast(alphaOver(tokens['--text-secondary'], ground), ground),
        surface
      ).toBeGreaterThanOrEqual(4.5);
      expect(contrast(rgb(tokens['--accent-primary']), ground), surface).toBeGreaterThanOrEqual(
        4.5
      );
    }
    const paper = rgb(tokens['--bg-editor']);
    for (const name of [
      '--syntax-h1',
      '--syntax-h2',
      '--syntax-h3',
      '--syntax-code',
      '--syntax-link',
    ]) {
      expect(contrast(rgb(tokens[name]), paper), name).toBeGreaterThanOrEqual(4.5);
    }
  });
});

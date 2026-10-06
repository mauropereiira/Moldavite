import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';
import { describe, expect, it } from 'vitest';
import { indexColumns, indexRows } from './indexGrid';

const css = readFileSync(join(process.cwd(), 'src/index.css'), 'utf8');

function rule(selector: string): string {
  const at = css.indexOf(`\n${selector} {`);
  expect(at, selector).toBeGreaterThan(-1);
  return css.slice(at, css.indexOf('}', at));
}

describe('Index card grid', () => {
  it('fits as many 240px cards as the width holds, never more than there are', () => {
    expect(indexColumns(1500, 4)).toBe(4);
    expect(indexColumns(1500, 5)).toBe(5);
    expect(indexColumns(800, 4)).toBe(3);
    expect(indexColumns(500, 4)).toBe(1);
    expect(indexColumns(520, 4)).toBe(2);
    expect(indexColumns(0, 4)).toBe(1);
  });

  it('gives a row of folded cards only its bands and splits the rest', () => {
    const share = 'minmax(var(--index-card-min-height), 1fr)';
    expect(indexRows([false, false, false, false], 4)).toBe(share);
    expect(indexRows([false, false, false, true], 3)).toBe(`${share} auto`);
    expect(indexRows([true, true, false, false], 2)).toBe(`auto ${share}`);
    expect(indexRows([true, false, true], 2)).toBe(`${share} auto`);
  });

  // jsdom does no layout, so the fixed-height rules are pinned by their text.
  it('scrolls each list inside its card instead of growing the page', () => {
    expect(rule('.app-index-grid')).toContain('height: 100%');
    expect(rule('.index-card')).toContain('overflow: hidden');
    expect(rule('.index-card .section-body')).toContain('overflow-y: auto');
    expect(rule('.index-card .section-body')).toContain('min-height: 0');
    expect(rule('.sidebar-sections')).toContain('height: 100%');
  });

  it('gives light cards a warm step from the page, not near-white', () => {
    expect(css).toMatch(
      /--bg-card: color-mix\(in srgb, var\(--bg-base\) \d+%, var\(--bg-sidebar\)\)/
    );
    expect(css).toContain('--bg-card: var(--bg-elevated)');
    expect(rule('.app-index-grid > .index-card')).toContain('background: var(--bg-card)');
  });
});

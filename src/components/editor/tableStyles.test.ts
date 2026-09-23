/**
 * The shipped stylesheets applied to an editor table. jsdom does no layout, so
 * these assert the cascaded rules, not the painted result.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

// Read from disk: the test config turns CSS off, so a `?raw` import is empty.
const indexCss = readFileSync(join(process.cwd(), 'src/index.css'), 'utf8');
const mobileCss = readFileSync(join(process.cwd(), 'src/mobile.css'), 'utf8');

let style = document.createElement('style');

beforeEach(() => {
  style = document.createElement('style');
  style.textContent = `${indexCss}\n${mobileCss}`;
  document.head.appendChild(style);
  document.body.innerHTML =
    '<div class="tiptap"><div class="tableWrapper"><table><tbody>' +
    '<tr><th><p></p></th><th><p></p></th></tr>' +
    '<tr><td><p></p></td><td><p></p></td></tr>' +
    '</tbody></table></div><p></p></div>';
});

afterEach(() => {
  style.remove();
  document.body.innerHTML = '';
  delete document.documentElement.dataset.platform;
});

const sides = ['top', 'right', 'bottom', 'left'] as const;

function one(selector: string, root: Element = document.body): Element {
  const element = root.querySelector(selector);
  if (!element) throw new Error(`No ${selector}`);
  return element;
}

/**
 * jsdom leaves `var()` unresolved and drops a shorthand holding one, so the
 * colour is read as the last declaration that applies to the element.
 */
function borderColor(element: Element, side: (typeof sides)[number]): string {
  let color = '';
  for (const rule of Array.from(style.sheet?.cssRules ?? [])) {
    if (!(rule instanceof window.CSSStyleRule) || !element.matches(rule.selectorText)) continue;
    color =
      rule.style.getPropertyValue(`border-${side}-color`) ||
      rule.style.getPropertyValue('border-color') ||
      color;
  }
  return color;
}

function border(element: Element, side: (typeof sides)[number]) {
  const computed = getComputedStyle(element);
  return [
    computed.getPropertyValue(`border-${side}-width`),
    computed.getPropertyValue(`border-${side}-style`),
    borderColor(element, side),
  ].join(' ');
}

describe.each(['desktop', 'mobile'])('editor tables on %s', (platform) => {
  beforeEach(() => {
    if (platform === 'mobile') document.documentElement.dataset.platform = 'mobile';
  });

  it('rules every cell side with a hairline token, so empty cells still read as a grid', () => {
    const td = one('td');
    for (const side of sides) expect(border(td, side)).toBe('1px solid var(--border-default)');

    const th = one('th');
    for (const side of ['top', 'right', 'left'] as const) {
      expect(border(th, side)).toBe('1px solid var(--border-default)');
    }
    expect(border(th, 'bottom')).toBe('1px solid var(--border-strong)');
    expect(getComputedStyle(th).fontWeight).toBe('600');
  });

  it('keeps cells tight and without fills', () => {
    for (const cell of document.querySelectorAll('th, td')) {
      expect(getComputedStyle(cell).backgroundColor).toMatch(/^(transparent|rgba\(0, 0, 0, 0\))$/);
      const paragraph = getComputedStyle(one('p', cell));
      expect(paragraph.marginTop).toBe('0px');
      expect(paragraph.marginBottom).toBe('0px');
      expect(paragraph.minHeight).toBe('1.5em');
    }
    expect(getComputedStyle(one('.tableWrapper')).overflowX).toBe('auto');
  });
});

it('holds phone columns open from inside the cell, where every engine honours it', () => {
  document.documentElement.dataset.platform = 'mobile';
  expect(getComputedStyle(one('td p')).minWidth).toBe('6em');
});

it('defines both table hairline tokens in every theme block', () => {
  const blocks = indexCss.match(/[^{}]+\{[^{}]*--border-default:[^{}]*\}/g) ?? [];
  expect(blocks.length).toBeGreaterThanOrEqual(8);
  for (const block of blocks) expect(block).toContain('--border-strong:');
});

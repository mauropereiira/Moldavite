import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';
import { describe, expect, it } from 'vitest';

// jsdom does no layout, so these pin the phone stylesheet's rules for a
// landscape phone (402pt tall, about 150pt above the keyboard) by their text.
const css = readFileSync(join(process.cwd(), 'src/mobile.css'), 'utf8');
const LANDSCAPE = '@media (orientation: landscape) and (max-height: 500px) {';

function landscapeBlocks(): string[] {
  const blocks: string[] = [];
  let at = css.indexOf(LANDSCAPE);
  while (at > -1) {
    let depth = 0;
    let end = at;
    for (let i = at; i < css.length; i++) {
      if (css[i] === '{') depth++;
      if (css[i] === '}' && --depth === 0) {
        end = i;
        break;
      }
    }
    blocks.push(css.slice(at, end));
    at = css.indexOf(LANDSCAPE, end);
  }
  return blocks;
}

function rule(source: string, selector: string): string {
  const start = source.indexOf(`${selector} {`);
  expect(start, selector).toBeGreaterThan(-1);
  return source.slice(start, source.indexOf('}', start));
}

const landscape = landscapeBlocks().join('\n');

describe('the phone stylesheet on a landscape phone', () => {
  it('fits every rail button on the screen and scrolls the rail above the keyboard', () => {
    const rail = rule(landscape, "html[data-platform='mobile'] .icon-rail");
    expect(rail).toContain('padding-bottom: 0');
    expect(rail).toContain('overflow-y: auto');
    expect(rule(landscape, "html[data-platform='mobile'] .icon-rail > div")).toContain(
      'padding-block: 0'
    );
    expect(rule(landscape, "html[data-platform='mobile'] .icon-rail-divider")).toContain(
      'margin-block: 0'
    );
  });

  it('gives the pinned bar and the Index header back to the content while typing', () => {
    expect(
      rule(landscape, "html[data-platform='mobile'][data-keyboard='open'] .pinned-bar")
    ).toContain('display: none');
    const header = landscape.slice(landscape.indexOf('.forge-switcher:not(:focus-within)'));
    expect(header).toContain('> .app-overlay-controls');
    expect(header.slice(0, header.indexOf('}'))).toContain('display: none !important');
  });

  it('drops the home-indicator inset while the keyboard is up', () => {
    expect(rule(css, "html[data-platform='mobile'][data-keyboard='open']")).toContain(
      '--safe-bottom: 0px'
    );
  });

  it('keeps a dialog on a page inside the page’s scrim', () => {
    expect(
      rule(css, "html[data-platform='mobile'] .app-overlay .modal-backdrop-dark > .modal-elevated")
    ).toContain('max-height: calc(100% - 32px)');
  });

  it('scrolls a submenu of the note footer’s Actions rather than Actions itself', () => {
    const submenu = rule(
      css,
      "html[data-platform='mobile'] .editor-footer [role='menu'] [role='menu']"
    );
    expect(submenu).toContain('max-height: calc(var(--app-height) - 160px)');
    expect(submenu).toContain('overflow-y: auto');
  });

  it('gives the Index search’s Clear a full touch target', () => {
    const clear = rule(
      css,
      "html[data-platform='mobile'] .sidebar-search [aria-label='Clear search']"
    );
    expect(clear).toContain('min-width: var(--touch-target)');
    expect(clear).toContain('min-height: var(--touch-target)');
  });
});

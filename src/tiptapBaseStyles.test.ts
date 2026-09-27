/** jsdom applies no CSS, so these tests check how tiptap-base.css is wired. */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(join(process.cwd(), path), 'utf8');
const squash = (css: string) =>
  css
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\s+/g, ' ')
    .replace(/"/g, "'")
    .trim();

const sources = import.meta.glob<string>(['./**/*.{ts,tsx}', '!./**/*.test.{ts,tsx}'], {
  query: '?raw',
  import: 'default',
  eager: true,
});

describe('TipTap base styles', () => {
  it('is the stylesheet the installed TipTap would inject', () => {
    const bundle = read('node_modules/@tiptap/core/dist/index.js');
    const injected = bundle.match(/const style = `([\s\S]*?)`;/)?.[1];
    expect(injected).toBeTruthy();
    expect(squash(read('src/tiptap-base.css'))).toContain(squash(injected ?? ''));
  });

  it('loads once from the entry point, after index.css', () => {
    const main = read('src/main.tsx');
    const base = main.indexOf("import './tiptap-base.css';");
    expect(base).toBeGreaterThan(main.indexOf("import './index.css';"));
  });

  it('is never injected by an editor, which could remove it', () => {
    const editors = Object.entries(sources).filter(([, source]) => source.includes('useEditor('));
    expect(editors.length).toBeGreaterThan(1);
    for (const [path, source] of editors) {
      expect(source, path).toContain('injectCSS: false');
    }
  });
});

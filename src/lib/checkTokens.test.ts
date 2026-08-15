import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';
import { afterEach, describe, expect, it } from 'vitest';

const CHECKER = join(process.cwd(), 'scripts/check-tokens.mjs');
const fixtures: string[] = [];

function fixtureWith(component: string) {
  const root = mkdtempSync(join(tmpdir(), 'moldavite-token-check-'));
  fixtures.push(root);
  const src = join(root, 'src');
  mkdirSync(src);
  writeFileSync(join(src, 'index.css'), ':root {\n  --text-primary: rgb(14, 13, 10);\n}\n');
  writeFileSync(join(src, 'Fixture.tsx'), component);
  return spawnSync(process.execPath, [CHECKER, '--root', root], { encoding: 'utf8' });
}

afterEach(() => {
  for (const fixture of fixtures.splice(0)) rmSync(fixture, { recursive: true, force: true });
});

describe('check-tokens colour keywords', () => {
  it('fails for a literal colour keyword and passes when the component uses a token', () => {
    const literal = fixtureWith("export const style = { color: 'white' };\n");
    expect(literal.status).toBe(1);
    expect(literal.stderr).toContain('Literal colour keywords');
    expect(literal.stderr).toContain('white');

    const token = fixtureWith("export const style = { color: 'var(--text-primary)' };\n");
    expect(token.status).toBe(0);
  });
});

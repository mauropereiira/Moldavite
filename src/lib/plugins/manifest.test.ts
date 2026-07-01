import { describe, it, expect } from 'vitest';
import { validateManifest } from './manifest';

const base = { id: 'demo', name: 'Demo', version: '1.0.0', apiVersion: 1 };

describe('validateManifest', () => {
  it('accepts a valid manifest whose id matches the folder', () => {
    expect(validateManifest(base, 'demo').ok).toBe(true);
  });
  it('rejects when id does not match the folder', () => {
    const r = validateManifest(base, 'other');
    expect(r).toEqual({ ok: false, reason: expect.stringContaining('folder') });
  });
  it('rejects a bad id slug', () => {
    expect(validateManifest({ ...base, id: 'Bad_Id' }, 'Bad_Id').ok).toBe(false);
  });
  it('rejects missing required fields', () => {
    expect(validateManifest({ id: 'demo' }, 'demo').ok).toBe(false);
  });
  it('flags apiVersion mismatch distinctly', () => {
    const r = validateManifest({ ...base, apiVersion: 2 }, 'demo');
    expect(r).toEqual({ ok: false, reason: expect.stringContaining('apiVersion') });
  });
  it('rejects non-object input', () => {
    expect(validateManifest(null, 'demo').ok).toBe(false);
    expect(validateManifest('x', 'demo').ok).toBe(false);
  });
});

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
    const longId = `a${'b'.repeat(64)}`;
    expect(validateManifest({ ...base, id: longId }, longId).ok).toBe(false);
  });
  it('rejects missing required fields', () => {
    expect(validateManifest({ id: 'demo' }, 'demo').ok).toBe(false);
  });
  it('flags apiVersion mismatch distinctly', () => {
    const r = validateManifest({ ...base, apiVersion: 3 }, 'demo');
    expect(r).toEqual({ ok: false, reason: expect.stringContaining('apiVersion') });
  });
  it('keeps v1 manifests compatible', () => {
    expect(validateManifest(base, 'demo')).toMatchObject({ ok: true, manifest: { apiVersion: 1 } });
  });
  it('accepts v2 net.fetch with an exact-host allowlist', () => {
    const result = validateManifest(
      {
        ...base,
        apiVersion: 2,
        permissions: ['net.fetch'],
        allowedHosts: ['public-api.wordpress.com'],
      },
      'demo'
    );
    expect(result).toMatchObject({
      ok: true,
      manifest: { apiVersion: 2, allowedHosts: ['public-api.wordpress.com'] },
    });
  });
  it('requires and validates allowedHosts for v2 net.fetch', () => {
    expect(
      validateManifest({ ...base, apiVersion: 2, permissions: ['net.fetch'] }, 'demo').ok
    ).toBe(false);
    for (const host of ['*.example.com', 'https://example.com', 'example.com:443', 'Example.com']) {
      expect(
        validateManifest(
          { ...base, apiVersion: 2, permissions: ['net.fetch'], allowedHosts: [host] },
          'demo'
        ).ok
      ).toBe(false);
    }
  });
  it('rejects non-object input', () => {
    expect(validateManifest(null, 'demo').ok).toBe(false);
    expect(validateManifest('x', 'demo').ok).toBe(false);
  });
});

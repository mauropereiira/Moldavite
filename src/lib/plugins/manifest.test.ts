/** Strict manifest-schema, identity, capability, and hostname validation tests. */

import { describe, it, expect } from 'vitest';
import { validateManifest } from './manifest';
import wordpressManifest from '../../../src-tauri/example-plugin/moldavite-wordpress/manifest.json';

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
  it('accepts bounded install instructions and rejects oversized steps or lists', () => {
    const accepted = validateManifest(
      {
        ...base,
        instructions: Array.from({ length: 20 }, (_, index) => `${index}: ${'x'.repeat(495)}`),
      },
      'demo'
    );
    expect(accepted).toMatchObject({
      ok: true,
      manifest: { instructions: expect.arrayContaining([expect.stringContaining('0:')]) },
    });
    expect(
      validateManifest({ ...base, instructions: Array.from({ length: 21 }, () => 'step') }, 'demo')
        .ok
    ).toBe(false);
    expect(validateManifest({ ...base, instructions: ['x'.repeat(501)] }, 'demo').ok).toBe(false);
  });
  it('accepts declarative command metadata for the install dialog', () => {
    expect(
      validateManifest(
        {
          ...base,
          commands: [
            { id: 'configure', label: 'Configure plugin' },
            { id: 'publish', label: 'Publish note…' },
          ],
        },
        'demo'
      )
    ).toMatchObject({
      ok: true,
      manifest: {
        commands: expect.arrayContaining([{ id: 'configure', label: 'Configure plugin' }]),
      },
    });
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
  it.each([
    '127.0.0.1',
    '192.168.1.10',
    '[::1]',
    '::1',
    'localhost',
    'intranet',
    'api.localhost',
    'localhost.localdomain',
  ])('rejects local or literal allowed host %s', (host) => {
    expect(
      validateManifest(
        { ...base, apiVersion: 2, permissions: ['net.fetch'], allowedHosts: [host] },
        'demo'
      ).ok
    ).toBe(false);
  });
  it('accepts a valid dotted public host', () => {
    expect(
      validateManifest(
        {
          ...base,
          apiVersion: 2,
          permissions: ['net.fetch'],
          allowedHosts: ['api.example.com'],
        },
        'demo'
      ).ok
    ).toBe(true);
  });
  it('validates the bundled Publish to WordPress manifest', () => {
    expect(validateManifest(wordpressManifest, 'moldavite-wordpress')).toMatchObject({
      ok: true,
      manifest: {
        apiVersion: 2,
        permissions: expect.arrayContaining(['notes.read', 'net.fetch', 'secrets']),
        allowedHosts: ['public-api.wordpress.com'],
        commands: expect.arrayContaining([
          { id: 'configure-wordpress', label: 'Configure WordPress publishing' },
        ]),
        instructions: expect.arrayContaining([
          expect.stringContaining('Configure WordPress publishing'),
        ]),
      },
    });
  });
  it('rejects non-object input', () => {
    expect(validateManifest(null, 'demo').ok).toBe(false);
    expect(validateManifest('x', 'demo').ok).toBe(false);
  });

  it('cleanly rejects missing, unknown, and wrong-typed fields', () => {
    const malformed: unknown[] = [
      {},
      { ...base, surprise: true },
      { ...base, name: 42 },
      { ...base, version: null },
      { ...base, apiVersion: '2' },
      { ...base, author: [] },
      { ...base, permissions: 'ui' },
      { ...base, permissions: ['ui', 42] },
      { ...base, allowedHosts: ['api.example.com', false] },
      { ...base, instructions: 'step one' },
      { ...base, instructions: ['valid', 2] },
      {
        ...base,
        commands: [
          { id: 'duplicate', label: 'One' },
          { id: 'duplicate', label: 'Two' },
        ],
      },
      { ...base, commands: [{ id: 'missing-label' }] },
    ];
    for (const raw of malformed) {
      expect(() => validateManifest(raw, 'demo')).not.toThrow();
      expect(validateManifest(raw, 'demo').ok).toBe(false);
    }
  });
});

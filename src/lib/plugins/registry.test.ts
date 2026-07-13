/** Registry parsing and installed-state classification at the remote trust boundary. */
import { describe, expect, it } from 'vitest';
import type { PluginInfo } from './types';
import {
  COMMUNITY_PLUGIN_RAW_BASE,
  communityInstallState,
  communityPluginFileUrl,
  parseCommunityRegistry,
  type CommunityPlugin,
} from './registry';

const HASH_A = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);

function entry(overrides: Record<string, unknown> = {}) {
  return {
    id: 'safe-plugin',
    name: 'Safe Plugin',
    version: '1.2.0',
    description: 'Does one useful thing.',
    author: 'Community Author',
    apiVersion: 2,
    permissions: ['notes.read', 'net.fetch'],
    allowedHosts: ['api.example.com'],
    files: {
      'manifest.json': { sha256: HASH_A },
      'plugin.js': { sha256: HASH_B },
    },
    path: 'plugins/safe-plugin',
    ...overrides,
  };
}

function parseOne(overrides: Record<string, unknown> = {}): CommunityPlugin {
  const parsed = parseCommunityRegistry({ registryVersion: 1, plugins: [entry(overrides)] });
  expect(parsed.rejectedEntries).toBe(0);
  return parsed.plugins[0];
}

describe('parseCommunityRegistry', () => {
  it('accepts a valid v1 entry and keeps permission and host metadata', () => {
    const plugin = parseOne();
    expect(plugin.id).toBe('safe-plugin');
    expect(plugin.permissions).toEqual(['notes.read', 'net.fetch']);
    expect(plugin.allowedHosts).toEqual(['api.example.com']);
  });

  it('rejects malformed entries cleanly while retaining valid siblings', () => {
    const parsed = parseCommunityRegistry({
      registryVersion: 1,
      plugins: [
        entry({ id: '../escape', path: 'plugins/../escape' }),
        entry({ files: { 'manifest.json': { sha256: 'short' } } }),
        entry({ allowedHosts: ['https://api.example.com'] }),
        entry(),
      ],
    });
    expect(parsed.plugins.map((plugin) => plugin.id)).toEqual(['safe-plugin']);
    expect(parsed.rejectedEntries).toBe(3);
  });

  it('rejects an invalid envelope with a friendly parsing error', () => {
    expect(() => parseCommunityRegistry({ registryVersion: 2, plugins: [] })).toThrow(
      'not in the expected format'
    );
    expect(() => parseCommunityRegistry({ registryVersion: 1, plugins: 'nope' })).toThrow(
      'not in the expected format'
    );
  });

  it('constructs downloads from the pinned base and validated id, never the registry path', () => {
    const plugin = parseOne({ path: 'plugins/safe-plugin/' });
    expect(communityPluginFileUrl(plugin, 'plugin.js')).toBe(
      `${COMMUNITY_PLUGIN_RAW_BASE}/safe-plugin/plugin.js`
    );
  });
});

describe('communityInstallState', () => {
  const plugin = parseOne();
  const installed = (version: string, status: PluginInfo['status'] = 'ok'): PluginInfo => ({
    manifest: { id: plugin.id, name: plugin.name, version, apiVersion: 2 },
    status,
  });

  it('distinguishes available, installed, and update states for the browser UI', () => {
    expect(communityInstallState(plugin, [])).toBe('not-installed');
    expect(communityInstallState(plugin, [installed('1.2.0')])).toBe('installed');
    expect(communityInstallState(plugin, [installed('1.1.0')])).toBe('update-available');
    expect(communityInstallState(plugin, [installed('?', 'invalid')])).toBe('update-available');
  });
});

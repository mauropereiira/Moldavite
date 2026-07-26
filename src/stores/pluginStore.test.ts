/** Per-Forge plugin consent tests for version and content-hash pinning. */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { usePluginStore } from './pluginStore';
import { rememberActiveForge } from '@/lib/forgeStorage';

const HASH = 'abc123';

/** Persist rehydration settles in microtasks with synchronous storage. */
const flushMicrotasks = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('pluginStore', () => {
  beforeEach(() => {
    localStorage.clear();
    usePluginStore.setState({ grants: {} });
  });

  it('is not granted by default and needs a grant', () => {
    const s = usePluginStore.getState();
    expect(s.isEnabledAndGranted('p', '1.0.0', HASH)).toBe(false);
    expect(s.needsGrant('p', '1.0.0', HASH)).toBe(true);
  });

  it('grant enables the plugin for that version + content hash', () => {
    usePluginStore.getState().grant('p', '1.0.0', HASH);
    const s = usePluginStore.getState();
    expect(s.isEnabledAndGranted('p', '1.0.0', HASH)).toBe(true);
    expect(s.needsGrant('p', '1.0.0', HASH)).toBe(false);
  });

  it('a version bump requires a re-grant', () => {
    usePluginStore.getState().grant('p', '1.0.0', HASH);
    const s = usePluginStore.getState();
    expect(s.isEnabledAndGranted('p', '2.0.0', HASH)).toBe(false);
    expect(s.needsGrant('p', '2.0.0', HASH)).toBe(true);
  });

  it('changed plugin code (same version) requires a re-grant', () => {
    usePluginStore.getState().grant('p', '1.0.0', HASH);
    const s = usePluginStore.getState();
    expect(s.isEnabledAndGranted('p', '1.0.0', 'tampered')).toBe(false);
    expect(s.needsGrant('p', '1.0.0', 'tampered')).toBe(true);
  });

  it('fails closed when the backend provides no content hash', () => {
    usePluginStore.getState().grant('p', '1.0.0', HASH);
    expect(usePluginStore.getState().isEnabledAndGranted('p', '1.0.0')).toBe(false);
  });

  it('legacy grants without a stored hash require a re-grant', () => {
    usePluginStore.setState({ grants: { p: { enabled: true, grantedVersion: '1.0.0' } } });
    expect(usePluginStore.getState().isEnabledAndGranted('p', '1.0.0', HASH)).toBe(false);
    expect(usePluginStore.getState().needsGrant('p', '1.0.0', HASH)).toBe(true);
  });

  it('disable turns it off but keeps the record', () => {
    usePluginStore.getState().grant('p', '1.0.0', HASH);
    usePluginStore.getState().disable('p');
    const s = usePluginStore.getState();
    expect(s.isEnabledAndGranted('p', '1.0.0', HASH)).toBe(false);
    expect(s.needsGrant('p', '1.0.0', HASH)).toBe(true);
  });

  it('persists approved hosts independently from the version/hash grant', () => {
    const store = usePluginStore.getState();
    store.grant('p', '1.0.0', HASH);
    usePluginStore.getState().approveHost('p', 'site.example.com');
    usePluginStore.getState().grant('p', '2.0.0', 'new-hash');
    expect(usePluginStore.getState().approvedHosts('p')).toEqual(['site.example.com']);
  });

  it('revokes one approved host without changing the plugin grant', () => {
    usePluginStore.getState().grant('p', '1.0.0', HASH);
    usePluginStore.getState().approveHost('p', 'one.example.com');
    usePluginStore.getState().approveHost('p', 'two.example.com');
    usePluginStore.getState().revokeHost('p', 'one.example.com');
    expect(usePluginStore.getState().approvedHosts('p')).toEqual(['two.example.com']);
    expect(usePluginStore.getState().isEnabledAndGranted('p', '1.0.0', HASH)).toBe(true);
  });

  it('revoke forgets the grant entirely', () => {
    usePluginStore.getState().grant('p', '1.0.0', HASH);
    usePluginStore.getState().revoke('p');
    expect(usePluginStore.getState().grants.p).toBeUndefined();
    expect(usePluginStore.getState().needsGrant('p', '1.0.0', HASH)).toBe(true);
  });

  it('recovers from a corrupt persisted grant store without granting anything', async () => {
    localStorage.setItem('moldavite-plugins:Default', '{truncated');
    usePluginStore.setState({ grants: {} });
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await expect(usePluginStore.persist.rehydrate()).resolves.toBeUndefined();
    expect(usePluginStore.getState().grants).toEqual({});
    expect(usePluginStore.getState().isEnabledAndGranted('p', '1.0.0', HASH)).toBe(false);
    consoleError.mockRestore();
  });

  describe('per-Forge isolation', () => {
    it('writes grants under the Forge that is active at write time', () => {
      rememberActiveForge('Alpha');
      usePluginStore.getState().grant('p', '1.0.0', HASH);
      rememberActiveForge('Beta');
      usePluginStore.getState().grant('q', '1.0.0', HASH);

      const alpha = JSON.parse(localStorage.getItem('moldavite-plugins:Alpha') ?? '{}');
      const beta = JSON.parse(localStorage.getItem('moldavite-plugins:Beta') ?? '{}');
      expect(Object.keys(alpha.state.grants)).toEqual(['p']);
      expect(Object.keys(beta.state.grants)).toEqual(['q']);
    });

    it("re-reads the correct Forge's grants once the active Forge is known", async () => {
      localStorage.setItem(
        'moldavite-plugins:Beta',
        JSON.stringify({
          state: { grants: { q: { enabled: true, grantedVersion: '1.0.0', grantedHash: HASH } } },
        })
      );
      // Stand in for the stale slice hydration loaded under the previous Forge.
      usePluginStore.setState({
        grants: { p: { enabled: true, grantedVersion: '1.0.0', grantedHash: HASH } },
      });

      rememberActiveForge('Beta');
      await flushMicrotasks();

      expect(usePluginStore.getState().isEnabledAndGranted('q', '1.0.0', HASH)).toBe(true);
      expect(usePluginStore.getState().isEnabledAndGranted('p', '1.0.0', HASH)).toBe(false);
    });

    it('drops consent carried over from another Forge that has no grants here', async () => {
      usePluginStore.setState({
        grants: { p: { enabled: true, grantedVersion: '1.0.0', grantedHash: HASH } },
      });

      rememberActiveForge('Empty');
      await flushMicrotasks();

      expect(usePluginStore.getState().grants).toEqual({});
      expect(usePluginStore.getState().needsGrant('p', '1.0.0', HASH)).toBe(true);
    });
  });
});

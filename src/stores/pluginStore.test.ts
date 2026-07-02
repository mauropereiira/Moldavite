import { describe, it, expect, beforeEach } from 'vitest';
import { usePluginStore } from './pluginStore';

const HASH = 'abc123';

describe('pluginStore', () => {
  beforeEach(() => usePluginStore.setState({ grants: {} }));

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

  it('revoke forgets the grant entirely', () => {
    usePluginStore.getState().grant('p', '1.0.0', HASH);
    usePluginStore.getState().revoke('p');
    expect(usePluginStore.getState().grants.p).toBeUndefined();
    expect(usePluginStore.getState().needsGrant('p', '1.0.0', HASH)).toBe(true);
  });
});

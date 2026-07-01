import { describe, it, expect, beforeEach } from 'vitest';
import { usePluginStore } from './pluginStore';

describe('pluginStore', () => {
  beforeEach(() => usePluginStore.setState({ grants: {} }));

  it('is not granted by default and needs a grant', () => {
    const s = usePluginStore.getState();
    expect(s.isEnabledAndGranted('p', '1.0.0')).toBe(false);
    expect(s.needsGrant('p', '1.0.0')).toBe(true);
  });

  it('grant enables the plugin for that version', () => {
    usePluginStore.getState().grant('p', '1.0.0');
    const s = usePluginStore.getState();
    expect(s.isEnabledAndGranted('p', '1.0.0')).toBe(true);
    expect(s.needsGrant('p', '1.0.0')).toBe(false);
  });

  it('a version bump requires a re-grant', () => {
    usePluginStore.getState().grant('p', '1.0.0');
    const s = usePluginStore.getState();
    expect(s.isEnabledAndGranted('p', '2.0.0')).toBe(false);
    expect(s.needsGrant('p', '2.0.0')).toBe(true);
  });

  it('disable turns it off but keeps the record', () => {
    usePluginStore.getState().grant('p', '1.0.0');
    usePluginStore.getState().disable('p');
    const s = usePluginStore.getState();
    expect(s.isEnabledAndGranted('p', '1.0.0')).toBe(false);
    expect(s.needsGrant('p', '1.0.0')).toBe(true);
  });
});

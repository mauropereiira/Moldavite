/** Validation and cold/running delivery tests for plugin install deep links. */

import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useGraphStore } from '@/stores/graphStore';
import { usePluginInstallStore } from '@/stores/pluginInstallStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { useTimelineStore } from '@/stores/timelineStore';

const invokeMock = vi.fn();
const listenMock = vi.fn();
let eventHandler: (() => void) | undefined;

vi.mock('@/lib/ipc', () => ({
  safeInvoke: (...args: unknown[]) => invokeMock(...args),
}));

vi.mock('@tauri-apps/api/event', () => ({
  listen: (...args: unknown[]) => listenMock(...args),
}));

import { routePluginInstallRequest, usePluginDeepLinks } from './usePluginDeepLinks';

beforeEach(() => {
  localStorage.clear();
  eventHandler = undefined;
  invokeMock.mockReset().mockResolvedValue([]);
  listenMock.mockReset().mockImplementation(async (_event: string, handler: () => void) => {
    eventHandler = handler;
    return vi.fn();
  });
  useSettingsStore.setState({ isSettingsOpen: false, activeSettingsTab: 'general' });
  usePluginInstallStore.setState({ pending: null });
  useTimelineStore.setState({ isOpen: false });
  useGraphStore.setState({ isOpen: false });
});

describe('plugin install deep links', () => {
  it('opens Settings with a validated cold-start request and yields transient views', async () => {
    invokeMock.mockResolvedValueOnce(['publish-wordpress', '../invalid']);
    useTimelineStore.getState().open();
    useGraphStore.getState().open();

    renderHook(() => usePluginDeepLinks());

    await waitFor(() =>
      expect(usePluginInstallStore.getState().pending?.id).toBe('publish-wordpress')
    );
    expect(useSettingsStore.getState().isSettingsOpen).toBe(true);
    expect(useSettingsStore.getState().activeSettingsTab).toBe('plugins');
    expect(useTimelineStore.getState().isOpen).toBe(false);
    expect(useGraphStore.getState().isOpen).toBe(false);
  });

  it('drains the backend queue again for a running-instance event', async () => {
    renderHook(() => usePluginDeepLinks());
    await waitFor(() => expect(eventHandler).toBeTypeOf('function'));
    invokeMock.mockResolvedValueOnce(['second-plugin']);

    act(() => eventHandler?.());

    await waitFor(() => expect(usePluginInstallStore.getState().pending?.id).toBe('second-plugin'));
    expect(invokeMock).toHaveBeenLastCalledWith('take_pending_plugin_install_links');
  });

  it('rejects malformed frontend payloads defensively', () => {
    expect(routePluginInstallRequest('valid-plugin')).toBe(true);
    const validRequest = usePluginInstallStore.getState().pending;

    expect(routePluginInstallRequest('valid-plugin/extra')).toBe(false);
    expect(routePluginInstallRequest('-leading')).toBe(false);
    expect(routePluginInstallRequest({ id: 'valid-plugin' })).toBe(false);
    expect(usePluginInstallStore.getState().pending).toEqual(validRequest);
  });
});

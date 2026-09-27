import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/plugins/host', () => ({
  startPluginsAtLaunch: vi.fn(),
  setPluginsPaused: vi.fn().mockResolvedValue({ active: false, reason: null, pluginIds: [] }),
}));
vi.mock('@/lib/forgeReadiness', () => ({ whenForgeReady: () => Promise.resolve() }));

import { setPluginsPaused, startPluginsAtLaunch } from '@/lib/plugins/host';
import { useToastStore } from '@/stores/toastStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { safeModeLaunchMessage, usePluginHost } from './usePluginHost';

describe('usePluginHost', () => {
  beforeEach(() => useToastStore.setState({ toasts: [] }));

  it('says why a launch started without plugins and offers both ways forward', async () => {
    vi.mocked(startPluginsAtLaunch).mockResolvedValue({
      active: true,
      reason: 'unfinishedStart',
      pluginIds: ['crashy'],
    });
    renderHook(() => usePluginHost());

    await waitFor(() => expect(useToastStore.getState().toasts).toHaveLength(1));
    const toast = useToastStore.getState().toasts[0];
    expect(toast.message).toContain("last start didn't finish");
    expect(toast.actions?.map((action) => action.label)).toEqual([
      'Manage plugins',
      'Turn plugins back on',
    ]);

    toast.actions?.[0].onClick();
    expect(useSettingsStore.getState().activeSettingsTab).toBe('plugins');
    toast.actions?.[1].onClick();
    expect(setPluginsPaused).toHaveBeenCalledWith(false);
  });

  it('stays quiet on a normal launch', async () => {
    vi.mocked(startPluginsAtLaunch).mockResolvedValue({
      active: false,
      reason: null,
      pluginIds: [],
    });
    renderHook(() => usePluginHost());
    await waitFor(() => expect(startPluginsAtLaunch).toHaveBeenCalled());
    expect(useToastStore.getState().toasts).toHaveLength(0);
  });

  it('has a message for the command-line flag but none for a session pause', () => {
    expect(safeModeLaunchMessage({ active: true, reason: 'launchFlag', pluginIds: [] })).toContain(
      'safe mode'
    );
    expect(
      safeModeLaunchMessage({ active: true, reason: 'userRequest', pluginIds: [] })
    ).toBeNull();
  });
});

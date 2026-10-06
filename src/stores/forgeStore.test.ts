import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  registerAutosaveFlush,
  registerAutosavePendingProbe,
  registerHeldSaves,
} from '@/lib/autosaveFlush';
import { getActiveForgeName, rememberActiveForge } from '@/lib/forgeStorage';
import { useForgeStore } from './forgeStore';

const invoke = vi.hoisted(() => vi.fn());
vi.mock('@/lib/ipc', () => ({ safeInvoke: (...args: unknown[]) => invoke(...args) }));

beforeEach(() => {
  invoke.mockReset();
  localStorage.clear();
  rememberActiveForge('Default');
  useForgeStore.setState({ forges: [], active: 'Default', loading: false });
});

describe('synced Forge selection', () => {
  it('uses a separate storage namespace from a local Forge with the same display name', async () => {
    invoke.mockImplementation((command: string) =>
      Promise.resolve(
        command === 'list_forges'
          ? [
              {
                id: 'Synced Forge',
                name: 'Synced Forge',
                path: '/local',
                isActive: false,
                isSynced: false,
              },
              {
                id: 'icloud://moldavite',
                name: 'Synced Forge',
                path: '/cloud',
                isActive: true,
                isSynced: true,
              },
            ]
          : '/local'
      )
    );
    await useForgeStore.getState().loadForges();
    expect(useForgeStore.getState().active).toBe('icloud://moldavite');
    expect(getActiveForgeName()).toBe('icloud://moldavite');
  });

  it('keeps the current Forge selected when iCloud cannot connect', async () => {
    const releaseFlush = registerAutosaveFlush(async () => {});
    const releaseProbe = registerAutosavePendingProbe(() => null);
    invoke.mockRejectedValue(new Error('iCloud unavailable'));
    try {
      await expect(useForgeStore.getState().setSyncedForge(true)).rejects.toThrow(
        'iCloud unavailable'
      );
      expect(useForgeStore.getState().active).toBe('Default');
      expect(getActiveForgeName()).toBe('Default');
    } finally {
      releaseFlush();
      releaseProbe();
    }
  });

  it('refuses to change storage while an edit remains unsaved', async () => {
    const releaseFlush = registerAutosaveFlush(async () => {});
    const releaseProbe = registerAutosavePendingProbe(() => 'notes/Draft.md');
    try {
      await expect(useForgeStore.getState().setSyncedForge(true)).rejects.toThrow(
        'could not be saved'
      );
      expect(invoke).not.toHaveBeenCalled();
    } finally {
      releaseFlush();
      releaseProbe();
    }
  });
});

describe('switching with a save held after a failed leave', () => {
  it('retries the held save and refuses to switch while it still fails', async () => {
    const saveNow = vi.fn().mockResolvedValue(undefined);
    const releaseHeld = registerHeldSaves({ saveNow, isPending: () => true });
    try {
      await expect(useForgeStore.getState().switchTo('Other')).rejects.toThrow(
        'Forge change cancelled because a note could not be saved'
      );
      expect(saveNow).toHaveBeenCalledTimes(1);
      expect(invoke).not.toHaveBeenCalled();
    } finally {
      releaseHeld();
    }
  });

  it('switches once the held save goes through', async () => {
    const reload = vi.fn();
    vi.stubGlobal('window', { location: { reload } });
    let held = true;
    const releaseHeld = registerHeldSaves({
      saveNow: async () => {
        held = false;
      },
      isPending: () => held,
    });
    invoke.mockResolvedValue('Other');
    try {
      await useForgeStore.getState().switchTo('Other');
      expect(invoke).toHaveBeenCalledWith('set_active_forge', { name: 'Other' });
      expect(reload).toHaveBeenCalledOnce();
    } finally {
      releaseHeld();
      vi.unstubAllGlobals();
    }
  });
});

describe('per-Forge localStorage on rename and delete', () => {
  const forgesAfter = (active: string, other: string) => [
    { id: active, name: active, path: `/f/${active}`, isActive: true, isSynced: false },
    { id: other, name: other, path: `/f/${other}`, isActive: false, isSynced: false },
  ];

  it('moves every namespaced key of a renamed Forge to its new name', async () => {
    localStorage.setItem('moldavite-plugins:Old', '{"grants":1}');
    localStorage.setItem('moldavite-pinned-tabs:Old', '["a"]');
    localStorage.setItem('template-storage:Old', '{"t":1}');
    localStorage.setItem('moldavite-plugins:Other', '{"grants":2}');
    localStorage.setItem('moldavite-quick-switcher:New', '{"stale":true}');
    invoke.mockImplementation((command: string) =>
      Promise.resolve(
        command === 'rename_forge'
          ? { id: 'New', name: 'New', path: '/f/New', isActive: false, isSynced: false }
          : command === 'list_forges'
            ? forgesAfter('Default', 'New')
            : '/f'
      )
    );

    await useForgeStore.getState().renameForge('Old', 'New');

    expect(localStorage.getItem('moldavite-plugins:New')).toBe('{"grants":1}');
    expect(localStorage.getItem('moldavite-pinned-tabs:New')).toBe('["a"]');
    expect(localStorage.getItem('template-storage:New')).toBe('{"t":1}');
    expect(localStorage.getItem('moldavite-quick-switcher:New')).toBeNull();
    expect(localStorage.getItem('moldavite-plugins:Old')).toBeNull();
    expect(localStorage.getItem('moldavite-pinned-tabs:Old')).toBeNull();
    expect(localStorage.getItem('moldavite-plugins:Other')).toBe('{"grants":2}');
  });

  it('leaves storage alone when the backend rename fails', async () => {
    localStorage.setItem('moldavite-plugins:Old', '{"grants":1}');
    invoke.mockRejectedValue(new Error('exists'));
    await expect(useForgeStore.getState().renameForge('Old', 'New')).rejects.toThrow('exists');
    expect(localStorage.getItem('moldavite-plugins:Old')).toBe('{"grants":1}');
    expect(localStorage.getItem('moldavite-plugins:New')).toBeNull();
  });

  it('renames the active Forge through the Forge transition and reloads under the new name', async () => {
    const reload = vi.fn();
    const order: string[] = [];
    const releaseFlush = registerAutosaveFlush(async () => {
      order.push('flush');
    });
    const releaseProbe = registerAutosavePendingProbe(() => null);
    vi.stubGlobal('window', { location: { reload } });
    rememberActiveForge('Old');
    useForgeStore.setState({ active: 'Old' });
    localStorage.setItem('moldavite-plugins:Old', '{"grants":1}');
    invoke.mockImplementation((command: string) => {
      order.push(command);
      return Promise.resolve(
        command === 'rename_forge'
          ? { id: 'New', name: 'New', path: '/f/New', isActive: true, isSynced: false }
          : command === 'list_forges'
            ? forgesAfter('New', 'Default')
            : '/f'
      );
    });
    try {
      await useForgeStore.getState().renameForge('Old', 'New');
      expect(order[0]).toBe('flush');
      expect(order).toContain('rename_forge');
      expect(reload).toHaveBeenCalledTimes(1);
      expect(getActiveForgeName()).toBe('New');
      expect(localStorage.getItem('moldavite-plugins:New')).toBe('{"grants":1}');
      expect(localStorage.getItem('moldavite-plugins:Old')).toBeNull();
    } finally {
      vi.unstubAllGlobals();
      releaseFlush();
      releaseProbe();
    }
  });

  it('removes every namespaced key of a deleted Forge so a same-named Forge starts clean', async () => {
    localStorage.setItem('moldavite-plugins:Gone', '{"grants":1}');
    localStorage.setItem('moldavite-folders:Gone', '{"f":1}');
    localStorage.setItem('moldavite-plugins:Other', '{"grants":2}');
    localStorage.setItem('moldavite-settings', '{"s":1}');
    invoke.mockImplementation((command: string) =>
      Promise.resolve(command === 'list_forges' ? forgesAfter('Default', 'Other') : '/f')
    );

    await useForgeStore.getState().deleteForge('Gone');

    expect(localStorage.getItem('moldavite-plugins:Gone')).toBeNull();
    expect(localStorage.getItem('moldavite-folders:Gone')).toBeNull();
    expect(localStorage.getItem('moldavite-plugins:Other')).toBe('{"grants":2}');
    expect(localStorage.getItem('moldavite-settings')).toBe('{"s":1}');
  });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { registerAutosaveFlush, registerAutosavePendingProbe } from '@/lib/autosaveFlush';
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

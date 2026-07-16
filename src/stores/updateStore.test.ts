import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { check } from '@tauri-apps/plugin-updater';
import { relaunch } from '@tauri-apps/plugin-process';
import {
  INITIAL_UPDATE_CHECK_DELAY_MS,
  UPDATE_CHECK_INTERVAL_MS,
  __resetUpdateStoreForTests,
  isUpdateCheckStale,
  selectHasPendingUpdate,
  useUpdateStore,
} from './updateStore';

vi.mock('@tauri-apps/plugin-updater', () => ({
  check: vi.fn(),
}));

vi.mock('@tauri-apps/plugin-process', () => ({
  relaunch: vi.fn(),
}));

const mockCheck = vi.mocked(check);
const mockRelaunch = vi.mocked(relaunch);

function mockUpdate(version = '1.8.0') {
  return {
    version,
    downloadAndInstall: vi.fn().mockResolvedValue(undefined),
  };
}

describe('updateStore', () => {
  beforeEach(() => {
    localStorage.clear();
    __resetUpdateStoreForTests();
    mockCheck.mockReset();
    mockRelaunch.mockReset().mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('treats missing and 24-hour-old successful checks as stale', () => {
    const now = Date.UTC(2026, 6, 16, 12);

    expect(isUpdateCheckStale(null, now)).toBe(true);
    expect(isUpdateCheckStale(now - UPDATE_CHECK_INTERVAL_MS + 1, now)).toBe(false);
    expect(isUpdateCheckStale(now - UPDATE_CHECK_INTERVAL_MS, now)).toBe(true);
  });

  it('drives indicator visibility from the pending version, independent of dismissal', () => {
    expect(selectHasPendingUpdate({ availableVersion: null })).toBe(false);
    expect(selectHasPendingUpdate({ availableVersion: '1.8.0' })).toBe(true);

    useUpdateStore.setState({ availableVersion: '1.8.0', dismissed: true });
    expect(selectHasPendingUpdate(useUpdateStore.getState())).toBe(true);
  });

  it('persists only app-wide update metadata under a global key', () => {
    useUpdateStore.setState({
      availableVersion: '1.8.0',
      lastCheckedAt: 1234,
      dismissed: true,
      progress: 42,
      error: 'transient',
    });

    const persisted = JSON.parse(localStorage.getItem('moldavite-updates') || '{}');
    expect(persisted.state).toEqual({
      availableVersion: '1.8.0',
      lastCheckedAt: 1234,
      dismissed: true,
    });
  });

  it('records a successful automatic discovery without requesting a notification', async () => {
    const update = mockUpdate();
    mockCheck.mockResolvedValue(update as never);

    await useUpdateStore.getState().checkForUpdateSilently();

    const state = useUpdateStore.getState();
    expect(state.availableVersion).toBe('1.8.0');
    expect(state.update).toBe(update);
    expect(state.dismissed).toBe(true);
    expect(state.error).toBeNull();
    expect(state.lastCheckedAt).toEqual(expect.any(Number));
  });

  it('clears a pending indicator when a successful check offers no update', async () => {
    useUpdateStore.setState({ availableVersion: '1.8.0', dismissed: true });
    mockCheck.mockResolvedValue(null);

    await useUpdateStore.getState().checkForUpdateSilently();

    expect(useUpdateStore.getState().availableVersion).toBeNull();
    expect(selectHasPendingUpdate(useUpdateStore.getState())).toBe(false);
  });

  it('logs automatic failures without surfacing an error or advancing lastCheckedAt', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockCheck.mockRejectedValue(new Error('404 latest.json'));

    await useUpdateStore.getState().checkForUpdateSilently();

    expect(consoleError).toHaveBeenCalledWith(
      '[updateStore] Automatic update check failed:',
      expect.any(Error)
    );
    expect(useUpdateStore.getState().error).toBeNull();
    expect(useUpdateStore.getState().lastCheckedAt).toBeNull();
  });

  it('surfaces manual failures without advancing lastCheckedAt', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockCheck.mockRejectedValue(new Error('Could not reach update server'));

    await useUpdateStore.getState().checkForUpdate();

    expect(consoleError).toHaveBeenCalled();
    expect(useUpdateStore.getState().error).toBe('Could not reach update server');
    expect(useUpdateStore.getState().lastCheckedAt).toBeNull();
  });

  it('keeps the explicit notification path for a successful manual check', async () => {
    mockCheck.mockResolvedValue(mockUpdate() as never);

    await useUpdateStore.getState().checkForUpdate();

    expect(useUpdateStore.getState().availableVersion).toBe('1.8.0');
    expect(useUpdateStore.getState().dismissed).toBe(false);
  });

  it('clears the pending indicator after installation completes', async () => {
    const update = mockUpdate();
    useUpdateStore.setState({ availableVersion: update.version, update: update as never });

    await useUpdateStore.getState().installUpdate();

    expect(update.downloadAndInstall).toHaveBeenCalled();
    expect(useUpdateStore.getState().availableVersion).toBeNull();
    expect(mockRelaunch).toHaveBeenCalled();
  });

  it('reacquires an updater handle before installing persisted pending metadata', async () => {
    const update = mockUpdate();
    useUpdateStore.setState({ availableVersion: update.version, update: null });
    mockCheck.mockResolvedValue(update as never);

    await useUpdateStore.getState().installUpdate();

    expect(mockCheck).toHaveBeenCalledTimes(1);
    expect(update.downloadAndInstall).toHaveBeenCalled();
    expect(useUpdateStore.getState().availableVersion).toBeNull();
  });

  it('checks after 15 seconds and every 24 hours while running', async () => {
    vi.useFakeTimers();
    mockCheck.mockResolvedValue(null);
    const cleanup = useUpdateStore.getState().startPeriodicChecks();

    await vi.advanceTimersByTimeAsync(INITIAL_UPDATE_CHECK_DELAY_MS - 1);
    expect(mockCheck).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(mockCheck).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(UPDATE_CHECK_INTERVAL_MS - INITIAL_UPDATE_CHECK_DELAY_MS);
    expect(mockCheck).toHaveBeenCalledTimes(2);

    cleanup();
  });

  it('checks on focus only when the last successful check is stale', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-16T12:00:00Z'));
    mockCheck.mockResolvedValue(null);
    const now = Date.now();
    const cleanup = useUpdateStore.getState().startPeriodicChecks();

    useUpdateStore.setState({ lastCheckedAt: now - UPDATE_CHECK_INTERVAL_MS + 1 });
    window.dispatchEvent(new Event('focus'));
    await Promise.resolve();
    expect(mockCheck).not.toHaveBeenCalled();

    useUpdateStore.setState({ lastCheckedAt: now - UPDATE_CHECK_INTERVAL_MS });
    window.dispatchEvent(new Event('focus'));
    await Promise.resolve();
    expect(mockCheck).toHaveBeenCalledTimes(1);

    cleanup();
  });
});

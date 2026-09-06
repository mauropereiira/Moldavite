import { beforeEach, describe, expect, it, vi } from 'vitest';
import { isTauri } from '@tauri-apps/api/core';
import { isMobilePlatform } from './platform';
import { safeInvoke } from './ipc';
import { syncMobileAppearance } from './mobileAppearance';

vi.mock('@tauri-apps/api/core', () => ({ isTauri: vi.fn() }));
vi.mock('./platform', () => ({ isMobilePlatform: vi.fn() }));
vi.mock('./ipc', () => ({ safeInvoke: vi.fn() }));

describe('native mobile appearance', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(isMobilePlatform).mockReturnValue(true);
    vi.mocked(isTauri).mockReturnValue(true);
    vi.mocked(safeInvoke).mockResolvedValue(undefined);
  });

  it.each(['light', 'dark', 'system'] as const)(
    'applies the %s preference natively',
    async (mode) => {
      await syncMobileAppearance(mode);
      expect(safeInvoke).toHaveBeenCalledWith('plugin:mobile-ui|set_appearance', { mode });
    }
  );

  it('keeps desktop appearance unchanged', async () => {
    vi.mocked(isMobilePlatform).mockReturnValue(false);
    await syncMobileAppearance('dark');
    expect(safeInvoke).not.toHaveBeenCalled();
  });

  it('does not invoke a native plugin in a mobile browser', async () => {
    vi.mocked(isTauri).mockReturnValue(false);
    await syncMobileAppearance('light');
    expect(safeInvoke).not.toHaveBeenCalled();
  });
});

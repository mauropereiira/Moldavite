import { isTauri } from '@tauri-apps/api/core';
import type { BaseMode } from '@/stores/themeStore';
import { safeInvoke } from './ipc';
import { isMobilePlatform } from './platform';

export async function syncMobileAppearance(mode: BaseMode): Promise<void> {
  if (isMobilePlatform() && isTauri()) {
    await safeInvoke('plugin:mobile-ui|set_appearance', { mode });
  }
}

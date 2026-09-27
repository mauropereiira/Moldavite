import { afterEach, describe, expect, it, vi } from 'vitest';
import { applyFocusMode } from './settingsStore';

const platform = vi.hoisted(() => ({ mobile: false }));
vi.mock('@/lib/platform', () => ({ isMobilePlatform: () => platform.mobile }));

describe('applyFocusMode', () => {
  afterEach(() => document.documentElement.classList.remove('focus-mode'));

  it('hides the chrome on the desktop', () => {
    platform.mobile = false;
    applyFocusMode(true);
    expect(document.documentElement.classList.contains('focus-mode')).toBe(true);
  });

  it('leaves the rail on a phone, even for a saved setting', () => {
    platform.mobile = true;
    applyFocusMode(true);
    expect(document.documentElement.classList.contains('focus-mode')).toBe(false);
  });
});

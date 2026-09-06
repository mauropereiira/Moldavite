import { afterEach, describe, expect, it, vi } from 'vitest';
import { isMobilePlatform, isTabletPlatform } from './platform';

function stubNavigator(overrides: Partial<typeof navigator>) {
  vi.stubGlobal('navigator', { userAgent: '', platform: '', maxTouchPoints: 0, ...overrides });
}

describe('isMobilePlatform', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('is false for a desktop webview', () => {
    stubNavigator({
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605',
      platform: 'MacIntel',
    });
    expect(isMobilePlatform()).toBe(false);
    expect(isTabletPlatform()).toBe(false);
  });

  it('is true on an iPhone', () => {
    stubNavigator({
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605',
      platform: 'iPhone',
    });
    expect(isMobilePlatform()).toBe(true);
    expect(isTabletPlatform()).toBe(false);
  });

  it('is true on an iPad that reports itself as a Mac', () => {
    stubNavigator({
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) AppleWebKit/605',
      platform: 'MacIntel',
      maxTouchPoints: 5,
    });
    expect(isMobilePlatform()).toBe(true);
    expect(isTabletPlatform()).toBe(true);
  });

  it('is true on Android', () => {
    stubNavigator({
      userAgent: 'Mozilla/5.0 (Linux; Android 15) AppleWebKit/537',
      platform: 'Linux armv8l',
    });
    expect(isMobilePlatform()).toBe(true);
    expect(isTabletPlatform()).toBe(false);
  });

  it('recognizes an iPad using its mobile user agent', () => {
    stubNavigator({ userAgent: 'Mozilla/5.0 (iPad; CPU OS 26_5 like Mac OS X)', platform: 'iPad' });
    expect(isTabletPlatform()).toBe(true);
  });
});

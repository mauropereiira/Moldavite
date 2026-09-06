import { renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isMobilePlatform } from '@/lib/platform';
import { useVisualViewportHeight } from './useVisualViewportHeight';

vi.mock('@/lib/platform', () => ({ isMobilePlatform: vi.fn(() => true) }));

/** jsdom has no `visualViewport`; this stands in for the one WKWebView provides. */
function installViewport(height: number) {
  const viewport = Object.assign(new window.EventTarget(), { height });
  Object.defineProperty(window, 'visualViewport', { configurable: true, value: viewport });
  return viewport;
}

const appHeight = () => document.documentElement.style.getPropertyValue('--app-height');

describe('useVisualViewportHeight', () => {
  beforeEach(() => {
    vi.mocked(isMobilePlatform).mockReturnValue(true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    Object.defineProperty(window, 'visualViewport', { configurable: true, value: undefined });
    document.documentElement.style.removeProperty('--app-height');
  });

  it('publishes the visual viewport height and follows it while the keyboard moves', () => {
    const viewport = installViewport(812);
    const { unmount } = renderHook(() => useVisualViewportHeight());

    expect(appHeight()).toBe('812px');

    viewport.height = 476.5;
    viewport.dispatchEvent(new Event('resize'));
    expect(appHeight()).toBe('477px');

    viewport.height = 500;
    viewport.dispatchEvent(new Event('scroll'));
    expect(appHeight()).toBe('500px');

    unmount();
    expect(appHeight()).toBe('');
    viewport.height = 812;
    viewport.dispatchEvent(new Event('resize'));
    expect(appHeight()).toBe('');
  });

  it('falls back to the window height where there is no visual viewport', () => {
    renderHook(() => useVisualViewportHeight());

    expect(appHeight()).toBe(`${window.innerHeight}px`);
  });

  it('reveals the focused field after reserving room for the keyboard and Done bar', () => {
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      callback(0);
      return 1;
    });
    const viewport = installViewport(window.innerHeight);
    const field = document.createElement('input');
    const reveal = vi.fn(() => {
      expect(appHeight()).toBe('356px');
    });
    field.scrollIntoView = reveal;
    document.body.appendChild(field);
    field.focus();
    const { unmount } = renderHook(() => useVisualViewportHeight());
    expect(reveal).not.toHaveBeenCalled();

    viewport.height = 400;
    viewport.dispatchEvent(new Event('resize'));
    expect(reveal).toHaveBeenCalledWith({ block: 'center', inline: 'nearest' });

    unmount();
    field.remove();
  });

  it('sets nothing on desktop', () => {
    vi.mocked(isMobilePlatform).mockReturnValue(false);
    installViewport(900);
    renderHook(() => useVisualViewportHeight());

    expect(appHeight()).toBe('');
  });
});

import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useVisualViewportHeight } from './useVisualViewportHeight';
import { isMobilePlatform } from '@/lib/platform';

vi.mock('@/lib/platform', () => ({ isMobilePlatform: vi.fn(() => true) }));
let viewport: InstanceType<typeof window.EventTarget> & {
  height: number;
  scale: number;
  offsetTop: number;
};
beforeEach(() => {
  vi.mocked(isMobilePlatform).mockReturnValue(true);
  viewport = Object.assign(new window.EventTarget(), { height: 874, scale: 1, offsetTop: 0 });
  vi.stubGlobal('visualViewport', viewport);
  vi.stubGlobal('innerHeight', 874);
});
afterEach(() => vi.unstubAllGlobals());

it('reserves a Done row for keyboard-focused fields and restores the height on dismissal', () => {
  const input = document.createElement('input');
  document.body.append(input);
  const { unmount } = renderHook(useVisualViewportHeight);
  act(() => {
    input.focus();
    viewport.height = 520;
    viewport.dispatchEvent(new Event('resize'));
  });
  expect(document.documentElement.dataset.keyboard).toBe('open');
  expect(document.documentElement.dataset.keyboardField).toBe('true');
  expect(document.documentElement.style.getPropertyValue('--app-height')).toBe('476px');
  act(() => {
    input.blur();
    viewport.height = 874;
    viewport.dispatchEvent(new Event('resize'));
  });
  expect(document.documentElement.dataset.keyboard).toBe('closed');
  expect(document.documentElement.style.getPropertyValue('--app-height')).toBe('874px');
  input.remove();
  unmount();
  expect(document.documentElement.dataset.keyboard).toBeUndefined();
});

it('does not mistake pinch zoom for the keyboard or change desktop geometry', () => {
  viewport.height = 500;
  viewport.scale = 2;
  const { unmount } = renderHook(useVisualViewportHeight);
  expect(document.documentElement.dataset.keyboard).toBe('closed');
  unmount();
  vi.mocked(isMobilePlatform).mockReturnValue(false);
  renderHook(useVisualViewportHeight);
  expect(document.documentElement.style.getPropertyValue('--app-height')).toBe('');
});

// Tapping a dialog button while a field has the keyboard moves focus on
// mousedown; resizing the shell there moved the button before the click.
it('keeps the shell still until the tap that moved focus has finished', () => {
  vi.useFakeTimers();
  const dialog = document.createElement('div');
  dialog.tabIndex = -1;
  const input = document.createElement('input');
  dialog.append(input);
  document.body.append(dialog);
  const { unmount } = renderHook(useVisualViewportHeight);
  act(() => {
    input.focus();
    vi.runAllTimers();
    viewport.height = 520;
    viewport.dispatchEvent(new Event('resize'));
  });
  const appHeight = () => document.documentElement.style.getPropertyValue('--app-height');
  expect(appHeight()).toBe('476px');

  act(() => dialog.focus());
  expect(appHeight()).toBe('476px');

  act(() => vi.runAllTimers());
  expect(appHeight()).toBe('520px');
  unmount();
  dialog.remove();
  vi.useRealTimers();
});

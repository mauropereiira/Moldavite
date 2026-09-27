import { afterEach, describe, expect, it, vi } from 'vitest';
import { formatShortcut, isPrimaryModifier } from './shortcuts';

describe('formatShortcut', () => {
  it('preserves current macOS shortcut strings', () => {
    expect(formatShortcut('⌘⇧P', 'macos')).toBe('⌘⇧P');
    expect(formatShortcut(['⌘', '⇧', 'P'], 'macos')).toBe('⌘⇧P');
    expect(formatShortcut('Cmd+Shift+L', 'macos')).toBe('Cmd+Shift+L');
  });

  it('maps every modifier and joins non-macOS shortcuts with plus signs', () => {
    expect(formatShortcut('⌘P', 'windows')).toBe('Ctrl+P');
    expect(formatShortcut('⌥P', 'windows')).toBe('Alt+P');
    expect(formatShortcut('⌃P', 'windows')).toBe('Ctrl+P');
    expect(formatShortcut('⇧P', 'windows')).toBe('Shift+P');
    expect(formatShortcut(['⌘', '⇧', 'P'], 'linux')).toBe('Ctrl+Shift+P');
    expect(formatShortcut('Cmd+Shift+L', 'windows')).toBe('Ctrl+Shift+L');
  });

  it('leaves shortcuts without modifiers unchanged', () => {
    expect(formatShortcut('Esc', 'windows')).toBe('Esc');
  });
});

describe('isPrimaryModifier', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  const useAgent = (userAgent: string) =>
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(userAgent);

  it.each([
    ['macOS', 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15'],
    ['iPadOS', 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Mobile'],
    ['iOS', 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15'],
  ])('is ⌘ and never Ctrl on %s', (_name, userAgent) => {
    useAgent(userAgent);
    expect(isPrimaryModifier({ metaKey: true, ctrlKey: false })).toBe(true);
    expect(isPrimaryModifier({ metaKey: false, ctrlKey: true })).toBe(false);
  });

  it.each([
    ['Windows', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'],
    ['Linux', 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36'],
  ])('is Ctrl and never the system key on %s', (_name, userAgent) => {
    useAgent(userAgent);
    expect(isPrimaryModifier({ metaKey: false, ctrlKey: true })).toBe(true);
    expect(isPrimaryModifier({ metaKey: true, ctrlKey: false })).toBe(false);
  });
});

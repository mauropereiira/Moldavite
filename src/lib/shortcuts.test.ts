import { describe, expect, it } from 'vitest';
import { formatShortcut } from './shortcuts';

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
